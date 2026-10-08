<?php
defined('TVATT') || exit;

const TVATT_LOGIN_WINDOW = 900; // sekunder
const TVATT_LOGIN_MAX_FAILURES = 10;

function tvatt_now_ts(): int
{
    // Endast för automatiska tester: fejkad klocka via fil.
    $file = getenv('TVATT_TEST_NOW_FILE');
    if ($file && is_file($file)) return (int) strtotime(trim((string) file_get_contents($file)));
    return time();
}

function tvatt_send(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
}

function tvatt_fail(int $status, string $error): void
{
    tvatt_send($status, ['error' => $error]);
}

function tvatt_set_cookie(string $value, int $expires): void
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    setcookie('sess', $value, ['expires' => $expires, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $https]);
}

function tvatt_read_json(): ?array
{
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) return null;
    $raw = file_get_contents('php://input', false, null, 0, 10000);
    $data = json_decode((string) $raw, true);
    return is_array($data) ? $data : null;
}

// Skapar saknade inloggningar och återställer lösenord som listats i
// aterstall.txt. Nya lösenord skrivs till losenord.txt i datamappen.
function tvatt_sync_users(TvattStore $store, array $config): void
{
    $reset = [];
    $resetFile = $store->dir . '/aterstall.txt';
    if (is_file($resetFile)) {
        $words = preg_split('/[\s,]+/', (string) file_get_contents($resetFile), -1, PREG_SPLIT_NO_EMPTY);
        $reset = in_array('alla', $words, true) ? array_column($config['apartments'], 'id') : $words;
        $reset = array_map('strtolower', $reset);
        @unlink($resetFile);
    }
    $lines = [];
    foreach (array_merge($config['apartments'], [$config['admin']]) as $apt) {
        $existing = $store->data['users'][$apt['id']] ?? null;
        if ($existing && !in_array($apt['id'], $reset, true)) continue;
        $password = tvatt_generate_password();
        $store->data['users'][$apt['id']] = tvatt_new_user($password, $existing ? $existing['version'] + 1 : 0);
        $lines[] = $apt['name'] . ': ' . $password;
    }
    if ($lines) {
        $store->save();
        $store->logPasswords($lines);
    }
}

// Ger en lägenhet ett nytt slumpat lösenord och loggar ut den överallt.
// Vid flytt kan även lägenhetens kommande pass avbokas.
function tvatt_admin_reset(TvattStore $store, string $apartmentId, bool $cancelUpcoming, array $now, array $config): array
{
    $password = tvatt_generate_password();
    $version = (int) ($store->data['users'][$apartmentId]['version'] ?? -1) + 1;
    $store->data['users'][$apartmentId] = tvatt_new_user($password, $version);
    $cancelled = 0;
    if ($cancelUpcoming) {
        $keep = [];
        foreach ($store->data['bookings'] as $b) {
            $isUpcoming = (string) $b['apartmentId'] === $apartmentId
                && tvatt_hour_index($b['date'], $b['startHour']) >= tvatt_now_index($now);
            if ($isUpcoming) $cancelled++;
            else $keep[] = $b;
        }
        $store->data['bookings'] = $keep;
    }
    $store->save();
    return ['password' => $password, 'cancelled' => $cancelled];
}

// Antal bokade pass per lägenhet och månad, plus kommande pass.
function tvatt_admin_stats(array $bookings, array $now, array $config): array
{
    $rows = [];
    foreach ($config['apartments'] as $apt) {
        $rows[$apt['id']] = ['id' => $apt['id'], 'name' => $apt['name'], 'months' => [], 'total' => 0, 'upcoming' => 0];
    }
    foreach ($bookings as $b) {
        $id = (string) $b['apartmentId'];
        if (!isset($rows[$id])) continue;
        $month = substr($b['date'], 0, 7);
        $rows[$id]['months'][$month] = ($rows[$id]['months'][$month] ?? 0) + 1;
        $rows[$id]['total']++;
        if (tvatt_is_active($b, $now, $config)) $rows[$id]['upcoming']++;
    }
    foreach ($rows as &$row) {
        ksort($row['months']);
        $row['months'] = (object) $row['months'];
    }
    return ['now' => $now, 'passHours' => $config['passHours'], 'apartments' => array_values($rows)];
}

function tvatt_sort_bookings(array $bookings): array
{
    usort($bookings, function ($a, $b) {
        return strcmp($a['date'], $b['date']) ?: $a['startHour'] - $b['startHour'];
    });
    return $bookings;
}

function tvatt_run(array $config): void
{
    date_default_timezone_set($config['timezone']);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    try {
        $store = new TvattStore(tvatt_data_dir($config));
        tvatt_sync_users($store, $config);
        tvatt_dispatch($store, $config);
    } catch (Throwable $e) {
        error_log((string) $e);
        tvatt_fail(500, 'Något gick fel på servern.');
    }
}

function tvatt_dispatch(TvattStore $store, array $config)
{
    $ts = tvatt_now_ts();
    $now = tvatt_local_now($config['timezone'], $ts);
    $method = $_SERVER['REQUEST_METHOD'];
    $path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $pos = strpos($path, '/api/');
    $route = $pos === false ? '' : rtrim(substr($path, $pos + 4), '/');

    $names = array_column($config['apartments'], 'name', 'id');
    $adminId = $config['admin']['id'];
    $me = tvatt_read_session($_COOKIE['sess'] ?? null, $store->data['secret'], $store->data['users'], $ts);
    $public = function (array $b) use ($names, $config, &$me) {
        return [
            'id' => $b['id'], 'date' => $b['date'], 'startHour' => $b['startHour'],
            'endHour' => $b['startHour'] + $config['passHours'], 'apartmentId' => (string) $b['apartmentId'],
            'apartmentName' => $names[$b['apartmentId']] ?? (string) $b['apartmentId'],
            'mine' => (string) $b['apartmentId'] === $me,
        ];
    };

    // Öppna anrop
    if ($method === 'GET' && $route === '/config') {
        $keys = ['name', 'openHour', 'closeHour', 'passHours', 'maxActiveBookings', 'bookingHorizonDays'];
        $out = array_intersect_key($config, array_flip($keys));
        $out['apartments'] = array_map(function ($a) { return ['id' => $a['id'], 'name' => $a['name']]; }, $config['apartments']);
        return tvatt_send(200, $out);
    }
    if ($method === 'POST' && $route === '/login') {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $failures = $store->data['loginFailures'];
        foreach ($failures as $key => $times) {
            $failures[$key] = array_values(array_filter($times, function ($t) use ($ts) { return $ts - $t < TVATT_LOGIN_WINDOW; }));
            if (!$failures[$key]) unset($failures[$key]);
        }
        if (count($failures[$ip] ?? []) >= TVATT_LOGIN_MAX_FAILURES) {
            $store->data['loginFailures'] = $failures;
            $store->save();
            return tvatt_fail(429, 'För många misslyckade försök. Vänta en stund och försök igen.');
        }
        $body = tvatt_read_json();
        $id = isset($body['apartmentId']) ? (string) $body['apartmentId'] : '';
        $user = isset($names[$id]) || $id === $adminId ? ($store->data['users'][$id] ?? null) : null;
        if (!tvatt_verify_password($body['password'] ?? null, $user)) {
            $failures[$ip][] = $ts;
            $store->data['loginFailures'] = $failures;
            $store->save();
            return tvatt_fail(401, 'Fel lägenhet eller lösenord.');
        }
        unset($failures[$ip]);
        $store->data['loginFailures'] = $failures;
        $store->save();
        tvatt_set_cookie(tvatt_session_token($store->data['secret'], $id, (int) ($user['version'] ?? 0), $ts), $ts + TVATT_SESSION_DAYS * 86400);
        return tvatt_send(200, ['apartmentId' => $id, 'isAdmin' => $id === $adminId]);
    }
    if ($method === 'POST' && $route === '/logout') {
        tvatt_set_cookie('', 1);
        return tvatt_send(200, ['ok' => true]);
    }

    $known = ['/me', '/password', '/bookings', '/admin/stats', '/admin/reset-password'];
    if (!in_array($route, $known, true) && !preg_match('#^/bookings/[\w-]+$#', $route)) return tvatt_fail(404, 'Hittades inte.');
    if (!$me) return tvatt_fail(401, 'Du är inte inloggad.');
    $isAdmin = $me === $adminId;

    if ($method === 'GET' && $route === '/me') {
        return tvatt_send(200, [
            'apartmentId' => $me, 'apartmentName' => $isAdmin ? $config['admin']['name'] : $names[$me], 'isAdmin' => $isAdmin,
        ]);
    }

    if (strpos($route, '/admin/') === 0) {
        if (!$isAdmin) return tvatt_fail(403, 'Endast för hyresvärden.');
        if ($method === 'GET' && $route === '/admin/stats') {
            return tvatt_send(200, tvatt_admin_stats($store->data['bookings'], $now, $config));
        }
        if ($method === 'POST' && $route === '/admin/reset-password') {
            $body = tvatt_read_json();
            $id = isset($body['apartmentId']) ? (string) $body['apartmentId'] : '';
            if (!isset($names[$id])) return tvatt_fail(400, 'Okänd lägenhet.');
            $result = tvatt_admin_reset($store, $id, !empty($body['cancelUpcoming']), $now, $config);
            return tvatt_send(200, ['apartmentName' => $names[$id]] + $result);
        }
        return tvatt_fail(405, 'Metoden stöds inte.');
    }

    if ($method === 'POST' && $route === '/password') {
        $body = tvatt_read_json();
        $user = $store->data['users'][$me];
        if (!$body || !tvatt_verify_password($body['currentPassword'] ?? null, $user)) return tvatt_fail(400, 'Nuvarande lösenord stämmer inte.');
        $new = $body['newPassword'] ?? null;
        if (!is_string($new) || mb_strlen($new) < 6) return tvatt_fail(400, 'Det nya lösenordet måste vara minst 6 tecken.');
        $version = (int) ($user['version'] ?? 0) + 1;
        $store->data['users'][$me] = tvatt_new_user($new, $version);
        $store->save();
        tvatt_set_cookie(tvatt_session_token($store->data['secret'], $me, $version, $ts), $ts + TVATT_SESSION_DAYS * 86400);
        return tvatt_send(200, ['ok' => true]);
    }

    if ($method === 'GET' && $route === '/bookings') {
        $from = $_GET['from'] ?? $now['date'];
        $to = $_GET['to'] ?? (tvatt_is_valid_date($from) ? tvatt_add_days($from, 6) : '');
        if (!tvatt_is_valid_date($from) || !tvatt_is_valid_date($to)) return tvatt_fail(400, 'Ogiltigt datumintervall.');
        $inRange = array_filter($store->data['bookings'], function ($b) use ($from, $to) { return $b['date'] >= $from && $b['date'] <= $to; });
        $mine = tvatt_active_bookings_for($store->data['bookings'], $me, $now, $config);
        return tvatt_send(200, [
            'now' => $now,
            'bookings' => array_map($public, tvatt_sort_bookings(array_values($inRange))),
            'mine' => array_map($public, tvatt_sort_bookings($mine)),
        ]);
    }

    if ($method === 'POST' && $route === '/bookings') {
        if ($isAdmin) return tvatt_fail(403, 'Hyresvärden kan inte boka pass.');
        $body = tvatt_read_json();
        if (!$body) return tvatt_fail(400, 'Ogiltig förfrågan.');
        $date = $body['date'] ?? null;
        $startHour = $body['startHour'] ?? null;
        $error = tvatt_validate_booking($store->data['bookings'], $me, $date, $startHour, $now, $config);
        if ($error) return tvatt_fail(409, $error);
        $booking = [
            'id' => bin2hex(random_bytes(12)), 'apartmentId' => $me, 'date' => $date, 'startHour' => $startHour,
            'createdAt' => gmdate('c', $ts),
        ];
        $store->data['bookings'][] = $booking;
        $store->save();
        return tvatt_send(201, $public($booking));
    }

    if (preg_match('#^/bookings/([\w-]+)$#', $route, $m)) {
        if ($method !== 'DELETE') return tvatt_fail(405, 'Metoden stöds inte.');
        $index = null;
        foreach ($store->data['bookings'] as $i => $b) {
            if ($b['id'] === $m[1]) { $index = $i; break; }
        }
        $booking = $index === null ? null : $store->data['bookings'][$index];
        $error = tvatt_validate_cancel($booking, $me, $now, $config);
        if ($error) return tvatt_fail($booking ? 403 : 404, $error);
        array_splice($store->data['bookings'], $index, 1);
        $store->save();
        return tvatt_send(200, ['ok' => true]);
    }

    tvatt_fail(405, 'Metoden stöds inte.');
}

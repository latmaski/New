<?php
// API för de boende på en fastighets bokningssida (<bas>/api/...).
defined('TVATT') || exit;

function tvatt_booking_api(string $root, array $siteConfig, array $entry, string $route, string $base)
{
    $store = tvatt_open_property($root, $siteConfig, $entry);
    $config = tvatt_property_config($siteConfig, $entry, $store);
    $ts = tvatt_now_ts();
    $now = tvatt_local_now($config['timezone'], $ts);
    $method = $_SERVER['REQUEST_METHOD'];
    $names = tvatt_apartment_names($config);
    $cookie = function (string $value, int $expires) use ($base) { tvatt_set_cookie('sess', $value, $expires, $base); };

    $me = tvatt_read_session($_COOKIE['sess'] ?? null, $store->data['secret'], $store->data['users'], $ts);
    if ($me !== null && !isset($names[$me])) $me = null;
    $public = function (array $b) use ($names, $config, &$me) {
        return [
            'id' => $b['id'], 'date' => $b['date'], 'startHour' => $b['startHour'],
            'endHour' => $b['startHour'] + tvatt_booking_hours($b, $config), 'apartmentId' => (string) $b['apartmentId'],
            'apartmentName' => $names[$b['apartmentId']] ?? (string) $b['apartmentId'],
            'mine' => (string) $b['apartmentId'] === $me,
            'note' => (string) ($b['note'] ?? ''),
        ];
    };

    // Öppna anrop
    if ($method === 'GET' && $route === '/config') {
        $out = tvatt_rules($config) + ['name' => $config['name'], 'company' => $config['company']];
        $out['apartments'] = array_map(function ($a) { return ['id' => $a['id'], 'name' => $a['name']]; }, $config['apartments']);
        return tvatt_send(200, $out);
    }
    if ($method === 'POST' && $route === '/login') {
        if (tvatt_login_blocked($store, $ts)) return tvatt_fail(429, 'För många misslyckade försök. Vänta en stund och försök igen.');
        $body = tvatt_read_json();
        $id = isset($body['apartmentId']) ? (string) $body['apartmentId'] : '';
        $user = isset($names[$id]) ? ($store->data['users'][$id] ?? null) : null;
        if (!tvatt_verify_password($body['password'] ?? null, $user)) {
            tvatt_login_blocked($store, $ts, true);
            return tvatt_fail(401, 'Fel lägenhet eller lösenord.');
        }
        tvatt_login_blocked($store, $ts, false);
        $cookie(tvatt_session_token($store->data['secret'], $id, (int) ($user['version'] ?? 0), $ts), $ts + TVATT_SESSION_DAYS * 86400);
        return tvatt_send(200, ['apartmentId' => $id]);
    }
    if ($method === 'POST' && $route === '/logout') {
        $cookie('', 1);
        return tvatt_send(200, ['ok' => true]);
    }

    // Kalenderprenumeration: skyddas av den hemliga länken, inte av inloggning.
    if ($method === 'GET' && preg_match('#^/calendar/([a-f0-9]{32})\.ics$#', $route, $m)) {
        $id = tvatt_calendar_by_token($store, $m[1]);
        if ($id === null || !isset($names[$id])) return tvatt_fail(404, 'Kalendern finns inte. Hämta en ny länk i appen.');
        $cal = $store->data['calendars'][$id];
        $from = tvatt_add_days($now['date'], -30);
        $mine = array_filter($store->data['bookings'], function ($b) use ($id, $from) {
            return (string) $b['apartmentId'] === $id && $b['date'] >= $from;
        });
        $ics = tvatt_ics(tvatt_sort_bookings(array_values($mine)), 'Tvättstugan – ' . $config['name'] . ' – ' . $names[$id], (int) $cal['reminderMinutes'], $config, $ts, true);
        return tvatt_send_ics($ics, null);
    }

    $known = ['/me', '/password', '/bookings', '/reminders', '/reminders/new-link', '/board'];
    $dynamic = preg_match('#^/(bookings/[\w-]+(\.ics|/note)?|board/[\w-]+)$#', $route);
    if (!in_array($route, $known, true) && !$dynamic) return tvatt_fail(404, 'Hittades inte.');
    if (!$me) return tvatt_fail(401, 'Du är inte inloggad.');

    if ($method === 'GET' && $route === '/me') {
        return tvatt_send(200, ['apartmentId' => $me, 'apartmentName' => $names[$me]]);
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
        $cookie(tvatt_session_token($store->data['secret'], $me, $version, $ts), $ts + TVATT_SESSION_DAYS * 86400);
        return tvatt_send(200, ['ok' => true]);
    }

    if ($route === '/reminders' || $route === '/reminders/new-link') {
        if ($route === '/reminders/new-link' && $method === 'POST') {
            unset($store->data['calendars'][$me]['token']);
        } elseif ($route === '/reminders' && $method === 'POST') {
            $minutes = tvatt_read_json()['reminderMinutes'] ?? null;
            if (!in_array($minutes, TVATT_REMINDER_OPTIONS, true)) return tvatt_fail(400, 'Ogiltig påminnelsetid.');
            tvatt_calendar_for($store, $me);
            $store->data['calendars'][$me]['reminderMinutes'] = $minutes;
            $store->save();
        } elseif ($method !== 'GET') {
            return tvatt_fail(405, 'Metoden stöds inte.');
        }
        $cal = tvatt_calendar_for($store, $me);
        return tvatt_send(200, [
            'feedUrl' => tvatt_base_url() . 'api/calendar/' . $cal['token'] . '.ics',
            'reminderMinutes' => (int) $cal['reminderMinutes'],
            'options' => TVATT_REMINDER_OPTIONS,
        ]);
    }

    if ($method === 'GET' && preg_match('#^/bookings/([\w-]+)\.ics$#', $route, $m)) {
        $booking = null;
        foreach ($store->data['bookings'] as $b) {
            if ($b['id'] === $m[1]) { $booking = $b; break; }
        }
        if (!$booking || (string) $booking['apartmentId'] !== $me) return tvatt_fail(404, 'Bokningen finns inte.');
        $cal = tvatt_calendar_for($store, $me);
        $ics = tvatt_ics([$booking], 'Tvättstugan', (int) $cal['reminderMinutes'], $config, $ts, false);
        return tvatt_send_ics($ics, 'tvattpass-' . $booking['date'] . '.ics');
    }

    if ($route === '/board') {
        if ($method === 'POST') {
            $error = tvatt_board_add($store, $me, tvatt_read_json()['text'] ?? null, $ts);
            if ($error) return tvatt_fail(400, $error);
        } elseif ($method !== 'GET') {
            return tvatt_fail(405, 'Metoden stöds inte.');
        }
        return tvatt_send($method === 'POST' ? 201 : 200, ['posts' => tvatt_board_posts($store, $config, $me)]);
    }
    if (preg_match('#^/board/([\w-]+)$#', $route, $m)) {
        if ($method !== 'DELETE') return tvatt_fail(405, 'Metoden stöds inte.');
        [$status, $error] = tvatt_board_delete($store, $m[1], $me);
        return $error ? tvatt_fail($status, $error) : tvatt_send(200, ['ok' => true]);
    }

    // Anteckning på ett eget pass som inte är slut. Tom text tar bort den.
    if (preg_match('#^/bookings/([\w-]+)/note$#', $route, $m)) {
        if ($method !== 'POST') return tvatt_fail(405, 'Metoden stöds inte.');
        foreach ($store->data['bookings'] as $i => $b) {
            if ($b['id'] !== $m[1]) continue;
            if ((string) $b['apartmentId'] !== $me) return tvatt_fail(403, 'Du kan bara skriva på dina egna pass.');
            if (!tvatt_is_active($b, $now, $config)) return tvatt_fail(409, 'Passet har redan passerat.');
            $clean = tvatt_clean_text(tvatt_read_json()['note'] ?? null, TVATT_NOTE_MAX, false);
            if ($clean['error']) return tvatt_fail(400, $clean['error']);
            if ($clean['text'] === '') unset($store->data['bookings'][$i]['note']);
            else $store->data['bookings'][$i]['note'] = $clean['text'];
            $store->save();
            return tvatt_send(200, $public($store->data['bookings'][$i]));
        }
        return tvatt_fail(404, 'Bokningen finns inte.');
    }

    if ($method === 'GET' && $route === '/bookings') {
        $from = $_GET['from'] ?? $now['date'];
        $to = $_GET['to'] ?? (tvatt_is_valid_date($from) ? tvatt_add_days($from, 6) : '');
        if (!tvatt_is_valid_date($from) || !tvatt_is_valid_date($to)) return tvatt_fail(400, 'Ogiltigt datumintervall.');
        $inRange = array_filter($store->data['bookings'], function ($b) use ($from, $to) { return $b['date'] >= $from && $b['date'] <= $to; });
        $mine = tvatt_active_bookings_for($store->data['bookings'], $me, $now, $config);
        return tvatt_send(200, [
            'now' => $now,
            'rules' => tvatt_rules($config),
            'bookings' => array_map($public, tvatt_sort_bookings(array_values($inRange))),
            'mine' => array_map($public, tvatt_sort_bookings($mine)),
        ]);
    }

    if ($method === 'POST' && $route === '/bookings') {
        $body = tvatt_read_json();
        if (!$body) return tvatt_fail(400, 'Ogiltig förfrågan.');
        $date = $body['date'] ?? null;
        $startHour = $body['startHour'] ?? null;
        $note = tvatt_clean_text($body['note'] ?? null, TVATT_NOTE_MAX, false);
        if ($note['error']) return tvatt_fail(400, $note['error']);
        $check = tvatt_check_booking($store->data['bookings'], $me, $date, $startHour, $body['hours'] ?? null, $now, $config);
        if ($check['error']) return tvatt_fail(409, $check['error']);
        $booking = [
            'id' => bin2hex(random_bytes(12)), 'apartmentId' => $me, 'date' => $date, 'startHour' => $startHour,
            'hours' => $check['hours'], 'createdAt' => gmdate('c', $ts),
        ];
        if ($note['text'] !== '') $booking['note'] = $note['text'];
        $store->data['bookings'][] = $booking;
        $store->save();
        return tvatt_send(201, $public($booking));
    }

    if (preg_match('#^/bookings/([\w-]+)$#', $route, $m)) {
        if ($method !== 'DELETE' && $method !== 'POST') return tvatt_fail(405, 'Metoden stöds inte.');
        $index = null;
        foreach ($store->data['bookings'] as $i => $b) {
            if ($b['id'] === $m[1]) { $index = $i; break; }
        }
        $booking = $index === null ? null : $store->data['bookings'][$index];

        // POST = flytta passet till ny dag/tid.
        if ($method === 'POST') {
            $body = tvatt_read_json();
            if (!$body) return tvatt_fail(400, 'Ogiltig förfrågan.');
            $date = $body['date'] ?? null;
            $startHour = $body['startHour'] ?? null;
            $check = tvatt_check_move($store->data['bookings'], $booking, $me, $date, $startHour, $body['hours'] ?? null, $now, $config);
            if ($check['error']) return tvatt_fail(!$booking ? 404 : ((string) $booking['apartmentId'] !== $me ? 403 : 409), $check['error']);
            $store->data['bookings'][$index]['date'] = $date;
            $store->data['bookings'][$index]['startHour'] = $startHour;
            $store->data['bookings'][$index]['hours'] = $check['hours'];
            $store->data['bookings'][$index]['movedAt'] = gmdate('c', $ts);
            $store->save();
            return tvatt_send(200, $public($store->data['bookings'][$index]));
        }

        $error = tvatt_validate_cancel($booking, $me, $now, $config);
        if ($error) return tvatt_fail($booking ? 403 : 404, $error);
        array_splice($store->data['bookings'], $index, 1);
        $store->save();
        return tvatt_send(200, ['ok' => true]);
    }

    tvatt_fail(405, 'Metoden stöds inte.');
}

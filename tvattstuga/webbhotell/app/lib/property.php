<?php
// En fastighet = en tvättstuga med egna lägenheter, regler och bokningar.
// Registret (namn, adress) finns i site.json; resten i properties/<slug>/db.json.
defined('TVATT') || exit;

const TVATT_RULE_KEYS = ['openHour', 'closeHour', 'passHours', 'minPassHours', 'maxActiveBookings', 'bookingHorizonDays'];
const TVATT_NOTE_MAX = 200;   // anteckning på ett pass
const TVATT_POST_MAX = 500;   // inlägg på anslagstavlan
const TVATT_POSTS_SHOWN = 50;
const TVATT_ADMIN_ID = 'admin';

// Alla fastigheter, nycklade på slug. Före första inloggningen på startsidan
// finns inget site.json – då gäller listan i config.php.
function tvatt_properties(string $root, array $config): array
{
    $site = tvatt_peek_json("$root/site.json");
    $list = $site['properties'] ?? array_map(function ($p) {
        return ['slug' => $p['slug'], 'name' => $p['name'], 'url' => $p['url'] ?? ''];
    }, $config['properties']);
    return array_column($list, null, 'slug');
}

function tvatt_valid_slug($slug): bool
{
    return is_string($slug) && preg_match('/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/', $slug)
        && !in_array($slug, ['api', 'app', 'data', 'assets', 'www', 'admin', 'mail', 'ftp', 'cgi-bin'], true);
}

// Öppnar (och låser) fastighetens databas. Saknas lägenheter skapas de, och
// nya inloggningar skrivs till losenord.txt i datamappen.
function tvatt_open_property(string $root, array $config, array $entry): TvattStore
{
    $store = new TvattStore(tvatt_property_dir($root, $entry['slug']));
    if (empty($store->data['apartments'])) {
        $seed = [];
        foreach ($config['properties'] as $p) if ($p['slug'] === $entry['slug']) $seed = $p['apartments'] ?? [];
        if (!$seed) $seed = ['Lägenhet 1', 'Lägenhet 2', 'Lägenhet 3', 'Lägenhet 4', 'Lägenhet 5'];
        $store->data['apartments'] = [];
        foreach (array_values($seed) as $i => $name) $store->data['apartments'][] = ['id' => (string) ($i + 1), 'name' => $name];
        $store->save();
    }
    // Äldre databaser hade hyresvärden som användare – den bor nu på startsidan.
    unset($store->data['users'][TVATT_ADMIN_ID]);
    $lines = [];
    foreach ($store->data['apartments'] as $apt) {
        if (isset($store->data['users'][$apt['id']])) continue;
        $password = tvatt_generate_password();
        $store->data['users'][$apt['id']] = tvatt_new_user($password, 0);
        $lines[] = $apt['name'] . ': ' . $password;
    }
    if ($lines) {
        $store->save();
        $store->logPasswords($root, $entry['name'], $lines);
    }
    return $store;
}

// Gällande inställningar för en fastighet: standardregler + hyresvärdens ändringar.
function tvatt_property_config(array $config, array $entry, TvattStore $store): array
{
    $c = array_merge($config['rules'], [
        'timezone' => $config['timezone'],
        'name' => $entry['name'],
        'company' => $config['company'],
        'adminName' => $config['adminName'],
        'apartments' => $store->data['apartments'],
    ]);
    foreach (TVATT_RULE_KEYS as $key) {
        if (isset($store->data['settings'][$key])) $c[$key] = (int) $store->data['settings'][$key];
    }
    if (array_key_exists('days', $store->data['settings'] ?? [])) $c['days'] = $store->data['settings']['days'];
    $c['exceptions'] = $store->data['exceptions'] ?? [];
    return tvatt_normalize_rules($c);
}

// Fyller i veckoschemat (samma tider alla dagar om inget annat sagts) och
// sätter openHour/closeHour till tidigaste öppning och senaste stängning.
function tvatt_normalize_rules(array $r): array
{
    if (empty($r['days']) || !is_array($r['days']) || count($r['days']) !== 7) {
        $r['days'] = array_fill(0, 7, [(int) $r['openHour'], (int) $r['closeHour']]);
    }
    $open = array_filter($r['days']);
    if ($open) {
        $r['openHour'] = min(array_column($open, 0));
        $r['closeHour'] = max(array_column($open, 1));
    }
    return $r;
}

function tvatt_rules(array $config): array
{
    $config = tvatt_normalize_rules($config);
    return array_intersect_key($config, array_flip(TVATT_RULE_KEYS))
        + ['days' => $config['days'], 'exceptions' => (object) ($config['exceptions'] ?? [])];
}

// ---------- Avvikande dagar ----------
// Hyresvärden kan för ett enskilt datum stänga hela dagen ('closed'), ha andra
// öppettider ('hours': open–close) eller stänga några timmar ('block': from–to),
// med en anteckning om varför som visas för de boende.
const TVATT_EXCEPTION_NOTE_MAX = 120;

// Returnerar ['error' => ?string, 'exception' => array].
function tvatt_validate_exception($body, array $now): array
{
    $fail = function (string $error) { return ['error' => $error, 'exception' => []]; };
    if (!is_array($body)) return $fail('Ogiltig förfrågan.');
    $date = $body['date'] ?? null;
    if (!tvatt_is_valid_date($date)) return $fail('Välj ett datum.');
    if ($date < $now['date']) return $fail('Datumet har redan passerat.');
    $mode = $body['mode'] ?? null;
    $ex = ['date' => $date, 'mode' => $mode];
    $int = function ($v) { return is_int($v); };
    if ($mode === 'hours') {
        if (!$int($body['open'] ?? null) || !$int($body['close'] ?? null)) return $fail('Ange öppnings- och stängningstid.');
        if ($body['open'] < 0 || $body['close'] > 24 || $body['close'] <= $body['open']) return $fail('Stängningstiden måste vara efter öppningstiden.');
        $ex += ['open' => $body['open'], 'close' => $body['close']];
    } elseif ($mode === 'block') {
        if (!$int($body['from'] ?? null) || !$int($body['to'] ?? null)) return $fail('Ange vilka timmar det är stängt.');
        if ($body['from'] < 0 || $body['to'] > 24 || $body['to'] <= $body['from']) return $fail('Sluttiden måste vara efter starttiden.');
        $ex += ['from' => $body['from'], 'to' => $body['to']];
    } elseif ($mode !== 'closed') {
        return $fail('Välj om det är stängt hela dagen, andra öppettider eller stängt några timmar.');
    }
    $note = tvatt_clean_text($body['note'] ?? null, TVATT_EXCEPTION_NOTE_MAX, false);
    if ($note['error']) return $fail('Anteckningen får vara högst ' . TVATT_EXCEPTION_NOTE_MAX . ' tecken.');
    $ex['note'] = $note['text'];
    return ['error' => null, 'exception' => $ex];
}

// Bokningar som inte längre ryms om undantaget sparas.
function tvatt_exception_conflicts(array $bookings, array $ex, array $config): array
{
    $out = [];
    foreach ($bookings as $b) {
        if ($b['date'] !== $ex['date']) continue;
        $start = (int) $b['startHour'];
        $end = $start + tvatt_booking_hours($b, $config);
        $hit = $ex['mode'] === 'closed'
            || ($ex['mode'] === 'hours' && ($start < $ex['open'] || $end > $ex['close']))
            || ($ex['mode'] === 'block' && $start < $ex['to'] && $ex['from'] < $end);
        if ($hit) $out[] = $b;
    }
    return $out;
}

function tvatt_exceptions_list(TvattStore $store, array $now): array
{
    $list = array_values(array_filter($store->data['exceptions'] ?? [], function ($e) use ($now) { return $e['date'] >= $now['date']; }));
    usort($list, function ($a, $b) { return strcmp($a['date'], $b['date']); });
    return $list;
}

// Returnerar ['error' => ?string, 'rules' => array].
function tvatt_validate_rules($body): array
{
    $fail = function (string $error) { return ['error' => $error, 'rules' => []]; };
    if (!is_array($body)) return $fail('Ogiltig förfrågan.');
    $r = [];
    foreach (['passHours', 'minPassHours', 'maxActiveBookings', 'bookingHorizonDays'] as $key) {
        if (!isset($body[$key]) || !is_int($body[$key])) return $fail('Alla fält måste vara heltal.');
        $r[$key] = $body[$key];
    }
    // Veckoschema: 7 dagar (måndag först), varje dag [öppnar, stänger] eller null = stängt.
    // Utan schema gäller openHour/closeHour alla dagar.
    $days = $body['days'] ?? null;
    if ($days === null) {
        if (!isset($body['openHour'], $body['closeHour']) || !is_int($body['openHour']) || !is_int($body['closeHour'])) {
            return $fail('Alla fält måste vara heltal.');
        }
        $days = array_fill(0, 7, [$body['openHour'], $body['closeHour']]);
    }
    if (!is_array($days) || count($days) !== 7 || array_keys($days) !== range(0, 6)) return $fail('Veckoschemat måste ha sju dagar.');
    $names = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
    $longest = 0;
    foreach ($days as $i => $d) {
        if ($d === null) continue;
        if (!is_array($d) || count($d) !== 2 || !is_int($d[0] ?? null) || !is_int($d[1] ?? null)) return $fail("Ogiltiga tider för {$names[$i]}.");
        [$o, $c] = $d;
        if ($o < 0 || $o > 23 || $c < 1 || $c > 24) return $fail("Tiderna för {$names[$i]} måste ligga mellan 00 och 24.");
        if ($c <= $o) return $fail("På {$names[$i]} måste stängningstiden vara efter öppningstiden.");
        $longest = max($longest, $c - $o);
    }
    if ($longest === 0) return $fail('Minst en dag måste vara öppen.');
    $r['days'] = array_values($days);
    if ($r['passHours'] < 1 || $r['passHours'] > $longest) {
        return $fail('Passets längd måste vara minst 1 timme och rymmas inom öppettiden.');
    }
    if ($r['minPassHours'] < 1 || $r['minPassHours'] > $r['passHours']) return $fail('Kortaste pass måste vara mellan 1 timme och passets längd.');
    foreach ($days as $i => $d) {
        if ($d !== null && $d[1] - $d[0] < $r['minPassHours']) {
            return $fail("På {$names[$i]} är det öppet kortare tid än kortaste pass ({$r['minPassHours']} h).");
        }
    }
    if ($r['maxActiveBookings'] < 1 || $r['maxActiveBookings'] > 20) return $fail('Max antal pass måste vara mellan 1 och 20.');
    if ($r['bookingHorizonDays'] < 1 || $r['bookingHorizonDays'] > 365) return $fail('Hur långt fram man får boka måste vara mellan 1 och 365 dagar.');
    return ['error' => null, 'rules' => tvatt_normalize_rules($r)];
}

function tvatt_sort_bookings(array $bookings): array
{
    usort($bookings, function ($a, $b) {
        return strcmp($a['date'], $b['date']) ?: $a['startHour'] - $b['startHour'];
    });
    return $bookings;
}

function tvatt_apartment_names(array $config): array
{
    return array_column($config['apartments'], 'name', 'id');
}

// Anslagstavlans inlägg som de visas för $viewer (lägenhets-id eller admin).
function tvatt_board_posts(TvattStore $store, array $config, string $viewer): array
{
    $names = tvatt_apartment_names($config);
    $isAdmin = $viewer === TVATT_ADMIN_ID;
    $posts = array_slice(array_reverse($store->data['board'] ?? []), 0, TVATT_POSTS_SHOWN);
    return array_map(function ($p) use ($names, $config, $viewer, $isAdmin) {
        $author = (string) $p['author'];
        return [
            'id' => $p['id'], 'author' => $author,
            'authorName' => $author === TVATT_ADMIN_ID ? $config['adminName'] : ($names[$author] ?? $author),
            'text' => $p['text'], 'createdAt' => gmdate('c', (int) $p['createdAt']),
            'mine' => $author === $viewer, 'canDelete' => $author === $viewer || $isAdmin,
        ];
    }, $posts);
}

function tvatt_board_add(TvattStore $store, string $author, $text, int $ts): ?string
{
    $clean = tvatt_clean_text($text, TVATT_POST_MAX, true);
    if ($clean['error']) return $clean['error'];
    if ($clean['text'] === '') return 'Skriv något först.';
    $store->data['board'][] = ['id' => bin2hex(random_bytes(8)), 'author' => $author, 'text' => $clean['text'], 'createdAt' => $ts];
    $store->save();
    return null;
}

// Returnerar [status, fel] – [200, null] om inlägget togs bort.
function tvatt_board_delete(TvattStore $store, string $id, string $viewer): array
{
    foreach ($store->data['board'] ?? [] as $i => $p) {
        if ($p['id'] !== $id) continue;
        if ($p['author'] !== $viewer && $viewer !== TVATT_ADMIN_ID) return [403, 'Du kan bara ta bort dina egna inlägg.'];
        array_splice($store->data['board'], $i, 1);
        $store->save();
        return [200, null];
    }
    return [404, 'Inlägget finns inte.'];
}

// Ger en lägenhet ett nytt slumpat lösenord och loggar ut den överallt.
// Vid flytt avbokas även kommande pass och kalenderlänken byts.
function tvatt_admin_reset(TvattStore $store, string $apartmentId, bool $moveOut, array $now): array
{
    $password = tvatt_generate_password();
    $version = (int) ($store->data['users'][$apartmentId]['version'] ?? -1) + 1;
    $store->data['users'][$apartmentId] = tvatt_new_user($password, $version);
    $cancelled = 0;
    if ($moveOut) {
        unset($store->data['calendars'][$apartmentId]);
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

// Antal bokade pass och timmar per lägenhet och månad, plus kommande pass.
function tvatt_admin_stats(array $bookings, array $now, array $config): array
{
    $rows = [];
    foreach ($config['apartments'] as $apt) {
        $rows[$apt['id']] = ['id' => $apt['id'], 'name' => $apt['name'], 'months' => [], 'monthHours' => [], 'total' => 0, 'totalHours' => 0, 'upcoming' => 0];
    }
    foreach ($bookings as $b) {
        $id = (string) $b['apartmentId'];
        if (!isset($rows[$id])) continue;
        $month = substr($b['date'], 0, 7);
        $hours = tvatt_booking_hours($b, $config);
        $rows[$id]['months'][$month] = ($rows[$id]['months'][$month] ?? 0) + 1;
        $rows[$id]['monthHours'][$month] = ($rows[$id]['monthHours'][$month] ?? 0) + $hours;
        $rows[$id]['total']++;
        $rows[$id]['totalHours'] += $hours;
        if (tvatt_is_active($b, $now, $config)) $rows[$id]['upcoming']++;
    }
    foreach ($rows as &$row) {
        ksort($row['months']);
        $row['months'] = (object) $row['months'];
        $row['monthHours'] = (object) $row['monthHours'];
    }
    return ['now' => $now, 'passHours' => $config['passHours'], 'apartments' => array_values($rows)];
}

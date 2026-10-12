<?php
// API för startsidan (cjafastighetobygg.se/api/...): fastighetslistan och
// hyresvärdens administration av alla fastigheter.
defined('TVATT') || exit;

function tvatt_open_site(string $root, array $config): TvattStore
{
    $store = new TvattStore($root, 'site.json');
    if (!isset($store->data['properties'])) {
        $store->data['properties'] = array_map(function ($p) {
            return ['slug' => $p['slug'], 'name' => $p['name'], 'url' => $p['url'] ?? ''];
        }, $config['properties']);
        $store->save();
    }
    // Hyresvärdens lösenord skapas första gången, eller om aterstall.txt finns.
    $resetFile = "$root/aterstall.txt";
    $reset = is_file($resetFile);
    if ($reset || !isset($store->data['users'][TVATT_ADMIN_ID])) {
        $password = tvatt_generate_password();
        $version = (int) ($store->data['users'][TVATT_ADMIN_ID]['version'] ?? -1) + 1;
        $store->data['users'][TVATT_ADMIN_ID] = tvatt_new_user($password, $version);
        $store->save();
        $store->logPasswords($root, 'Startsidan', [$config['adminName'] . ': ' . $password]);
        if ($reset) @unlink($resetFile);
    }
    return $store;
}

function tvatt_property_url(array $p): string
{
    return $p['url'] !== '' ? $p['url'] : tvatt_base_url() . $p['slug'] . '/';
}

// Skapar mappen <webbrot>/<slug>/ med en liten index.php som pekar på app/.
// Då fungerar bokningen direkt på adressen <domän>/<slug>/.
function tvatt_create_property_folder(string $webRoot, string $slug, string $name): bool
{
    $dir = "$webRoot/$slug";
    if (file_exists($dir)) return is_file("$dir/index.php");
    if (!@mkdir($dir, 0755)) return false;
    $main = var_export(dirname(__DIR__) . '/main.php', true);
    $php = "<?php\n// Bokningssida för " . str_replace(["\n", '?>'], ' ', $name) . ". Skapad av startsidan; all kod finns i app/.\n"
        . "require $main;\ntvatt_main(['type' => 'property', 'slug' => " . var_export($slug, true) . "]);\n";
    return @file_put_contents("$dir/index.php", $php) !== false
        && @copy(dirname(__DIR__) . '/stub/property.htaccess', "$dir/.htaccess");
}

function tvatt_site_api(string $root, array $config, string $route, string $webRoot)
{
    $site = tvatt_open_site($root, $config);
    $ts = tvatt_now_ts();
    $method = $_SERVER['REQUEST_METHOD'];
    $cookie = function (string $value, int $expires) { tvatt_set_cookie('admin', $value, $expires, '/'); };
    $properties = array_column($site->data['properties'], null, 'slug');
    $listing = function () use (&$site) {
        return array_map(function ($p) {
            return ['slug' => $p['slug'], 'name' => $p['name'], 'url' => tvatt_property_url($p)];
        }, $site->data['properties']);
    };

    if ($method === 'GET' && $route === '/site') {
        return tvatt_send(200, ['company' => $config['company'], 'properties' => $listing()]);
    }
    if ($method === 'POST' && $route === '/login') {
        if (tvatt_login_blocked($site, $ts)) return tvatt_fail(429, 'För många misslyckade försök. Vänta en stund och försök igen.');
        $user = $site->data['users'][TVATT_ADMIN_ID];
        if (!tvatt_verify_password(tvatt_read_json()['password'] ?? null, $user)) {
            tvatt_login_blocked($site, $ts, true);
            return tvatt_fail(401, 'Fel lösenord.');
        }
        tvatt_login_blocked($site, $ts, false);
        $cookie(tvatt_session_token($site->data['secret'], TVATT_ADMIN_ID, (int) $user['version'], $ts), $ts + TVATT_SESSION_DAYS * 86400);
        return tvatt_send(200, ['ok' => true]);
    }
    if ($method === 'POST' && $route === '/logout') {
        $cookie('', 1);
        return tvatt_send(200, ['ok' => true]);
    }

    $me = tvatt_read_session($_COOKIE['admin'] ?? null, $site->data['secret'], $site->data['users'], $ts);
    if ($me !== TVATT_ADMIN_ID) return tvatt_fail(401, 'Du är inte inloggad.');

    if ($method === 'GET' && $route === '/me') {
        return tvatt_send(200, ['name' => $config['adminName']]);
    }
    if ($method === 'POST' && $route === '/password') {
        $body = tvatt_read_json();
        $user = $site->data['users'][TVATT_ADMIN_ID];
        if (!$body || !tvatt_verify_password($body['currentPassword'] ?? null, $user)) return tvatt_fail(400, 'Nuvarande lösenord stämmer inte.');
        $new = $body['newPassword'] ?? null;
        if (!is_string($new) || mb_strlen($new) < 8) return tvatt_fail(400, 'Det nya lösenordet måste vara minst 8 tecken.');
        $version = (int) $user['version'] + 1;
        $site->data['users'][TVATT_ADMIN_ID] = tvatt_new_user($new, $version);
        $site->save();
        $cookie(tvatt_session_token($site->data['secret'], TVATT_ADMIN_ID, $version, $ts), $ts + TVATT_SESSION_DAYS * 86400);
        return tvatt_send(200, ['ok' => true]);
    }

    // Lägg till fastighet.
    if ($method === 'POST' && $route === '/properties') {
        $body = tvatt_read_json() ?? [];
        $name = tvatt_clean_text($body['name'] ?? null, 60, false);
        if ($name['error'] || $name['text'] === '') return tvatt_fail(400, 'Ange fastighetens namn (högst 60 tecken).');
        $slug = $body['slug'] ?? null;
        if (!tvatt_valid_slug($slug)) return tvatt_fail(400, 'Kortnamnet får bara innehålla a–z, 0–9 och bindestreck (2–32 tecken).');
        if (isset($properties[$slug])) return tvatt_fail(409, 'Det kortnamnet används redan.');
        $apartments = [];
        foreach ((array) ($body['apartments'] ?? []) as $a) {
            $clean = tvatt_clean_text($a, 40, false);
            if ($clean['error']) return tvatt_fail(400, 'Lägenhetsnamn får vara högst 40 tecken.');
            if ($clean['text'] !== '') $apartments[] = $clean['text'];
        }
        if (count($apartments) < 1 || count($apartments) > 50) return tvatt_fail(400, 'Ange mellan 1 och 50 lägenheter.');
        if (count(array_unique($apartments)) !== count($apartments)) return tvatt_fail(400, 'Två lägenheter har samma namn.');

        $folderOk = tvatt_create_property_folder($webRoot, $slug, $name['text']);
        $entry = ['slug' => $slug, 'name' => $name['text'], 'url' => ''];
        $site->data['properties'][] = $entry;
        $site->save();

        $store = new TvattStore(tvatt_property_dir($root, $slug));
        $store->data['apartments'] = [];
        $passwords = [];
        foreach ($apartments as $i => $aptName) {
            $id = (string) ($i + 1);
            $password = tvatt_generate_password();
            $store->data['apartments'][] = ['id' => $id, 'name' => $aptName];
            $store->data['users'][$id] = tvatt_new_user($password, 0);
            $passwords[] = ['name' => $aptName, 'password' => $password];
        }
        $store->save();
        return tvatt_send(201, ['property' => ['slug' => $slug, 'name' => $entry['name'], 'url' => tvatt_property_url($entry)], 'passwords' => $passwords, 'folderCreated' => $folderOk]);
    }

    if (!preg_match('#^/properties/([a-z0-9-]+)(/.*)?$#', $route, $m)) return tvatt_fail(404, 'Hittades inte.');
    $slug = $m[1];
    $sub = $m[2] ?? '';
    if (!isset($properties[$slug])) return tvatt_fail(404, 'Fastigheten finns inte.');
    $entry = $properties[$slug];
    $store = tvatt_open_property($root, $config, $entry);
    $pconfig = tvatt_property_config($config, $entry, $store);
    $now = tvatt_local_now($config['timezone'], $ts);
    $names = tvatt_apartment_names($pconfig);

    if ($sub === '') {
        if ($method === 'POST') {
            $body = tvatt_read_json() ?? [];
            $i = array_search($slug, array_column($site->data['properties'], 'slug'), true);
            if (array_key_exists('name', $body)) {
                $name = tvatt_clean_text($body['name'], 60, false);
                if ($name['error'] || $name['text'] === '') return tvatt_fail(400, 'Ange fastighetens namn (högst 60 tecken).');
                $site->data['properties'][$i]['name'] = $name['text'];
            }
            if (array_key_exists('url', $body)) {
                $url = is_string($body['url']) ? trim($body['url']) : '';
                if ($url !== '' && !preg_match('#^https?://[^\s<>"]+$#', $url)) return tvatt_fail(400, 'Adressen måste börja med https://');
                $site->data['properties'][$i]['url'] = $url;
            }
            $site->save();
            $entry = $site->data['properties'][$i];
        } elseif ($method !== 'GET') {
            return tvatt_fail(405, 'Metoden stöds inte.');
        }
        return tvatt_send(200, [
            'slug' => $slug, 'name' => $entry['name'], 'url' => tvatt_property_url($entry), 'customUrl' => $entry['url'],
            'apartments' => $pconfig['apartments'],
        ]);
    }
    if ($method === 'GET' && $sub === '/stats') {
        return tvatt_send(200, tvatt_admin_stats($store->data['bookings'], $now, $pconfig));
    }
    if ($sub === '/rules') {
        $defaults = tvatt_rules($config['rules']);
        if ($method === 'GET') return tvatt_send(200, ['rules' => tvatt_rules($pconfig), 'defaults' => $defaults]);
        if ($method === 'DELETE') {
            unset($store->data['settings']);
            $store->save();
            return tvatt_send(200, ['rules' => $defaults, 'defaults' => $defaults]);
        }
        if ($method === 'POST') {
            $check = tvatt_validate_rules(tvatt_read_json());
            if ($check['error']) return tvatt_fail(400, $check['error']);
            $store->data['settings'] = $check['rules'];
            $store->save();
            return tvatt_send(200, ['rules' => $check['rules'], 'defaults' => $defaults]);
        }
    }
    if ($method === 'POST' && $sub === '/reset-password') {
        $body = tvatt_read_json() ?? [];
        $id = isset($body['apartmentId']) ? (string) $body['apartmentId'] : '';
        if (!isset($names[$id])) return tvatt_fail(400, 'Okänd lägenhet.');
        return tvatt_send(200, ['apartmentName' => $names[$id]] + tvatt_admin_reset($store, $id, !empty($body['cancelUpcoming']), $now));
    }
    if ($method === 'POST' && preg_match('#^/apartments(?:/([\w-]+))?$#', $sub, $am)) {
        $name = tvatt_clean_text(tvatt_read_json()['name'] ?? null, 40, false);
        if ($name['error'] || $name['text'] === '') return tvatt_fail(400, 'Ange lägenhetens namn (högst 40 tecken).');
        $id = $am[1] ?? null;
        foreach ($store->data['apartments'] as $a) {
            if ($a['name'] === $name['text'] && $a['id'] !== $id) return tvatt_fail(409, 'Det finns redan en lägenhet med det namnet.');
        }
        if ($id === null) {
            $ids = array_map('intval', array_column($store->data['apartments'], 'id'));
            $id = (string) (max($ids ?: [0]) + 1);
            $password = tvatt_generate_password();
            $store->data['apartments'][] = ['id' => $id, 'name' => $name['text']];
            $store->data['users'][$id] = tvatt_new_user($password, 0);
            $store->save();
            return tvatt_send(201, ['apartment' => ['id' => $id, 'name' => $name['text']], 'password' => $password]);
        }
        if (!isset($names[$id])) return tvatt_fail(404, 'Okänd lägenhet.');
        foreach ($store->data['apartments'] as $i => $a) if ($a['id'] === $id) $store->data['apartments'][$i]['name'] = $name['text'];
        $store->save();
        return tvatt_send(200, ['apartment' => ['id' => $id, 'name' => $name['text']]]);
    }
    if ($sub === '/exceptions') {
        if ($method === 'POST') {
            $body = tvatt_read_json();
            $check = tvatt_validate_exception($body, $now);
            if ($check['error']) return tvatt_fail(400, $check['error']);
            $ex = $check['exception'];
            $conflicts = tvatt_exception_conflicts($store->data['bookings'], $ex, $pconfig);
            $decision = $body['onConflict'] ?? null;
            if ($conflicts && !in_array($decision, ['cancel', 'keep'], true)) {
                // Låt hyresvärden välja: avboka de pass som krockar, eller behålla dem.
                return tvatt_send(409, [
                    'error' => count($conflicts) . ' pass är redan bokade under den tiden.',
                    'conflicts' => array_map(function ($b) use ($names, $pconfig) {
                        return ['apartmentName' => $names[$b['apartmentId']] ?? (string) $b['apartmentId'], 'startHour' => $b['startHour'], 'endHour' => $b['startHour'] + tvatt_booking_hours($b, $pconfig)];
                    }, $conflicts),
                ]);
            }
            $cancelled = 0;
            if ($conflicts && $decision === 'cancel') {
                $ids = array_column($conflicts, 'id');
                $store->data['bookings'] = array_values(array_filter($store->data['bookings'], function ($b) use ($ids) { return !in_array($b['id'], $ids, true); }));
                $cancelled = count($ids);
            }
            $store->data['exceptions'][$ex['date']] = $ex;
            // Gamla undantag behövs inte längre.
            foreach (array_keys($store->data['exceptions']) as $date) {
                if ($date < tvatt_add_days($now['date'], -1)) unset($store->data['exceptions'][$date]);
            }
            $store->save();
            return tvatt_send(200, ['exceptions' => tvatt_exceptions_list($store, $now), 'cancelled' => $cancelled]);
        }
        if ($method !== 'GET') return tvatt_fail(405, 'Metoden stöds inte.');
        return tvatt_send(200, ['exceptions' => tvatt_exceptions_list($store, $now)]);
    }
    if ($method === 'DELETE' && preg_match('#^/exceptions/(\d{4}-\d{2}-\d{2})$#', $sub, $em)) {
        if (!isset($store->data['exceptions'][$em[1]])) return tvatt_fail(404, 'Det finns ingen avvikelse det datumet.');
        unset($store->data['exceptions'][$em[1]]);
        $store->save();
        return tvatt_send(200, ['exceptions' => tvatt_exceptions_list($store, $now)]);
    }
    if ($sub === '/board') {
        if ($method === 'POST') {
            $error = tvatt_board_add($store, TVATT_ADMIN_ID, tvatt_read_json()['text'] ?? null, $ts);
            if ($error) return tvatt_fail(400, $error);
        } elseif ($method !== 'GET') {
            return tvatt_fail(405, 'Metoden stöds inte.');
        }
        return tvatt_send($method === 'POST' ? 201 : 200, ['posts' => tvatt_board_posts($store, $pconfig, TVATT_ADMIN_ID)]);
    }
    if ($method === 'DELETE' && preg_match('#^/board/([\w-]+)$#', $sub, $bm)) {
        [$status, $error] = tvatt_board_delete($store, $bm[1], TVATT_ADMIN_ID);
        return $error ? tvatt_fail($status, $error) : tvatt_send(200, ['ok' => true]);
    }
    tvatt_fail(404, 'Hittades inte.');
}

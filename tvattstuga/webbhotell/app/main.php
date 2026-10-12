<?php
// Gemensam ingång för startsidan och alla bokningssidor. Varje webbmapp har en
// liten index.php som anropar tvatt_main() med vilken sida den är:
//   public_html/index.php  → ['type' => 'site']
//   pukevagen/index.php    → ['type' => 'property', 'slug' => 'pukevagen']
declare(strict_types=1);
define('TVATT', true);

require __DIR__ . '/lib/rules.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/http.php';
require __DIR__ . '/lib/calendar.php';
require __DIR__ . '/lib/property.php';
require __DIR__ . '/lib/booking.php';
require __DIR__ . '/lib/site.php';

const TVATT_ASSETS = [
    'common' => ['common.js' => 'common/common.js', 'style.css' => 'common/style.css', 'logo.svg' => 'common/logo.svg', 'logo-dark.svg' => 'common/logo-dark.svg', 'icon.svg' => 'common/icon.svg'],
    'site' => ['start.js' => 'start/start.js', 'start.css' => 'start/start.css'],
    'property' => ['app.js' => 'booking/app.js'],
];
const TVATT_TYPES = ['js' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'svg' => 'image/svg+xml'];

function tvatt_main(array $ctx): void
{
    $config = require __DIR__ . '/config.php';
    date_default_timezone_set($config['timezone']);
    // Ingen sida ska hamna i sökmotorer.
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');

    $path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $base = $ctx['base'] ?? rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/';
    if ($path . '/' === $base) {
        header('Location: ' . $base, true, 301);
        return;
    }
    $rel = strpos($path, $base) === 0 ? substr($path, strlen($base)) : '';
    $type = $ctx['type'];

    try {
        if ($rel === 'robots.txt') {
            header('Content-Type: text/plain; charset=utf-8');
            echo "User-agent: *\nDisallow: /\n";
            return;
        }
        $assets = TVATT_ASSETS['common'] + TVATT_ASSETS[$type];
        if (isset($assets[$rel])) {
            tvatt_serve_asset(__DIR__ . '/' . $assets[$rel]);
            return;
        }
        $root = tvatt_data_root($config);
        $isApi = strpos($rel, 'api/') === 0;
        $route = $isApi ? '/' . trim(substr($rel, 4), '/') : '';

        if ($type === 'site') {
            if ($isApi) {
                $webRoot = $ctx['webRoot'] ?? (getenv('TVATT_WEBROOT') ?: dirname($_SERVER['SCRIPT_FILENAME']));
                tvatt_site_api($root, $config, $route, $webRoot);
                return;
            }
            if ($rel === '' || $rel === 'index.html') {
                tvatt_serve_page(__DIR__ . '/start/index.html', $config['company'], $assets);
                return;
            }
        } else {
            $entry = tvatt_properties($root, $config)[$ctx['slug']] ?? null;
            if (!$entry) {
                if ($isApi) {
                    tvatt_fail(404, 'Fastigheten finns inte.');
                    return;
                }
                http_response_code(404);
                echo 'Fastigheten finns inte.';
                return;
            }
            if ($isApi) {
                tvatt_booking_api($root, $config, $entry, $route, $base);
                return;
            }
            if ($rel === '' || $rel === 'index.html') {
                tvatt_serve_page(__DIR__ . '/booking/index.html', 'Tvättstugan · ' . $entry['name'], $assets);
                return;
            }
        }
        if ($isApi) {
            tvatt_fail(404, 'Hittades inte.');
            return;
        }
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Sidan finns inte.';
    } catch (Throwable $e) {
        error_log((string) $e);
        if (!headers_sent()) tvatt_fail(500, 'Något gick fel på servern.');
    }
}

// Statiska filer: webbläsaren frågar alltid om filen ändrats (no-cache + ETag).
function tvatt_serve_asset(string $file): void
{
    $etag = '"' . md5(filemtime($file) . '-' . filesize($file)) . '"';
    header('Content-Type: ' . TVATT_TYPES[pathinfo($file, PATHINFO_EXTENSION)]);
    header('Cache-Control: no-cache');
    header('ETag: ' . $etag);
    if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        return;
    }
    readfile($file);
}

// Sidan får titel och ett versionsnummer på sina filer, så att en uppdatering
// av app/ slår igenom direkt.
function tvatt_serve_page(string $file, string $title, array $assets): void
{
    $version = 0;
    foreach ($assets as $asset) $version = max($version, filemtime(__DIR__ . '/' . $asset));
    $html = str_replace(
        ['{{TITLE}}', '?v=dev'],
        [htmlspecialchars($title, ENT_QUOTES, 'UTF-8'), '?v=' . $version],
        (string) file_get_contents($file)
    );
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    echo $html;
}

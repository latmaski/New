<?php
// Router för PHP:s inbyggda server vid utveckling och tester (läser inte
// .htaccess). Startsidan ligger på /, fastigheter på /<kortnamn>/.
// Kör: npm run dev
require __DIR__ . '/webbhotell/app/main.php';

$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/([a-z0-9-]+)(/|$)#', $path, $m)) {
    $config = require __DIR__ . '/webbhotell/app/config.php';
    if (isset(tvatt_properties(tvatt_data_root($config), $config)[$m[1]])) {
        tvatt_main(['type' => 'property', 'slug' => $m[1], 'base' => "/{$m[1]}/"]);
        return true;
    }
}
tvatt_main(['type' => 'site', 'base' => '/']);
return true;

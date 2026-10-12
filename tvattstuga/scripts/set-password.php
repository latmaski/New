<?php
// Sätter ett nytt lösenord via SSH på servern. Utan lösenord slumpas ett.
//   php app/../scripts/set-password.php admin [lösenord]              hyresvärden
//   php set-password.php <kortnamn> <lägenhets-id> [lösenord]         en lägenhet
// Sätt TVATT_APP_DIR om app/ inte ligger i ../webbhotell/app.
declare(strict_types=1);
define('TVATT_CLI', true);
$appDir = getenv('TVATT_APP_DIR') ?: dirname(__DIR__) . '/webbhotell/app';
require $appDir . '/main.php';
$config = require $appDir . '/config.php';
$root = tvatt_data_root($config);
$args = array_slice($argv, 1);

if (($args[0] ?? '') === 'admin') {
    $store = tvatt_open_site($root, $config);
    $id = TVATT_ADMIN_ID;
    $label = $config['adminName'];
    $password = $args[1] ?? tvatt_generate_password();
} else {
    $entry = tvatt_properties($root, $config)[$args[0] ?? ''] ?? null;
    if (!$entry) {
        fwrite(STDERR, "Användning: php set-password.php admin [lösenord]\n       php set-password.php <kortnamn> <lägenhets-id> [lösenord]\n");
        exit(1);
    }
    $store = tvatt_open_property($root, $config, $entry);
    $id = (string) ($args[1] ?? '');
    $names = array_column($store->data['apartments'], 'name', 'id');
    if (!isset($names[$id])) {
        fwrite(STDERR, 'Okänd lägenhet. Giltiga id: ' . implode(', ', array_keys($names)) . "\n");
        exit(1);
    }
    $label = $entry['name'] . ', ' . $names[$id];
    $password = $args[2] ?? tvatt_generate_password();
}
if (strlen($password) < 6) {
    fwrite(STDERR, "Lösenordet måste vara minst 6 tecken.\n");
    exit(1);
}
$version = (int) ($store->data['users'][$id]['version'] ?? -1) + 1;
$store->data['users'][$id] = tvatt_new_user($password, $version);
$store->save();
echo "Nytt lösenord för $label: $password\n";

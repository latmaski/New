<?php
// Användning (via SSH på servern): php set-password.php <lägenhets-id|admin> [nytt lösenord]
// Utan lösenord slumpas ett. Loggar ut lägenheten på alla enheter.
// Utan SSH: lägg en fil "aterstall.txt" med lägenhets-id i datamappen i stället.
declare(strict_types=1);
define('TVATT', true);
$root = getenv('TVATT_PUBLIC_DIR') ?: dirname(__DIR__) . '/public';
require $root . '/lib/rules.php';
require $root . '/lib/store.php';
require $root . '/lib/auth.php';
$config = require $root . '/config.php';

$id = $argv[1] ?? '';
$names = array_column($config['apartments'], 'name', 'id');
$names[$config['admin']['id']] = $config['admin']['name'];
if (!isset($names[$id])) {
    fwrite(STDERR, 'Okänd lägenhet. Giltiga id: ' . implode(', ', array_keys($names)) . "\n");
    exit(1);
}
$password = $argv[2] ?? tvatt_generate_password();
if (strlen($password) < 6) {
    fwrite(STDERR, "Lösenordet måste vara minst 6 tecken.\n");
    exit(1);
}
$store = new TvattStore(tvatt_data_dir($config));
$version = (int) ($store->data['users'][$id]['version'] ?? -1) + 1;
$store->data['users'][$id] = tvatt_new_user($password, $version);
$store->save();
echo "Nytt lösenord för {$names[$id]}: $password\n";

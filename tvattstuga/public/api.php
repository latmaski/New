<?php
declare(strict_types=1);
define('TVATT', true);

require __DIR__ . '/lib/rules.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/app.php';

tvatt_run(require __DIR__ . '/config.php');

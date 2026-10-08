<?php
// Router för PHP:s inbyggda server vid lokal utveckling och tester
// (den läser inte .htaccess). Kör: npm run dev
$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (strpos($path, '/api/') === 0) {
    require __DIR__ . '/public/api.php';
    return true;
}
if (preg_match('#^/(config\.php|lib/|data/|\.ht)#', $path)) {
    http_response_code(403);
    return true;
}
return false;

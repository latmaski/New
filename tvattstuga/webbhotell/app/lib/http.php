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
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
}

function tvatt_fail(int $status, string $error): void
{
    tvatt_send($status, ['error' => $error]);
}

function tvatt_is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function tvatt_set_cookie(string $name, string $value, int $expires, string $path): void
{
    setcookie($name, $value, ['expires' => $expires, 'path' => $path, 'httponly' => true, 'samesite' => 'Lax', 'secure' => tvatt_is_https()]);
}

function tvatt_read_json(): ?array
{
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) return null;
    $raw = file_get_contents('php://input', false, null, 0, 20000);
    $data = json_decode((string) $raw, true);
    return is_array($data) ? $data : null;
}

// Spärr mot gissning av lösenord: max 10 misslyckade försök per IP och kvart.
// Returnerar true om IP:n är spärrad. $failed = registrera ett misslyckat försök.
function tvatt_login_blocked(TvattStore $store, int $ts, ?bool $failed = null): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $failures = $store->data['loginFailures'] ?? [];
    foreach ($failures as $key => $times) {
        $failures[$key] = array_values(array_filter($times, function ($t) use ($ts) { return $ts - $t < TVATT_LOGIN_WINDOW; }));
        if (!$failures[$key]) unset($failures[$key]);
    }
    if ($failed === true) $failures[$ip][] = $ts;
    if ($failed === false) unset($failures[$ip]);
    $store->data['loginFailures'] = $failures;
    if ($failed !== null) $store->save();
    return count($failures[$ip] ?? []) >= TVATT_LOGIN_MAX_FAILURES;
}

// Städar fri text: tar bort styrtecken, normaliserar radbrytningar.
// Returnerar ['error' => ?string, 'text' => string].
function tvatt_clean_text($text, int $max, bool $multiline): array
{
    if ($text === null) $text = '';
    if (!is_string($text)) return ['error' => 'Ogiltig text.', 'text' => ''];
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $text = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/u', '', $text);
    if ($text === null) return ['error' => 'Ogiltig text.', 'text' => ''];
    if (!$multiline) $text = str_replace("\n", ' ', $text);
    $text = trim(preg_replace("/\n{3,}/", "\n\n", $text));
    $length = function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
    if ($length > $max) return ['error' => "Texten får vara högst $max tecken.", 'text' => ''];
    return ['error' => null, 'text' => $text];
}

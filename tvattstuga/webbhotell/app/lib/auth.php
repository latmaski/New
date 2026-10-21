<?php
defined('TVATT') || exit;

const TVATT_SESSION_DAYS = 30;
// Efter så många felaktiga pinkoder i rad måste lägenheten logga in med lösenordet.
const TVATT_PIN_MAX_FAILURES = 5;

function tvatt_generate_password(int $length = 10): string
{
    $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    $out = '';
    for ($i = 0; $i < $length; $i++) $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    return $out;
}

function tvatt_new_user(string $password, int $version): array
{
    return ['hash' => password_hash($password, PASSWORD_DEFAULT), 'version' => $version];
}

function tvatt_verify_password($password, ?array $user): bool
{
    return $user && is_string($password) && password_verify($password, $user['hash']);
}

function tvatt_valid_pin($pin): bool
{
    return is_string($pin) && preg_match('/^[0-9]{4}$/', $pin) === 1;
}

function tvatt_has_pin(?array $user): bool
{
    return $user !== null && !empty($user['pin']);
}

function tvatt_pin_locked(?array $user): bool
{
    return (int) ($user['pinFailures'] ?? 0) >= TVATT_PIN_MAX_FAILURES;
}

// Sessionen är en signerad cookie: lägenhet.utgång.version.signatur.
// "version" ökas vid lösenordsbyte så att gamla inloggningar slutar gälla.
function tvatt_session_token(string $secret, string $apartmentId, int $version, int $nowTs): string
{
    $payload = $apartmentId . '.' . ($nowTs + TVATT_SESSION_DAYS * 86400) . '.' . $version;
    return $payload . '.' . hash_hmac('sha256', $payload, $secret);
}

function tvatt_read_session($token, string $secret, array $users, int $nowTs): ?string
{
    if (!is_string($token)) return null;
    $parts = explode('.', $token);
    if (count($parts) !== 4) return null;
    [$apartmentId, $expires, $version, $sig] = $parts;
    if (!hash_equals(hash_hmac('sha256', "$apartmentId.$expires.$version", $secret), $sig)) return null;
    if ((int) $expires < $nowTs) return null;
    $user = $users[$apartmentId] ?? null;
    if (!$user || (string) ($user['version'] ?? 0) !== $version) return null;
    return $apartmentId;
}

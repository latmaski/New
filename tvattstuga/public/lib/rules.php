<?php
// Ren bokningslogik. All tid räknas i lokal tid (Europe/Stockholm) som
// "timindex" = timmar sedan 1970-01-01 00:00 lokal tid. Sommartidsbyten sker
// kl 02–03, utanför öppettiderna, så vanlig timaritmetik räcker.
defined('TVATT') || exit;

function tvatt_local_now(string $timezone, int $ts): array
{
    $d = new DateTime('@' . $ts);
    $d->setTimezone(new DateTimeZone($timezone));
    return ['date' => $d->format('Y-m-d'), 'hour' => (int) $d->format('G'), 'minute' => (int) $d->format('i')];
}

function tvatt_is_valid_date($date): bool
{
    if (!is_string($date) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m)) return false;
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}

function tvatt_add_days(string $date, int $days): string
{
    $d = new DateTime($date . ' 00:00:00', new DateTimeZone('UTC'));
    $d->modify(($days >= 0 ? '+' : '') . $days . ' days');
    return $d->format('Y-m-d');
}

function tvatt_hour_index(string $date, int $hour): int
{
    $d = new DateTime($date . ' 00:00:00', new DateTimeZone('UTC'));
    return intdiv($d->getTimestamp(), 3600) + $hour;
}

function tvatt_now_index(array $now): float
{
    return tvatt_hour_index($now['date'], $now['hour']) + $now['minute'] / 60;
}

function tvatt_is_active(array $booking, array $now, array $config): bool
{
    return tvatt_hour_index($booking['date'], $booking['startHour']) + $config['passHours'] > tvatt_now_index($now);
}

function tvatt_active_bookings_for(array $bookings, string $apartmentId, array $now, array $config): array
{
    return array_values(array_filter($bookings, function ($b) use ($apartmentId, $now, $config) {
        return (string) $b['apartmentId'] === $apartmentId && tvatt_is_active($b, $now, $config);
    }));
}

function tvatt_pad(int $h): string
{
    return str_pad((string) $h, 2, '0', STR_PAD_LEFT);
}

// Returnerar null om bokningen är tillåten, annars ett felmeddelande.
function tvatt_validate_booking(array $bookings, string $apartmentId, $date, $startHour, array $now, array $config): ?string
{
    if (!tvatt_is_valid_date($date)) return 'Ogiltigt datum.';
    if (!is_int($startHour)) return 'Ogiltig starttid.';
    $open = $config['openHour'];
    $close = $config['closeHour'];
    $pass = $config['passHours'];
    if ($startHour < $open || $startHour + $pass > $close) {
        return 'Pass måste starta mellan ' . tvatt_pad($open) . ':00 och ' . tvatt_pad($close - $pass) . ':00.';
    }

    // Innevarande timme får bokas (man kan boka "nu"), men inte tidigare än så.
    $start = tvatt_hour_index($date, $startHour);
    if ($start < tvatt_hour_index($now['date'], $now['hour'])) return 'Det går inte att boka en tid som redan passerat.';
    if ($date > tvatt_add_days($now['date'], $config['bookingHorizonDays'])) {
        return 'Du kan boka högst ' . $config['bookingHorizonDays'] . ' dagar fram.';
    }

    $end = $start + $pass;
    foreach ($bookings as $b) {
        $bStart = tvatt_hour_index($b['date'], $b['startHour']);
        if ($bStart < $end && $start < $bStart + $pass) return 'Tiden krockar med en annan bokning.';
    }

    if (count(tvatt_active_bookings_for($bookings, $apartmentId, $now, $config)) >= $config['maxActiveBookings']) {
        return 'Du har redan ' . $config['maxActiveBookings'] . ' pass bokade. Avboka ett eller vänta tills ett passerat.';
    }
    return null;
}

function tvatt_validate_cancel(?array $booking, string $apartmentId, array $now, array $config): ?string
{
    if (!$booking) return 'Bokningen finns inte.';
    if ((string) $booking['apartmentId'] !== $apartmentId) return 'Du kan bara avboka dina egna pass.';
    if (!tvatt_is_active($booking, $now, $config)) return 'Passet har redan passerat.';
    return null;
}

// Flytt av ett eget pass som inte har börjat. Det nya passet prövas mot
// samma regler som en ny bokning, men utan det gamla passet.
function tvatt_validate_move(array $bookings, ?array $booking, string $apartmentId, $date, $startHour, array $now, array $config): ?string
{
    if (!$booking) return 'Bokningen finns inte.';
    if ((string) $booking['apartmentId'] !== $apartmentId) return 'Du kan bara ändra dina egna pass.';
    if (tvatt_hour_index($booking['date'], $booking['startHour']) < tvatt_now_index($now)) {
        return 'Passet har redan börjat och kan inte flyttas.';
    }
    $others = array_values(array_filter($bookings, function ($b) use ($booking) { return $b['id'] !== $booking['id']; }));
    return tvatt_validate_booking($others, $apartmentId, $date, $startHour, $now, $config);
}

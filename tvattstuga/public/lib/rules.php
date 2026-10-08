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

// Ett pass är normalt passHours långt, men kan vara kortare (fältet "hours").
function tvatt_booking_hours(array $booking, array $config): int
{
    return (int) ($booking['hours'] ?? $config['passHours']);
}

function tvatt_is_active(array $booking, array $now, array $config): bool
{
    return tvatt_hour_index($booking['date'], $booking['startHour']) + tvatt_booking_hours($booking, $config) > tvatt_now_index($now);
}

// Antal lediga timmar från startHour fram till nästa pass eller stängning.
// 0 om startHour ligger inne i ett befintligt pass.
function tvatt_available_hours(array $bookings, string $date, int $startHour, array $config): int
{
    $limit = $config['closeHour'];
    foreach ($bookings as $b) {
        if ($b['date'] !== $date) continue;
        $bStart = (int) $b['startHour'];
        if ($bStart <= $startHour && $startHour < $bStart + tvatt_booking_hours($b, $config)) return 0;
        if ($bStart > $startHour && $bStart < $limit) $limit = $bStart;
    }
    return max(0, $limit - $startHour);
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

// Prövar en bokning. Returnerar ['error' => ?string, 'hours' => int].
// Får ett helt pass inte plats (annat pass eller stängning i vägen) blir det
// ett kortare pass, men bara om klienten skickat just det antalet timmar –
// så att användaren har sett och godkänt längden.
function tvatt_check_booking(array $bookings, string $apartmentId, $date, $startHour, $hours, array $now, array $config): array
{
    $fail = function (string $error) { return ['error' => $error, 'hours' => 0]; };
    if (!tvatt_is_valid_date($date)) return $fail('Ogiltigt datum.');
    if (!is_int($startHour)) return $fail('Ogiltig starttid.');
    if ($hours !== null && !is_int($hours)) return $fail('Ogiltig längd.');
    $open = $config['openHour'];
    $close = $config['closeHour'];
    $pass = $config['passHours'];
    $min = $config['minPassHours'] ?? $pass;
    if ($startHour < $open || $startHour + $min > $close) {
        return $fail('Pass måste starta mellan ' . tvatt_pad($open) . ':00 och ' . tvatt_pad($close - $min) . ':00.');
    }

    // Innevarande timme får bokas (man kan boka "nu"), men inte tidigare än så.
    if (tvatt_hour_index($date, $startHour) < tvatt_hour_index($now['date'], $now['hour'])) {
        return $fail('Det går inte att boka en tid som redan passerat.');
    }
    if ($date > tvatt_add_days($now['date'], $config['bookingHorizonDays'])) {
        return $fail('Du kan boka högst ' . $config['bookingHorizonDays'] . ' dagar fram.');
    }

    $available = tvatt_available_hours($bookings, $date, $startHour, $config);
    if ($available <= 0) return $fail('Tiden krockar med en annan bokning.');
    if ($available < $min) return $fail("Det finns bara $available h ledigt här, minst $min h krävs.");
    $allowed = min($pass, $available);
    if ($hours === null && $allowed < $pass) {
        return $fail("Här finns bara $allowed h ledigt. Bekräfta att du vill boka ett kortare pass.");
    }
    if ($hours !== null && $hours !== $allowed) {
        return $fail('Den lediga tiden har ändrats. Ladda om och försök igen.');
    }

    if (count(tvatt_active_bookings_for($bookings, $apartmentId, $now, $config)) >= $config['maxActiveBookings']) {
        return $fail('Du har redan ' . $config['maxActiveBookings'] . ' pass bokade. Avboka ett eller vänta tills ett passerat.');
    }
    return ['error' => null, 'hours' => $allowed];
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
function tvatt_check_move(array $bookings, ?array $booking, string $apartmentId, $date, $startHour, $hours, array $now, array $config): array
{
    $fail = function (string $error) { return ['error' => $error, 'hours' => 0]; };
    if (!$booking) return $fail('Bokningen finns inte.');
    if ((string) $booking['apartmentId'] !== $apartmentId) return $fail('Du kan bara ändra dina egna pass.');
    if (tvatt_hour_index($booking['date'], $booking['startHour']) < tvatt_now_index($now)) {
        return $fail('Passet har redan börjat och kan inte flyttas.');
    }
    $others = array_values(array_filter($bookings, function ($b) use ($booking) { return $b['id'] !== $booking['id']; }));
    return tvatt_check_booking($others, $apartmentId, $date, $startHour, $hours, $now, $config);
}

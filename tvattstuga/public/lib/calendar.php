<?php
// Kalenderfiler (iCalendar/.ics) så att de boende får sina pass och
// påminnelser i mobilens kalender – antingen som prenumeration (synkas
// automatiskt) eller ett enskilt pass i taget.
defined('TVATT') || exit;

const TVATT_REMINDER_OPTIONS = [15, 30, 60, 120, 180, 1440];
const TVATT_REMINDER_DEFAULT = 60;

// Lägenhetens kalenderinställningar; skapar en hemlig länk-nyckel vid behov.
function tvatt_calendar_for(TvattStore $store, string $apartmentId): array
{
    $cal = $store->data['calendars'][$apartmentId] ?? [];
    if (empty($cal['token'])) {
        $cal = ['token' => bin2hex(random_bytes(16)), 'reminderMinutes' => $cal['reminderMinutes'] ?? TVATT_REMINDER_DEFAULT];
        $store->data['calendars'][$apartmentId] = $cal;
        $store->save();
    }
    return $cal;
}

function tvatt_calendar_by_token(TvattStore $store, string $token): ?string
{
    foreach ($store->data['calendars'] ?? [] as $id => $cal) {
        if (!empty($cal['token']) && hash_equals($cal['token'], $token)) return (string) $id;
    }
    return null;
}

function tvatt_base_url(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $pos = strpos($path, '/api/');
    $base = $pos === false ? '/' : substr($path, 0, $pos + 1);
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $base;
}

function tvatt_ics_escape(string $text): string
{
    return str_replace(["\\", ';', ',', "\r\n", "\n"], ["\\\\", '\;', '\,', '\n', '\n'], $text);
}

// Raderna får vara högst 75 byte; längre rader viks utan att dela tecken.
function tvatt_ics_fold(string $line): string
{
    $out = '';
    $first = true;
    while (strlen($line) > ($first ? 75 : 74)) {
        $max = $first ? 75 : 74;
        $chunk = function_exists('mb_strcut') ? mb_strcut($line, 0, $max, 'UTF-8') : substr($line, 0, $max);
        $out .= ($first ? '' : ' ') . $chunk . "\r\n";
        $line = substr($line, strlen($chunk));
        $first = false;
    }
    return $out . ($first ? '' : ' ') . $line . "\r\n";
}

function tvatt_ics_utc(string $date, int $hour, string $timezone): string
{
    $d = new DateTime(sprintf('%s %02d:00:00', $date, $hour), new DateTimeZone($timezone));
    $d->setTimezone(new DateTimeZone('UTC'));
    return $d->format('Ymd\THis\Z');
}

function tvatt_reminder_text(int $minutes): string
{
    if ($minutes >= 1440) return 'imorgon';
    if ($minutes >= 60) return 'om ' . ($minutes / 60) . ($minutes === 60 ? ' timme' : ' timmar');
    return "om $minutes minuter";
}

function tvatt_ics(array $bookings, string $calName, int $reminderMinutes, array $config, int $ts, bool $feed): string
{
    $host = parse_url(tvatt_base_url(), PHP_URL_HOST) ?: 'tvattstugan';
    $lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tvattstugan//' . tvatt_ics_escape($config['name']) . '//SV',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ];
    if ($feed) {
        array_push($lines, 'X-WR-CALNAME:' . tvatt_ics_escape($calName), 'X-WR-TIMEZONE:' . $config['timezone'],
            'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H');
    }
    foreach ($bookings as $b) {
        $hours = tvatt_booking_hours($b, $config);
        $time = tvatt_pad((int) $b['startHour']) . ':00–' . tvatt_pad((int) $b['startHour'] + $hours) . ':00';
        array_push($lines,
            'BEGIN:VEVENT',
            'UID:' . $b['id'] . '@' . $host,
            'DTSTAMP:' . gmdate('Ymd\THis\Z', $ts),
            'DTSTART:' . tvatt_ics_utc($b['date'], (int) $b['startHour'], $config['timezone']),
            'DTEND:' . tvatt_ics_utc($b['date'], (int) $b['startHour'] + $hours, $config['timezone']),
            'SUMMARY:' . tvatt_ics_escape('Tvättstugan ' . $time),
            'LOCATION:' . tvatt_ics_escape($config['name']),
            'DESCRIPTION:' . tvatt_ics_escape("Ditt tvättpass $time. Ändra eller avboka: " . tvatt_base_url()),
            'URL:' . tvatt_base_url(),
            'BEGIN:VALARM', 'ACTION:DISPLAY',
            'DESCRIPTION:' . tvatt_ics_escape('Tvättstugan ' . tvatt_reminder_text($reminderMinutes) . " ($time)"),
            'TRIGGER:-PT' . $reminderMinutes . 'M',
            'END:VALARM',
            'END:VEVENT'
        );
    }
    $lines[] = 'END:VCALENDAR';
    return implode('', array_map('tvatt_ics_fold', $lines));
}

function tvatt_send_ics(string $ics, ?string $filename): void
{
    header('Content-Type: text/calendar; charset=utf-8');
    if ($filename) header('Content-Disposition: attachment; filename="' . $filename . '"');
    http_response_code(200);
    echo $ics;
}

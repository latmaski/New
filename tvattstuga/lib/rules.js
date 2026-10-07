'use strict';

// Ren bokningslogik. All tid räknas i lokal tid (Europe/Stockholm) som
// "timindex" = timmar sedan 1970-01-01 00:00 lokal tid. Sommartidsbyten sker
// kl 02–03, utanför öppettiderna, så vanlig timaritmetik räcker.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function localNow(timezone, date = new Date()) {
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isValidDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hourIndex(date, hour) {
  return Date.parse(`${date}T00:00:00Z`) / 3600000 + hour;
}

function nowIndex(now) {
  return hourIndex(now.date, now.hour) + now.minute / 60;
}

function bookingEnd(booking, config) {
  return hourIndex(booking.date, booking.startHour) + config.passHours;
}

function isActive(booking, now, config) {
  return bookingEnd(booking, config) > nowIndex(now);
}

function activeBookingsFor(bookings, apartmentId, now, config) {
  return bookings.filter((b) => b.apartmentId === apartmentId && isActive(b, now, config));
}

// Returnerar null om bokningen är tillåten, annars ett felmeddelande.
function validateBooking({ bookings, apartmentId, date, startHour, now, config }) {
  if (!isValidDate(date)) return 'Ogiltigt datum.';
  if (!Number.isInteger(startHour)) return 'Ogiltig starttid.';
  const { openHour, closeHour, passHours } = config;
  if (startHour < openHour || startHour + passHours > closeHour) {
    const lastStart = String(closeHour - passHours).padStart(2, '0');
    return `Pass måste starta mellan ${String(openHour).padStart(2, '0')}:00 och ${lastStart}:00.`;
  }

  // Innevarande timme får bokas (man kan boka "nu"), men inte tidigare än så.
  const start = hourIndex(date, startHour);
  if (start < hourIndex(now.date, now.hour)) return 'Det går inte att boka en tid som redan passerat.';
  if (date > addDays(now.date, config.bookingHorizonDays)) {
    return `Du kan boka högst ${config.bookingHorizonDays} dagar fram.`;
  }

  const end = start + passHours;
  const clash = bookings.find((b) => {
    const bStart = hourIndex(b.date, b.startHour);
    return bStart < end && start < bStart + passHours;
  });
  if (clash) return 'Tiden krockar med en annan bokning.';

  if (activeBookingsFor(bookings, apartmentId, now, config).length >= config.maxActiveBookings) {
    return `Du har redan ${config.maxActiveBookings} pass bokade. Avboka ett eller vänta tills ett passerat.`;
  }
  return null;
}

function validateCancel({ booking, apartmentId, now, config }) {
  if (!booking) return 'Bokningen finns inte.';
  if (booking.apartmentId !== apartmentId) return 'Du kan bara avboka dina egna pass.';
  if (!isActive(booking, now, config)) return 'Passet har redan passerat.';
  return null;
}

module.exports = {
  localNow, isValidDate, addDays, hourIndex, nowIndex, bookingEnd, isActive,
  activeBookingsFor, validateBooking, validateCancel,
};

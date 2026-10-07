'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
const rules = require('../lib/rules');

const now = { date: '2026-10-07', hour: 12, minute: 30 };
const book = (apartmentId, date, startHour) => ({ id: `${date}-${startHour}`, apartmentId, date, startHour });
const check = (bookings, apartmentId, date, startHour, n = now) =>
  rules.validateBooking({ bookings, apartmentId, date, startHour, now: n, config });

test('localNow räknar i svensk tid, även över sommartid', () => {
  assert.deepEqual(rules.localNow('Europe/Stockholm', new Date('2026-07-01T04:00:00Z')), { date: '2026-07-01', hour: 6, minute: 0 });
  assert.deepEqual(rules.localNow('Europe/Stockholm', new Date('2026-12-31T22:15:00Z')), { date: '2026-12-31', hour: 23, minute: 15 });
});

test('pass måste ligga inom 06–23', () => {
  assert.equal(check([], '1', '2026-10-08', 6), null);
  assert.equal(check([], '1', '2026-10-08', 19), null);
  assert.match(check([], '1', '2026-10-08', 5), /mellan 06:00 och 19:00/);
  assert.match(check([], '1', '2026-10-08', 20), /mellan 06:00 och 19:00/);
  assert.match(check([], '1', '2026-10-08', 7.5), /Ogiltig starttid/);
  assert.match(check([], '1', '2026-02-30', 8), /Ogiltigt datum/);
});

test('innevarande timme går att boka men inte tidigare', () => {
  assert.equal(check([], '1', '2026-10-07', 12), null);
  assert.match(check([], '1', '2026-10-07', 11), /passerat/);
  assert.match(check([], '1', '2026-10-06', 14), /passerat/);
});

test('bokningshorisont', () => {
  assert.equal(check([], '1', rules.addDays(now.date, config.bookingHorizonDays), 8), null);
  assert.match(check([], '1', rules.addDays(now.date, config.bookingHorizonDays + 1), 8), /dagar fram/);
});

test('överlappande pass nekas, angränsande tillåts', () => {
  const existing = [book('2', '2026-10-08', 10)]; // 10–14
  assert.match(check(existing, '1', '2026-10-08', 7), /krockar/); // 07–11
  assert.match(check(existing, '1', '2026-10-08', 13), /krockar/); // 13–17
  assert.match(check(existing, '1', '2026-10-08', 10), /krockar/);
  assert.equal(check(existing, '1', '2026-10-08', 6), null); // 06–10
  assert.equal(check(existing, '1', '2026-10-08', 14), null); // 14–18
  assert.equal(check(existing, '1', '2026-10-09', 10), null); // annan dag
});

test('max två aktiva pass per lägenhet', () => {
  const two = [book('1', '2026-10-08', 6), book('1', '2026-10-09', 6)];
  assert.match(check(two, '1', '2026-10-10', 6), /redan 2 pass/);
  assert.equal(check(two, '2', '2026-10-10', 6), null); // andra lägenheter påverkas inte

  // Ett pass som redan är slut räknas inte; ett pågående gör det.
  const finished = [book('1', '2026-10-07', 6), book('1', '2026-10-09', 6)]; // 06–10 idag är slut 12:30
  assert.equal(check(finished, '1', '2026-10-10', 6), null);
  const ongoing = [book('1', '2026-10-07', 10), book('1', '2026-10-09', 6)]; // 10–14 pågår
  assert.match(check(ongoing, '1', '2026-10-10', 6), /redan 2 pass/);
});

test('avbokning', () => {
  const mine = book('1', '2026-10-08', 6);
  assert.equal(rules.validateCancel({ booking: mine, apartmentId: '1', now, config }), null);
  assert.match(rules.validateCancel({ booking: mine, apartmentId: '2', now, config }), /egna/);
  assert.match(rules.validateCancel({ booking: book('1', '2026-10-07', 6), apartmentId: '1', now, config }), /passerat/);
  assert.match(rules.validateCancel({ booking: undefined, apartmentId: '1', now, config }), /finns inte/);
});

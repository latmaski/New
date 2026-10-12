'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('hyresvärden loggar in och ser statistik per lägenhet', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const a = await env.login('1');
  const b = await env.login('2');
  await a('POST', '/api/bookings', { date: '2026-10-07', startHour: 12 });
  await a('POST', '/api/bookings', { date: '2026-10-08', startHour: 6 });
  await b('POST', '/api/bookings', { date: '2026-11-02', startHour: 6 });
  env.setClock('2026-10-08T11:00:00+02:00'); // båda lgh 1:s pass har passerat
  await a('POST', '/api/bookings', { date: '2026-10-09', startHour: 6 });

  const admin = await env.login('admin');
  const me = await admin('GET', '/api/me');
  assert.deepEqual(me.body, { name: 'Hyresvärd' });

  const stats = await admin('GET', '/api/properties/pukevagen/stats');
  assert.equal(stats.status, 200);
  assert.equal(stats.body.apartments.length, 5);
  const [l1, l2, l3] = stats.body.apartments;
  assert.deepEqual(l1.months, { '2026-10': 3 });
  assert.deepEqual(l1.monthHours, { '2026-10': 12 });
  assert.equal(l1.totalHours, 12);
  assert.equal(l1.total, 3);
  assert.equal(l1.upcoming, 1);
  assert.deepEqual(l2.months, { '2026-11': 1 });
  assert.deepEqual(l3.months, {});

  // Hyresvärdens inloggning gäller inte på bokningssidan, och utan den nås inte administrationen.
  assert.equal((await admin('POST', '/pukevagen/api/bookings', { date: '2026-10-20', startHour: 8 })).status, 401);
  assert.equal((await env.client('')('GET', '/api/properties/pukevagen/stats')).status, 401);
  assert.equal((await a('GET', '/api/properties/pukevagen/stats')).status, 404);
});

test('hyresvärden ger en lägenhet nytt lösenord, med eller utan avbokning', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const resident = await env.login('3');
  await resident('POST', '/api/bookings', { date: '2026-10-07', startHour: 12 }); // pågår
  await resident('POST', '/api/bookings', { date: '2026-10-10', startHour: 8 }); // kommande
  const admin = await env.login('admin');

  assert.equal((await admin('POST', '/api/properties/pukevagen/reset-password', { apartmentId: '9' })).status, 400);

  const forgot = await admin('POST', '/api/properties/pukevagen/reset-password', { apartmentId: '3' });
  assert.equal(forgot.status, 200);
  assert.equal(forgot.body.cancelled, 0);
  assert.match(forgot.body.password, /^[a-z0-9]{10}$/);
  assert.equal((await resident('GET', '/api/me')).status, 401); // utloggad
  const back = env.client();
  assert.equal((await back('POST', '/api/login', { apartmentId: '3', password: env.passwords['3'] })).status, 401);
  assert.equal((await back('POST', '/api/login', { apartmentId: '3', password: forgot.body.password })).status, 200);
  assert.equal((await back('GET', '/api/bookings')).body.mine.length, 2);

  const moved = await admin('POST', '/api/properties/pukevagen/reset-password', { apartmentId: '3', cancelUpcoming: true });
  assert.equal(moved.body.cancelled, 1);
  const stats = await admin('GET', '/api/properties/pukevagen/stats');
  assert.equal(stats.body.apartments[2].total, 1); // det pågående passet står kvar
  const fresh = env.client();
  await fresh('POST', '/api/login', { apartmentId: '3', password: moved.body.password });
  assert.equal((await fresh('GET', '/api/bookings')).body.mine.length, 1);

  // Hyresvärden kan byta sitt eget lösenord.
  assert.equal((await admin('POST', '/api/password', { currentPassword: env.passwords.admin, newPassword: 'vard12345' })).status, 200);
  assert.equal((await env.client('')('POST', '/api/login', { password: 'vard12345' })).status, 200);
  assert.equal((await env.client('')('POST', '/api/login', { password: env.passwords.admin })).status, 401);
});

test('hyresvärden ändrar bokningsreglerna', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const admin = await env.login('admin');
  const res = await env.login('1');
  const book = (c, date, startHour, hours) => c('POST', '/api/bookings', { date, startHour, hours });
  const before = await book(res, '2026-10-10', 6); // giltigt enligt standardreglerna
  assert.equal(before.status, 201);

  const current = await admin('GET', '/api/properties/pukevagen/rules');
  assert.deepEqual(current.body.rules, {
    openHour: 6, closeHour: 23, passHours: 4, minPassHours: 1, maxActiveBookings: 2, bookingHorizonDays: 28,
    days: Array(7).fill([6, 23]),
  });

  const rules = { openHour: 7, closeHour: 22, passHours: 3, minPassHours: 3, maxActiveBookings: 3, bookingHorizonDays: 14 };
  const bad = [
    [{ ...rules, closeHour: 7 }, /efter öppningstiden/],
    [{ ...rules, passHours: 16 }, /rymmas inom öppettiden/],
    [{ ...rules, minPassHours: 4 }, /Kortaste pass/],
    [{ ...rules, maxActiveBookings: 0 }, /Max antal pass/],
    [{ ...rules, bookingHorizonDays: '14' }, /heltal/],
  ];
  for (const [body, msg] of bad) assert.match((await admin('POST', '/api/properties/pukevagen/rules', body)).body.error, msg);
  assert.equal((await env.client('')('POST', '/api/properties/pukevagen/rules', rules)).status, 401);

  assert.equal((await admin('POST', '/api/properties/pukevagen/rules', rules)).status, 200);
  assert.deepEqual((await env.client()('GET', '/api/config')).body.passHours, 3);
  assert.deepEqual((await res('GET', '/api/bookings')).body.rules, { ...rules, days: Array(7).fill([7, 22]) });

  // Nya regler gäller för nya bokningar; det gamla passet 06–10 står kvar.
  assert.match((await book(res, '2026-10-11', 6)).body.error, /mellan 07:00 och 19:00/);
  const p = await book(res, '2026-10-11', 7);
  assert.deepEqual([p.status, p.body.endHour], [201, 10]);
  assert.equal((await book(res, '2026-10-11', 19)).body.endHour, 22);
  assert.match((await book(res, '2026-10-12', 8)).body.error, /redan 3 pass/);
  assert.match((await book(await env.login('2'), '2026-10-22', 8)).body.error, /14 dagar fram/);
  // Ingen kort lucka tillåts när kortaste pass = passets längd.
  assert.match((await book(await env.login('2'), '2026-10-11', 17, 2)).body.error, /bara 2 h ledigt här, minst 3 h/);
  const list = (await res('GET', '/api/bookings?from=2026-10-10&to=2026-10-10')).body.bookings;
  assert.deepEqual([list[0].startHour, list[0].endHour], [6, 10]);

  // Återställ till standard.
  assert.equal((await admin('DELETE', '/api/properties/pukevagen/rules')).body.rules.passHours, 4);
  assert.equal((await env.client()('GET', '/api/config')).body.closeHour, 23);
});

test('olika öppettider olika dagar', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00'); // onsdag
  t.after(env.close);
  const admin = await env.admin();
  const base = { passHours: 4, minPassHours: 1, maxActiveBookings: 3, bookingHorizonDays: 28 };
  const weekdays = [6, 23];
  // mån–fre 06–23, lördag 08–18, söndag stängt
  const days = [weekdays, weekdays, weekdays, weekdays, weekdays, [8, 18], null];
  const post = (body) => admin('POST', '/api/properties/pukevagen/rules', body);

  assert.match((await post({ ...base, days: [...days.slice(0, 6)] })).body.error, /sju dagar/);
  assert.match((await post({ ...base, days: Array(7).fill(null) })).body.error, /Minst en dag/);
  assert.match((await post({ ...base, days: [...days.slice(0, 5), [18, 8], null] })).body.error, /lördag.*efter öppningstiden/);
  assert.match((await post({ ...base, days: [...days.slice(0, 5), [8, 8.5], null] })).body.error, /lördag/);
  assert.match((await post({ ...base, passHours: 2, minPassHours: 2, days: [...days.slice(0, 5), [8, 9], null] })).body.error, /lördag.*kortare tid än kortaste pass/);
  const saved = await post({ ...base, days });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.rules.days, days);
  assert.deepEqual([saved.body.rules.openHour, saved.body.rules.closeHour], [6, 23]);

  const r = await env.login('1');
  const book = (date, startHour, hours) => r('POST', '/api/bookings', { date, startHour, hours });
  // Söndag 11/10: stängt.
  assert.match((await book('2026-10-11', 10)).body.error, /stängd den dagen/);
  // Lördag 10/10: 08–18, sista hela pass 14, kort pass fram till 18.
  assert.match((await book('2026-10-10', 7)).body.error, /mellan 08:00 och 17:00/);
  assert.equal((await book('2026-10-10', 14)).body.endHour, 18);
  assert.match((await book('2026-10-10', 18)).body.error, /mellan 08:00 och 17:00/);
  // Fredag 9/10: vanliga tider, kort pass före stängning 23.
  assert.equal((await book('2026-10-09', 20, 3)).body.endHour, 23);
  // Flytt till en stängd dag nekas.
  const p = (await r('GET', '/api/bookings?from=2026-10-09&to=2026-10-09')).body.bookings[0];
  assert.match((await r('POST', `/api/bookings/${p.id}`, { date: '2026-10-11', startHour: 10 })).body.error, /stängd/);
  // De boende får schemat.
  assert.deepEqual((await r('GET', '/api/bookings')).body.rules.days, days);
});

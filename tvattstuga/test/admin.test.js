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
  assert.deepEqual(me.body, { apartmentId: 'admin', apartmentName: 'Hyresvärd', isAdmin: true });

  const stats = await admin('GET', '/api/admin/stats');
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

  // Hyresvärden kan inte boka, och boende kommer inte åt admin.
  assert.equal((await admin('POST', '/api/bookings', { date: '2026-10-20', startHour: 8 })).status, 403);
  assert.equal((await a('GET', '/api/admin/stats')).status, 403);
  assert.equal((await env.client()('GET', '/api/admin/stats')).status, 401);
});

test('hyresvärden ger en lägenhet nytt lösenord, med eller utan avbokning', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const resident = await env.login('3');
  await resident('POST', '/api/bookings', { date: '2026-10-07', startHour: 12 }); // pågår
  await resident('POST', '/api/bookings', { date: '2026-10-10', startHour: 8 }); // kommande
  const admin = await env.login('admin');

  assert.equal((await admin('POST', '/api/admin/reset-password', { apartmentId: '9' })).status, 400);

  const forgot = await admin('POST', '/api/admin/reset-password', { apartmentId: '3' });
  assert.equal(forgot.status, 200);
  assert.equal(forgot.body.cancelled, 0);
  assert.match(forgot.body.password, /^[a-z0-9]{10}$/);
  assert.equal((await resident('GET', '/api/me')).status, 401); // utloggad
  const back = env.client();
  assert.equal((await back('POST', '/api/login', { apartmentId: '3', password: env.passwords['3'] })).status, 401);
  assert.equal((await back('POST', '/api/login', { apartmentId: '3', password: forgot.body.password })).status, 200);
  assert.equal((await back('GET', '/api/bookings')).body.mine.length, 2);

  const moved = await admin('POST', '/api/admin/reset-password', { apartmentId: '3', cancelUpcoming: true });
  assert.equal(moved.body.cancelled, 1);
  const stats = await admin('GET', '/api/admin/stats');
  assert.equal(stats.body.apartments[2].total, 1); // det pågående passet står kvar
  const fresh = env.client();
  await fresh('POST', '/api/login', { apartmentId: '3', password: moved.body.password });
  assert.equal((await fresh('GET', '/api/bookings')).body.mine.length, 1);

  // Hyresvärden kan byta sitt eget lösenord.
  assert.equal((await admin('POST', '/api/password', { currentPassword: env.passwords.admin, newPassword: 'vard12345' })).status, 200);
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: 'admin', password: 'vard12345' })).status, 200);
});

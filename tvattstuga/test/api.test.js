'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setup } = require('./helpers');

test('fem inloggningar skapas och lösenord krävs', async (t) => {
  const env = await setup();
  t.after(env.close);
  assert.deepEqual(Object.keys(env.passwords).sort(), ['1', '2', '3', '4', '5', 'admin']);
  const c = env.client();
  assert.equal((await c('GET', '/api/bookings')).status, 401);
  assert.equal((await c('POST', '/api/login', { apartmentId: '1', password: 'fel' })).status, 401);
  assert.equal((await c('POST', '/api/login', { apartmentId: '1', password: env.passwords['2'] })).status, 401);
  const ok = await c('POST', '/api/login', { apartmentId: '1', password: env.passwords['1'] });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/i);
  assert.deepEqual((await c('GET', '/api/me')).body, { apartmentId: '1', apartmentName: 'Lägenhet 1' });
  await c('POST', '/api/logout');
  assert.equal((await c('GET', '/api/me')).status, 401);
});

test('boka, max två, krockar och avboka', async (t) => {
  const env = await setup();
  t.after(env.close);
  const a = await env.login('1');
  const b = await env.login('2');

  const first = await a('POST', '/api/bookings', { date: '2026-10-08', startHour: 6 });
  assert.equal(first.status, 201);
  assert.equal(first.body.endHour, 10);
  assert.equal((await a('POST', '/api/bookings', { date: '2026-10-08', startHour: 14 })).status, 201);
  const third = await a('POST', '/api/bookings', { date: '2026-10-09', startHour: 6 });
  assert.equal(third.status, 409);
  assert.match(third.body.error, /redan 2 pass/);

  const clash = await b('POST', '/api/bookings', { date: '2026-10-08', startHour: 8 });
  assert.equal(clash.status, 409);
  assert.match(clash.body.error, /krockar/);
  assert.equal((await b('POST', '/api/bookings', { date: '2026-10-08', startHour: 10 })).status, 201);

  const list = await b('GET', '/api/bookings?from=2026-10-05&to=2026-10-11');
  assert.equal(list.body.bookings.length, 3);
  assert.equal(list.body.mine.length, 1);
  assert.deepEqual(list.body.now, { date: '2026-10-07', hour: 12, minute: 30 });
  assert.equal(list.body.bookings.find((x) => x.startHour === 6).apartmentName, 'Lägenhet 1');
  assert.equal(list.body.bookings.find((x) => x.startHour === 6).mine, false);

  assert.equal((await b('DELETE', `/api/bookings/${first.body.id}`)).status, 403);
  assert.equal((await a('DELETE', `/api/bookings/${first.body.id}`)).status, 200);
  assert.equal((await a('DELETE', `/api/bookings/${first.body.id}`)).status, 404);
  assert.equal((await a('POST', '/api/bookings', { date: '2026-10-09', startHour: 6 })).status, 201);

  // Ett pågående pass räknas, ett avslutat gör det inte.
  env.setClock('2026-10-08T17:59:00+02:00'); // 14–18-passet pågår
  assert.match((await a('POST', '/api/bookings', { date: '2026-10-10', startHour: 19 })).body.error, /redan 2 pass/);
  env.setClock('2026-10-08T18:00:00+02:00'); // nu är det slut
  assert.equal((await a('POST', '/api/bookings', { date: '2026-10-10', startHour: 19 })).status, 201);
  const ended = list.body.bookings.find((x) => x.startHour === 14);
  assert.match((await a('DELETE', `/api/bookings/${ended.id}`)).body.error, /passerat/);

  assert.equal(JSON.parse(fs.readFileSync(env.dataFile, 'utf8')).bookings.length, 4);
});

test('samtidiga bokningar av samma tid ger bara en vinnare', async (t) => {
  const env = await setup();
  t.after(env.close);
  const clients = await Promise.all(['1', '2', '3', '4', '5'].map((id) => env.login(id)));
  const results = await Promise.all(clients.map((c) => c('POST', '/api/bookings', { date: '2026-10-12', startHour: 9 })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
});

test('lösenordsbyte loggar ut andra sessioner', async (t) => {
  const env = await setup();
  t.after(env.close);
  const phone = await env.login('3');
  const laptop = await env.login('3');
  assert.equal((await phone('POST', '/api/password', { currentPassword: 'fel', newPassword: 'nyttlosen' })).status, 400);
  assert.equal((await phone('POST', '/api/password', { currentPassword: env.passwords['3'], newPassword: 'kort' })).status, 400);
  assert.equal((await phone('POST', '/api/password', { currentPassword: env.passwords['3'], newPassword: 'nyttlosen' })).status, 200);
  assert.equal((await phone('GET', '/api/me')).status, 200);
  assert.equal((await laptop('GET', '/api/me')).status, 401);
  assert.equal((await laptop('POST', '/api/login', { apartmentId: '3', password: 'nyttlosen' })).status, 200);
});

test('återställning via aterstall.txt och set-password.php', async (t) => {
  const env = await setup();
  t.after(env.close);
  const admin = await env.admin();
  assert.equal((await admin('GET', '/api/me')).status, 200);
  fs.writeFileSync(path.join(env.dataDir, 'aterstall.txt'), 'admin\n');
  assert.equal((await admin('GET', '/api/me')).status, 401); // utloggad
  const newPw = env.readPasswords().admin;
  assert.notEqual(newPw, env.passwords.admin);
  assert.ok(!fs.existsSync(path.join(env.dataDir, 'aterstall.txt')));
  assert.equal((await env.client('')('POST', '/api/login', { password: newPw })).status, 200);

  const run = (...args) => execFileSync('php', [path.join(__dirname, '..', 'scripts', 'set-password.php'), ...args], {
    env: { ...process.env, TVATT_DATA_DIR: env.dataDir },
  }).toString();
  assert.match(run('pukevagen', '4', 'hemligt123'), /Stora Pukevägen 12, Lägenhet 4: hemligt123/);
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: '4', password: 'hemligt123' })).status, 200);
  assert.match(run('admin', 'vardensnya'), /Hyresvärd: vardensnya/);
  assert.equal((await env.client('')('POST', '/api/login', { password: 'vardensnya' })).status, 200);
});

test('för många felaktiga inloggningar spärras tillfälligt', async (t) => {
  const env = await setup();
  t.after(env.close);
  const c = env.client();
  for (let i = 0; i < 10; i++) await c('POST', '/api/login', { apartmentId: '1', password: 'fel' });
  assert.equal((await c('POST', '/api/login', { apartmentId: '1', password: env.passwords['1'] })).status, 429);
  env.setClock('2026-10-07T12:46:00+02:00'); // 16 minuter senare
  assert.equal((await c('POST', '/api/login', { apartmentId: '1', password: env.passwords['1'] })).status, 200);
});

test('inga sidor indexeras och inga interna filer kan hämtas', async (t) => {
  const env = await setup();
  t.after(env.close);
  for (const p of ['/', '/api/site', '/pukevagen/', '/pukevagen/api/config', '/pukevagen/app.js', '/logo.svg']) {
    const res = await fetch(env.base + p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', p);
  }
  for (const p of ['/robots.txt', '/pukevagen/robots.txt']) assert.equal(await (await fetch(env.base + p)).text(), 'User-agent: *\nDisallow: /\n');
  for (const p of ['/', '/pukevagen/']) assert.match(await (await fetch(env.base + p)).text(), /<meta name="robots" content="noindex, nofollow">/);
  for (const p of ['/config.php', '/main.php', '/lib/site.php', '/data/site.json', '/site.json', '/pukevagen/db.json', '/app.js', '/pukevagen/start.js']) {
    assert.equal((await fetch(env.base + p)).status, 404, p);
  }
  assert.equal((await fetch(env.base + '/pukevagen', { redirect: 'manual' })).headers.get('location'), '/pukevagen/');
});

test('flytta ett eget pass', async (t) => {
  const env = await setup(); // onsdag 2026-10-07 12:30
  t.after(env.close);
  const a = await env.login('1');
  const b = await env.login('2');
  const p1 = (await a('POST', '/api/bookings', { date: '2026-10-08', startHour: 6 })).body;
  const p2 = (await a('POST', '/api/bookings', { date: '2026-10-09', startHour: 6 })).body;
  await b('POST', '/api/bookings', { date: '2026-10-10', startHour: 10 }); // 10–14
  const move = (c, id, date, startHour) => c('POST', `/api/bookings/${id}`, { date, startHour });

  // Flytt fungerar trots att båda passen är bokade, och id behålls.
  const moved = await move(a, p1.id, '2026-10-10', 14);
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.body.id, moved.body.date, moved.body.startHour, moved.body.endHour], [p1.id, '2026-10-10', 14, 18]);
  // Att skjuta passet inom sin egen tid krockar inte med sig själv.
  assert.equal((await move(a, p2.id, '2026-10-09', 8)).status, 200);

  assert.match((await move(a, p1.id, '2026-10-10', 12)).body.error, /krockar/);
  assert.match((await move(a, p1.id, '2026-10-10', 23)).body.error, /mellan 06:00 och 22:00/);
  // Flytt till en kortare lucka (22–23): kräver bekräftad längd och sparar den.
  assert.equal((await b('POST', '/api/bookings', { date: '2026-10-10', startHour: 18 })).status, 201);
  assert.match((await move(a, p1.id, '2026-10-10', 22)).body.error, /bara 1 h ledigt/);
  const shortMove = await a('POST', `/api/bookings/${p1.id}`, { date: '2026-10-10', startHour: 22, hours: 1 });
  assert.deepEqual([shortMove.body.startHour, shortMove.body.endHour], [22, 23]);
  // ...och tillbaka till ett helt pass.
  assert.equal((await move(a, p1.id, '2026-10-10', 14)).body.endHour, 18);
  assert.match((await move(a, p1.id, '2026-10-07', 8)).body.error, /passerat/);
  assert.equal((await move(b, p1.id, '2026-10-11', 6)).status, 403);
  assert.equal((await move(a, 'finnsinte', '2026-10-11', 6)).status, 404);
  assert.equal((await (await env.admin())('POST', `/pukevagen/api/bookings/${p1.id}`, { date: '2026-10-11', startHour: 6 })).status, 401);

  const list = (await a('GET', '/api/bookings?from=2026-10-05&to=2026-10-11')).body;
  assert.equal(list.mine.length, 2);
  assert.deepEqual(list.mine.map((x) => `${x.date} ${x.startHour}`), ['2026-10-09 8', '2026-10-10 14']);

  // Ett pass som har börjat går inte att flytta.
  env.setClock('2026-10-09T08:30:00+02:00');
  assert.match((await move(a, p2.id, '2026-10-11', 6)).body.error, /redan börjat/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setup } = require('./helpers');

test('startsidan listar fastigheterna utan inloggning', async (t) => {
  const env = await setup();
  t.after(env.close);
  const site = (await env.client('')('GET', '/api/site')).body;
  assert.equal(site.company, 'CJA Fastighet & Bygg AB');
  assert.deepEqual(site.properties, [{ slug: 'pukevagen', name: 'Stora Pukevägen 12', url: 'https://pukevagen.cjafastighetobygg.se/' }]);
  const page = await (await fetch(env.base + '/')).text();
  assert.match(page, /<title>CJA Fastighet &amp; Bygg AB<\/title>/);
  assert.match(page, /start\.js\?v=\d+/);
  assert.match(await (await fetch(env.base + '/pukevagen/')).text(), /<title>Tvättstugan · Stora Pukevägen 12<\/title>/);
  // Bokningssidan har ingen inloggning för hyresvärden längre.
  assert.doesNotMatch(await (await fetch(env.base + '/pukevagen/')).text(), /Hyresvärd/);
});

test('hyresvärden lägger till en fastighet som går att boka direkt', async (t) => {
  const env = await setup();
  t.after(env.close);
  const admin = await env.admin();
  const add = (body) => admin('POST', '/api/properties', body);

  assert.equal((await env.client('')('POST', '/api/properties', { name: 'X', slug: 'x1', apartments: ['A'] })).status, 401);
  assert.match((await add({ name: '', slug: 'storgatan', apartments: ['A'] })).body.error, /namn/);
  assert.match((await add({ name: 'Storgatan 5', slug: 'Stor gatan', apartments: ['A'] })).body.error, /Kortnamnet/);
  assert.match((await add({ name: 'Storgatan 5', slug: 'api', apartments: ['A'] })).body.error, /Kortnamnet/);
  assert.match((await add({ name: 'Storgatan 5', slug: 'pukevagen', apartments: ['A'] })).body.error, /används redan/);
  assert.match((await add({ name: 'Storgatan 5', slug: 'storgatan', apartments: [] })).body.error, /mellan 1 och 50/);
  assert.match((await add({ name: 'Storgatan 5', slug: 'storgatan', apartments: ['A', 'A'] })).body.error, /samma namn/);

  const created = await add({ name: 'Storgatan 5', slug: 'storgatan', apartments: ['1 tr vänster', '1 tr höger', '  ', '2 tr'] });
  assert.equal(created.status, 201);
  assert.equal(created.body.folderCreated, true);
  assert.equal(created.body.property.url, `${env.base}/storgatan/`);
  assert.deepEqual(created.body.passwords.map((p) => p.name), ['1 tr vänster', '1 tr höger', '2 tr']);

  // Mappen med index.php och .htaccess skapades i webbroten.
  const stub = fs.readFileSync(path.join(env.webRoot, 'storgatan', 'index.php'), 'utf8');
  assert.match(stub, /tvatt_main\(\['type' => 'property', 'slug' => 'storgatan'\]\)/);
  assert.ok(fs.existsSync(path.join(env.webRoot, 'storgatan', '.htaccess')));

  // Syns på startsidan och fungerar för de boende.
  assert.deepEqual((await env.client('')('GET', '/api/site')).body.properties.map((p) => p.slug), ['pukevagen', 'storgatan']);
  const cfg = (await env.client('/storgatan')('GET', '/api/config')).body;
  assert.equal(cfg.name, 'Storgatan 5');
  assert.deepEqual(cfg.apartments.map((a) => a.name), ['1 tr vänster', '1 tr höger', '2 tr']);
  const r = await env.login('2', '/storgatan', created.body.passwords[1].password);
  assert.equal((await r('POST', '/api/bookings', { date: '2026-10-09', startHour: 10 })).status, 201);
  assert.equal((await admin('GET', '/api/properties/storgatan/stats')).body.apartments[1].total, 1);

  // Fastigheterna är helt åtskilda.
  assert.equal((await env.client('/pukevagen')('POST', '/api/login', { apartmentId: '2', password: created.body.passwords[1].password })).status, 401);
  assert.equal((await env.client('/pukevagen')('GET', '/api/bookings?from=2026-10-05&to=2026-10-11')).status, 401);
  const puke = await env.login('1');
  assert.deepEqual((await puke('GET', '/api/bookings?from=2026-10-05&to=2026-10-11')).body.bookings, []);
});

test('hyresvärden ändrar namn, adress och lägenheter', async (t) => {
  const env = await setup();
  t.after(env.close);
  const admin = await env.admin();
  const p = '/api/properties/pukevagen';

  const info = (await admin('GET', p)).body;
  assert.equal(info.name, 'Stora Pukevägen 12');
  assert.equal(info.apartments.length, 5);

  assert.match((await admin('POST', p, { url: 'javascript:alert(1)' })).body.error, /https/);
  const saved = (await admin('POST', p, { name: 'Stora Pukevägen 12 A', url: '' })).body;
  assert.equal(saved.url, `${env.base}/pukevagen/`);
  assert.equal((await env.client()('GET', '/api/config')).body.name, 'Stora Pukevägen 12 A');
  await admin('POST', p, { name: 'Stora Pukevägen 12', url: 'https://pukevagen.cjafastighetobygg.se/' });

  // Ny lägenhet får ett lösenord som fungerar direkt.
  const added = await admin('POST', `${p}/apartments`, { name: 'Lägenhet 6' });
  assert.equal(added.status, 201);
  assert.equal(added.body.apartment.id, '6');
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: '6', password: added.body.password })).status, 200);
  assert.match((await admin('POST', `${p}/apartments`, { name: 'Lägenhet 6' })).body.error, /redan/);

  // Byt namn; bokningar och statistik följer med.
  const a3 = await env.login('3');
  await a3('POST', '/api/bookings', { date: '2026-10-09', startHour: 10 });
  assert.equal((await admin('POST', `${p}/apartments/3`, { name: 'Vindsvåningen' })).status, 200);
  assert.equal((await env.client()('GET', '/api/config')).body.apartments[2].name, 'Vindsvåningen');
  assert.equal((await a3('GET', '/api/bookings?from=2026-10-09&to=2026-10-09')).body.bookings[0].apartmentName, 'Vindsvåningen');
  assert.equal((await admin('POST', `${p}/apartments/99`, { name: 'X' })).status, 404);
  assert.equal((await admin('GET', '/api/properties/finnsinte/stats')).status, 404);
});

test('gammal databas från tvatt.indoor.net fungerar efter flytten', async (t) => {
  const hash = execFileSync('php', ['-r', 'echo password_hash("gammalt1", PASSWORD_DEFAULT);']).toString();
  const env = await setup('2026-10-07T12:30:00+02:00', {
    prepare: (dataDir) => {
      const dir = path.join(dataDir, 'properties', 'pukevagen');
      fs.mkdirSync(dir, { recursive: true });
      const users = Object.fromEntries(['1', '2', '3', '4', '5', 'admin'].map((id) => [id, { hash, version: 0 }]));
      fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
        secret: 'a'.repeat(64), users,
        bookings: [{ id: 'gammal1', apartmentId: '2', date: '2026-10-08', startHour: 10, hours: 4, note: 'Mattor' }],
        settings: { openHour: 7, closeHour: 22, passHours: 3, minPassHours: 1, maxActiveBookings: 2, bookingHorizonDays: 28 },
        board: [{ id: 'p1', author: 'admin', text: 'Välkomna', createdAt: 1790000000 }],
      }));
    },
  });
  t.after(env.close);
  // Inga nya lägenhetslösenord skapades – de gamla gäller.
  assert.deepEqual(Object.keys(env.passwords), ['admin']);
  const c = await env.login('2', '/pukevagen', 'gammalt1');
  const list = (await c('GET', '/api/bookings?from=2026-10-08&to=2026-10-08')).body;
  assert.equal(list.bookings[0].note, 'Mattor');
  assert.equal(list.rules.passHours, 3);
  assert.equal((await c('GET', '/api/board')).body.posts[0].authorName, 'Hyresvärd');
  // Den gamla hyresvärdsinloggningen på bokningssidan finns inte kvar.
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: 'admin', password: 'gammalt1' })).status, 401);
});

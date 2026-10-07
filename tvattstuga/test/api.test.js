'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const config = require('../config');
const { Store } = require('../lib/store');
const { createHandler, ensureUsers } = require('../lib/app');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvatt-'));
  const store = new Store(path.join(dir, 'db.json'));
  const passwords = Object.fromEntries(ensureUsers(store, config).map((c) => [c.apartment.id, c.password]));
  let clock = new Date('2026-10-07T10:30:00Z'); // 12:30 svensk tid
  const server = http.createServer(createHandler({ store, config, clock: () => clock }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  return {
    store, passwords, client, setClock: (d) => { clock = d; },
    close: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test('fem inloggningar skapas och lösenord krävs', async (t) => {
  const env = await setup();
  t.after(env.close);
  assert.equal(Object.keys(env.passwords).length, 5);
  const c = env.client();
  assert.equal((await c('GET', '/api/bookings')).status, 401);
  assert.equal((await c('POST', '/api/login', { apartmentId: '1', password: 'fel' })).status, 401);
  assert.equal((await c('POST', '/api/login', { apartmentId: '1', password: env.passwords['2'] })).status, 401);
  assert.equal((await c('POST', '/api/login', { apartmentId: '1', password: env.passwords['1'] })).status, 200);
  assert.deepEqual((await c('GET', '/api/me')).body, { apartmentId: '1', apartmentName: 'Lägenhet 1' });
  await c('POST', '/api/logout');
  assert.equal((await c('GET', '/api/me')).status, 401);
});

test('boka, max två, krockar och avboka', async (t) => {
  const env = await setup();
  t.after(env.close);
  const a = env.client();
  const b = env.client();
  await a('POST', '/api/login', { apartmentId: '1', password: env.passwords['1'] });
  await b('POST', '/api/login', { apartmentId: '2', password: env.passwords['2'] });

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
  assert.equal(list.body.bookings.find((x) => x.startHour === 6).apartmentName, 'Lägenhet 1');

  assert.equal((await b('DELETE', `/api/bookings/${first.body.id}`)).status, 403);
  assert.equal((await a('DELETE', `/api/bookings/${first.body.id}`)).status, 200);
  assert.equal((await a('POST', '/api/bookings', { date: '2026-10-09', startHour: 6 })).status, 201);

  // När ett pass passerat får man boka ett nytt.
  env.setClock(new Date('2026-10-08T16:00:00Z')); // 18:00 den 8:e – 14–18-passet är slut
  assert.equal((await a('POST', '/api/bookings', { date: '2026-10-10', startHour: 19 })).status, 201);

  // Bokningarna är sparade på disk.
  assert.equal(JSON.parse(fs.readFileSync(env.store.file, 'utf8')).bookings.length, 4);
});

test('lösenordsbyte loggar ut andra sessioner', async (t) => {
  const env = await setup();
  t.after(env.close);
  const phone = env.client();
  const laptop = env.client();
  await phone('POST', '/api/login', { apartmentId: '3', password: env.passwords['3'] });
  await laptop('POST', '/api/login', { apartmentId: '3', password: env.passwords['3'] });
  assert.equal((await phone('POST', '/api/password', { currentPassword: 'fel', newPassword: 'nyttlosen' })).status, 400);
  assert.equal((await phone('POST', '/api/password', { currentPassword: env.passwords['3'], newPassword: 'nyttlosen' })).status, 200);
  assert.equal((await phone('GET', '/api/me')).status, 200);
  assert.equal((await laptop('GET', '/api/me')).status, 401);
  assert.equal((await laptop('POST', '/api/login', { apartmentId: '3', password: 'nyttlosen' })).status, 200);
});

test('för många felaktiga inloggningar spärras tillfälligt', async (t) => {
  const env = await setup();
  t.after(env.close);
  const c = env.client();
  for (let i = 0; i < 10; i++) await c('POST', '/api/login', { apartmentId: '1', password: 'fel' });
  assert.equal((await c('POST', '/api/login', { apartmentId: '1', password: env.passwords['1'] })).status, 429);
});

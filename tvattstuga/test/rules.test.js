'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// Klockan står på onsdag 2026-10-07 12:30 svensk tid.
let env;
test.before(async () => { env = await setup(); });
test.after(() => env.close());

const book = (c, date, startHour) => c('POST', '/api/bookings', { date, startHour });

test('pass måste ligga inom 06–23', async () => {
  const c = await env.login('1');
  assert.match((await book(c, '2026-10-20', 5)).body.error, /mellan 06:00 och 22:00/);
  assert.match((await book(c, '2026-10-20', 23)).body.error, /mellan 06:00 och 22:00/);
  assert.match((await book(c, '2026-10-20', 7.5)).body.error, /Ogiltig starttid/);
  assert.match((await book(c, '2026-10-20', '8')).body.error, /Ogiltig starttid/);
  assert.match((await book(c, '2026-02-30', 8)).body.error, /Ogiltigt datum/);
  assert.equal((await book(c, '2026-10-20', 19)).status, 201);
  assert.equal((await book(c, '2026-10-21', 6)).status, 201);
});

test('innevarande timme går att boka men inte tidigare', async () => {
  const c = await env.login('2');
  assert.match((await book(c, '2026-10-07', 11)).body.error, /passerat/);
  assert.match((await book(c, '2026-10-06', 14)).body.error, /passerat/);
  assert.equal((await book(c, '2026-10-07', 12)).status, 201);
});

test('bokningshorisont 28 dagar', async () => {
  const c = await env.login('3');
  assert.match((await book(c, '2026-11-05', 8)).body.error, /28 dagar fram/);
  assert.equal((await book(c, '2026-11-04', 8)).status, 201);
});

test('överlappande pass nekas, angränsande tillåts', async () => {
  const a = await env.login('4');
  const b = await env.login('5');
  assert.equal((await book(a, '2026-10-09', 10)).status, 201); // 10–14
  for (const h of [10, 13]) assert.match((await book(b, '2026-10-09', h)).body.error, /krockar/);
  assert.equal((await book(b, '2026-10-09', 14)).status, 201); // 14–18
  assert.equal((await book(a, '2026-10-09', 6)).status, 201); // 06–10
});

const bookShort = (c, date, startHour, hours) => c('POST', '/api/bookings', { date, startHour, hours });

test('kortare pass före ett annat pass kräver bekräftad längd', async (t) => {
  const env = await setup();
  t.after(env.close);
  const a = await env.login('1');
  const b = await env.login('2');
  assert.equal((await book(a, '2026-10-22', 10)).status, 201); // 10–14
  // 07: bara 3 h ledigt. Utan längd → måste bekräftas.
  assert.match((await book(b, '2026-10-22', 7)).body.error, /bara 3 h ledigt/);
  // Fel längd (t.ex. vill ha 4 eller 2) → nekas.
  assert.match((await bookShort(b, '2026-10-22', 7, 4)).body.error, /har ändrats/);
  assert.match((await bookShort(b, '2026-10-22', 7, 2)).body.error, /har ändrats/);
  const short = await bookShort(b, '2026-10-22', 7, 3);
  assert.equal(short.status, 201);
  assert.deepEqual([short.body.startHour, short.body.endHour], [7, 10]);
  // 06: nu bara 1 h kvar före 07.
  assert.equal((await bookShort(a, '2026-10-22', 6, 1)).status, 201);
});

test('kortare pass före stängning', async (t) => {
  const env = await setup();
  t.after(env.close);
  const c = await env.login('3');
  assert.match((await book(c, '2026-10-23', 20)).body.error, /bara 3 h ledigt/);
  const late = await bookShort(c, '2026-10-23', 22, 1);
  assert.equal(late.status, 201);
  assert.equal(late.body.endHour, 23);
  // Ett helt pass som får plats bokas alltid som helt pass.
  assert.match((await bookShort(c, '2026-10-24', 8, 2)).body.error, /har ändrats/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// Klockan: onsdag 2026-10-07 12:30.
test('avvikande dagar: stängt, andra tider och stängt några timmar', async (t) => {
  const env = await setup();
  t.after(env.close);
  const admin = await env.admin();
  const ex = (body) => admin('POST', '/api/properties/pukevagen/exceptions', body);
  const r = await env.login('1');
  const book = (date, startHour, hours) => r('POST', '/api/bookings', { date, startHour, hours });

  // Validering
  assert.match((await ex({ date: '2026-10-06', mode: 'closed' })).body.error, /passerat/);
  assert.match((await ex({ date: '2026-10-10', mode: 'x' })).body.error, /Välj om/);
  assert.match((await ex({ date: '2026-10-10', mode: 'hours', open: 12, close: 10 })).body.error, /efter öppningstiden/);
  assert.match((await ex({ date: '2026-10-10', mode: 'block', from: 10 })).body.error, /timmar/);
  assert.match((await ex({ date: '2026-10-10', mode: 'closed', note: 'x'.repeat(121) })).body.error, /120/);
  assert.equal((await env.client('')('POST', '/api/properties/pukevagen/exceptions', { date: '2026-10-10', mode: 'closed' })).status, 401);

  // Stängt hela lördagen.
  const saved = await ex({ date: '2026-10-10', mode: 'closed', note: 'Service av torktumlaren' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.exceptions, [{ date: '2026-10-10', mode: 'closed', note: 'Service av torktumlaren' }]);
  assert.match((await book('2026-10-10', 10)).body.error, /stängd den dagen \(Service av torktumlaren\)/);

  // Andra öppettider fredag: 10–20 (sista hela pass 16, kort pass till 20).
  await ex({ date: '2026-10-09', mode: 'hours', open: 10, close: 20, note: 'Kortare dag' });
  assert.match((await book('2026-10-09', 8)).body.error, /mellan 10:00 och 19:00/);
  assert.equal((await book('2026-10-09', 17, 3)).body.endHour, 20);

  // Stängt 10–12 på torsdag: pass får inte överlappa, korta pass före stängningen följer gapregeln.
  await ex({ date: '2026-10-08', mode: 'block', from: 10, to: 12, note: 'Rengöring' });
  assert.match((await book('2026-10-08', 11)).body.error, /stängd 10–12 den dagen \(Rengöring\)/);
  assert.match((await book('2026-10-08', 8)).body.error, /krockar|bara 2 h|helt pass/);
  assert.equal((await book('2026-10-08', 12)).body.endHour, 16);

  // De boende ser undantagen.
  const rules = (await r('GET', '/api/bookings')).body.rules;
  assert.deepEqual(Object.keys(rules.exceptions).sort(), ['2026-10-08', '2026-10-09', '2026-10-10']);
  assert.equal(rules.exceptions['2026-10-08'].note, 'Rengöring');

  // Ta bort: lördagen går att boka igen.
  const left = await admin('DELETE', '/api/properties/pukevagen/exceptions/2026-10-10');
  assert.equal(left.body.exceptions.length, 2);
  assert.equal((await admin('DELETE', '/api/properties/pukevagen/exceptions/2026-10-10')).status, 404);
  const b2 = await env.login('2');
  assert.equal((await b2('POST', '/api/bookings', { date: '2026-10-10', startHour: 10 })).status, 201);
});

test('avvikande dag som krockar med bokade pass', async (t) => {
  const env = await setup();
  t.after(env.close);
  const admin = await env.admin();
  const ex = (body) => admin('POST', '/api/properties/pukevagen/exceptions', body);
  const a = await env.login('1');
  const b = await env.login('2');
  await a('POST', '/api/bookings', { date: '2026-10-12', startHour: 6 });  // 06–10
  await b('POST', '/api/bookings', { date: '2026-10-12', startHour: 14 }); // 14–18

  // Nyårsdagsfallet: öppna först 10 – passet 06–10 krockar.
  const late = { date: '2026-10-12', mode: 'hours', open: 10, close: 23, note: 'Låt grannarna sova' };
  const first = await ex(late);
  assert.equal(first.status, 409);
  assert.deepEqual(first.body.conflicts, [{ apartmentName: 'Lägenhet 1', startHour: 6, endHour: 10 }]);

  // Behåll passen: undantaget sparas, bokningen står kvar.
  assert.equal((await ex({ ...late, onConflict: 'keep' })).body.cancelled, 0);
  assert.equal((await a('GET', '/api/bookings?from=2026-10-12&to=2026-10-12')).body.bookings.length, 2);

  // Stäng hela dagen och avboka: båda passen försvinner.
  const closed = await ex({ date: '2026-10-12', mode: 'closed', note: 'Stambyte', onConflict: 'cancel' });
  assert.equal(closed.body.cancelled, 2);
  assert.deepEqual((await a('GET', '/api/bookings?from=2026-10-12&to=2026-10-12')).body.bookings, []);
  assert.equal((await a('GET', '/api/bookings')).body.mine.length, 0);
});

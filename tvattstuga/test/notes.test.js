'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('anteckning på ett pass syns för alla', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const a = await env.login('1');
  const b = await env.login('2');
  const p = await a('POST', '/api/bookings', { date: '2026-10-09', startHour: 10, note: '  Kör två maskiner,\n klar 13  ' });
  assert.equal(p.status, 201);
  assert.equal(p.body.note, 'Kör två maskiner,  klar 13');
  const q = (await a('POST', '/api/bookings', { date: '2026-10-10', startHour: 10 })).body;
  assert.equal(q.note, '');

  const seen = (await b('GET', '/api/bookings?from=2026-10-05&to=2026-10-11')).body.bookings;
  assert.deepEqual(seen.map((x) => x.note), ['Kör två maskiner,  klar 13', '']);

  // Ändra, ta bort, regler.
  assert.equal((await a('POST', `/api/bookings/${q.id}/note`, { note: 'Mattor' })).body.note, 'Mattor');
  assert.equal((await a('POST', `/api/bookings/${q.id}/note`, { note: '' })).body.note, '');
  assert.equal((await b('POST', `/api/bookings/${q.id}/note`, { note: 'hej' })).status, 403);
  assert.match((await a('POST', `/api/bookings/${q.id}/note`, { note: 'x'.repeat(201) })).body.error, /högst 200 tecken/);
  assert.match((await a('POST', '/api/bookings', { date: '2026-10-11', startHour: 10, note: 'x'.repeat(201) })).body.error, /högst 200/);
  assert.equal((await a('POST', '/api/bookings/finnsinte/note', { note: 'x' })).status, 404);

  // Anteckningen följer med vid flytt och syns i den egna kalendern.
  await a('POST', `/api/bookings/${p.body.id}`, { date: '2026-10-09', startHour: 14 });
  const moved = (await a('GET', '/api/bookings?from=2026-10-09&to=2026-10-09')).body.bookings[0];
  assert.equal(moved.note, 'Kör två maskiner,  klar 13');
  const feed = (await a('GET', '/api/reminders')).body.feedUrl;
  assert.match((await (await fetch(feed)).text()).replace(/\r\n /g, ''), /Anteckning: Kör två maskiner\\,  klar 13/);

  env.setClock('2026-10-09T18:30:00+02:00');
  assert.match((await a('POST', `/api/bookings/${p.body.id}/note`, { note: 'sen' })).body.error, /passerat/);
});

test('anslagstavla med datum och tid', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const a = await env.login('1');
  const b = await env.login('2');
  const admin = await env.login('admin');

  assert.equal((await env.client()('GET', '/api/board')).status, 401);
  assert.deepEqual((await a('GET', '/api/board')).body.posts, []);
  assert.match((await a('POST', '/api/board', { text: '   ' })).body.error, /Skriv något/);
  assert.match((await a('POST', '/api/board', { text: 'x'.repeat(501) })).body.error, /högst 500/);
  assert.equal((await a('POST', '/api/board', { text: '<b>Luddfiltret</b> är trasigt\n\n\n\nRing värden' })).status, 201);
  env.setClock('2026-10-07T13:05:00+02:00');
  await admin('POST', '/api/properties/pukevagen/board', { text: 'Reparatör kommer fredag 9–12.' });

  const posts = (await b('GET', '/api/board')).body.posts;
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((p) => p.authorName), ['Hyresvärd', 'Lägenhet 1']); // nyast först
  assert.equal(posts[1].text, '<b>Luddfiltret</b> är trasigt\n\nRing värden'); // lagras som text
  assert.equal(posts[1].createdAt, '2026-10-07T10:30:00+00:00');
  assert.deepEqual(posts.map((p) => p.canDelete), [false, false]);

  const [byAdmin, byA] = posts;
  assert.equal((await b('DELETE', `/api/board/${byA.id}`)).status, 403);
  assert.equal((await a('DELETE', `/api/board/${byA.id}`)).status, 200);
  assert.equal((await admin('GET', '/api/properties/pukevagen/board')).body.posts[0].canDelete, true);
  assert.equal((await admin('DELETE', `/api/properties/pukevagen/board/${byAdmin.id}`)).status, 200);
  assert.equal((await a('DELETE', `/api/board/${byAdmin.id}`)).status, 404);
  assert.deepEqual((await a('GET', '/api/board')).body.posts, []);
});

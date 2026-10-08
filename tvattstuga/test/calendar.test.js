'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const unfold = (ics) => ics.replace(/\r\n /g, '');

test('kalenderprenumeration med påminnelser', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const a = await env.login('1');
  const b = await env.login('2');
  const p1 = (await a('POST', '/api/bookings', { date: '2026-10-08', startHour: 6 })).body;
  await a('POST', '/api/bookings', { date: '2026-10-09', startHour: 10 });
  await b('POST', '/api/bookings', { date: '2026-10-10', startHour: 10 });

  const rem = await a('GET', '/api/reminders');
  assert.equal(rem.status, 200);
  assert.equal(rem.body.reminderMinutes, 60);
  assert.match(rem.body.feedUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/calendar\/[a-f0-9]{32}\.ics$/);

  // Prenumerationen kräver ingen inloggning, bara den hemliga länken.
  const res = await fetch(rem.body.feedUrl);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  const raw = await res.text();
  assert.ok(raw.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'rader högst 75 byte');
  const ics = unfold(raw);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2); // bara egna pass
  assert.match(ics, /X-WR-CALNAME:Tvättstugan – Lägenhet 1/);
  assert.match(ics, /DTSTART:20261008T040000Z/); // 06:00 svensk sommartid
  assert.match(ics, /DTEND:20261008T080000Z/);
  assert.match(ics, new RegExp(`UID:${p1.id}@`));
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(ics, /Tvättstugan om 1 timme \(06:00–10:00\)/);

  // Byt påminnelsetid och flytta ett pass – syns direkt i prenumerationen.
  assert.equal((await a('POST', '/api/reminders', { reminderMinutes: 7 })).status, 400);
  assert.equal((await a('POST', '/api/reminders', { reminderMinutes: 1440 })).body.reminderMinutes, 1440);
  await a('POST', `/api/bookings/${p1.id}`, { date: '2026-10-08', startHour: 14 });
  const ics2 = unfold(await (await fetch(rem.body.feedUrl)).text());
  assert.match(ics2, /TRIGGER:-PT1440M/);
  assert.match(ics2, /DTSTART:20261008T120000Z/);
  assert.match(ics2, /Tvättstugan imorgon/);

  // Ny länk: den gamla slutar fungera.
  const fresh = await a('POST', '/api/reminders/new-link');
  assert.notEqual(fresh.body.feedUrl, rem.body.feedUrl);
  assert.equal(fresh.body.reminderMinutes, 1440);
  assert.equal((await fetch(rem.body.feedUrl)).status, 404);
  assert.equal((await fetch(fresh.body.feedUrl)).status, 200);
  assert.equal((await fetch(`${env.base}/api/calendar/${'0'.repeat(32)}.ics`)).status, 404);
});

test('ett enskilt pass som kalenderfil', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const a = await env.login('1');
  const p = (await a('POST', '/api/bookings', { date: '2026-10-30', startHour: 18 })).body;
  assert.ok(p.id);
  const res = await fetch(`${env.base}/api/bookings/${p.id}.ics`, { headers: { Cookie: '' } });
  assert.equal(res.status, 401);
  const own = await a('GET', `/api/bookings/${p.id}.ics`);
  assert.equal(own.status, 200);
  assert.match(own.headers.get('content-disposition'), /attachment; filename="tvattpass-2026-10-30.ics"/);
  const ics = unfold(own.text);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(ics, /DTSTART:20261030T170000Z/); // 18:00 svensk vintertid
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.doesNotMatch(ics, /X-WR-CALNAME/);
  const b = await env.login('2');
  assert.equal((await b('GET', `/api/bookings/${p.id}.ics`)).status, 404);
});

test('flytt till nya boende ger ny kalenderlänk', async (t) => {
  const env = await setup('2026-10-07T12:30:00+02:00');
  t.after(env.close);
  const a = await env.login('3');
  const old = (await a('GET', '/api/reminders')).body.feedUrl;
  const admin = await env.login('admin');
  await admin('POST', '/api/admin/reset-password', { apartmentId: '3' });
  assert.equal((await fetch(old)).status, 200); // glömt lösenord: länken behålls
  await admin('POST', '/api/admin/reset-password', { apartmentId: '3', cancelUpcoming: true });
  assert.equal((await fetch(old)).status, 404); // nya boende: ny länk
  assert.equal((await admin('GET', '/api/reminders')).status, 403);
});

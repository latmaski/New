'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const pinFlag = async (c, id) => (await c('GET', '/api/config')).body.apartments.find((a) => a.id === id).pin;

test('välja pinkod och logga in med den', async (t) => {
  const env = await setup();
  t.after(env.close);
  const a = await env.login('1');
  assert.equal((await a('GET', '/api/me')).body.hasPin, false);
  assert.equal(await pinFlag(a, '1'), false);
  for (const bad of ['123', '12345', 'abcd', 1234, null]) {
    assert.equal((await a('POST', '/api/pin', { pin: bad })).status, 400);
  }
  assert.equal((await a('POST', '/api/pin', { pin: '0420' })).status, 200);
  assert.equal((await a('GET', '/api/me')).body.hasPin, true);
  assert.equal(await pinFlag(a, '1'), true);
  assert.equal(await pinFlag(a, '2'), false);

  const phone = env.client();
  assert.equal((await phone('POST', '/api/login', { apartmentId: '2', pin: '0420' })).status, 409);
  assert.equal((await phone('POST', '/api/login', { apartmentId: '1', pin: '0420' })).status, 200);
  assert.equal((await phone('GET', '/api/me')).body.apartmentId, '1');
  // Lösenordet fungerar fortfarande.
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: '1', password: env.passwords['1'] })).status, 200);

  // Pinkoden följer med när de boende byter lösenord.
  assert.equal((await a('POST', '/api/password', { currentPassword: env.passwords['1'], newPassword: 'nyttlosen' })).status, 200);
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: '1', pin: '0420' })).status, 200);

  // Ta bort.
  const b = await env.login('1', '/pukevagen', 'nyttlosen');
  assert.equal((await b('DELETE', '/api/pin')).status, 200);
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: '1', pin: '0420' })).status, 409);
});

test('pinkoden spärras efter fem fel och lösenordet låser upp', async (t) => {
  const env = await setup();
  t.after(env.close);
  const a = await env.login('3');
  await a('POST', '/api/pin', { pin: '1111' });
  const c = env.client();
  for (let left = 4; left >= 1; left--) {
    const res = await c('POST', '/api/login', { apartmentId: '3', pin: '2222' });
    assert.equal(res.status, 401);
    assert.match(res.body.error, new RegExp(`${left} försök kvar`));
  }
  const last = await c('POST', '/api/login', { apartmentId: '3', pin: '2222' });
  assert.equal(last.status, 423);
  assert.match(last.body.error, /spärrad/);
  // Även rätt kod nekas nu, och sidan visar lösenordsfältet.
  assert.equal((await c('POST', '/api/login', { apartmentId: '3', pin: '1111' })).status, 423);
  assert.equal(await pinFlag(c, '3'), false);

  assert.equal((await c('POST', '/api/login', { apartmentId: '3', password: env.passwords['3'] })).status, 200);
  assert.equal(await pinFlag(c, '3'), true);
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: '3', pin: '1111' })).status, 200);
});

test('nytt lösenord från hyresvärden tar bort pinkoden', async (t) => {
  const env = await setup();
  t.after(env.close);
  const a = await env.login('2');
  await a('POST', '/api/pin', { pin: '5555' });
  const admin = await env.admin();
  assert.equal((await admin('POST', '/api/properties/pukevagen/reset-password', { apartmentId: '2' })).status, 200);
  assert.equal((await env.client()('POST', '/api/login', { apartmentId: '2', pin: '5555' })).status, 409);
  assert.equal(await pinFlag(env.client(), '2'), false);
});

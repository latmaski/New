'use strict';

const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user || typeof password !== 'string') return false;
  const actual = crypto.scryptSync(password, user.salt, 32);
  return crypto.timingSafeEqual(actual, Buffer.from(user.hash, 'hex'));
}

function generatePassword(length = 10) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

// Sessionen är en signerad cookie: lägenhet.utgång.version.signatur.
// "version" ökas vid lösenordsbyte så att gamla inloggningar slutar gälla.
function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionToken(secret, apartmentId, version, nowMs = Date.now()) {
  const payload = `${apartmentId}.${nowMs + SESSION_DAYS * 86400000}.${version}`;
  return `${payload}.${sign(secret, payload)}`;
}

function readSessionToken(secret, token, users, nowMs = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [apartmentId, expires, version, sig] = parts;
  const expected = sign(secret, `${apartmentId}.${expires}.${version}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expires) < nowMs) return null;
  const user = users[apartmentId];
  if (!user || String(user.version || 0) !== version) return null;
  return apartmentId;
}

module.exports = {
  SESSION_DAYS, hashPassword, verifyPassword, generatePassword,
  createSessionToken, readSessionToken,
};

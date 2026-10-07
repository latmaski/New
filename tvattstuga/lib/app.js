'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const rules = require('./rules');
const auth = require('./auth');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

// Skapar saknade inloggningar och returnerar de nya lösenorden i klartext
// (de skrivs ut en gång i terminalen och sparas bara som hash).
function ensureUsers(store, config) {
  const created = [];
  for (const apt of config.apartments) {
    if (store.data.users[apt.id]) continue;
    const password = auth.generatePassword();
    store.data.users[apt.id] = { ...auth.hashPassword(password), version: 0 };
    created.push({ apartment: apt, password });
  }
  if (created.length) store.save();
  return created;
}

function createHandler({ store, config, clock = () => new Date(), secureCookies = false }) {
  const apartments = new Map(config.apartments.map((a) => [a.id, a]));
  const loginFailures = new Map();

  const now = () => rules.localNow(config.timezone, clock());

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }
  const fail = (res, status, error) => send(res, status, { error });

  function cookie(value, maxAgeSeconds) {
    return `sess=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureCookies ? '; Secure' : ''}`;
  }

  function currentApartment(req) {
    const match = /(?:^|;\s*)sess=([^;]+)/.exec(req.headers.cookie || '');
    if (!match) return null;
    return auth.readSessionToken(store.data.secret, match[1], store.data.users, clock().getTime());
  }

  async function readJson(req) {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return null;
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 10000) return null;
    }
    try { return JSON.parse(body); } catch { return null; }
  }

  function publicBooking(b, me) {
    return {
      id: b.id, date: b.date, startHour: b.startHour, endHour: b.startHour + config.passHours,
      apartmentId: b.apartmentId, apartmentName: apartments.get(b.apartmentId)?.name || b.apartmentId,
      mine: b.apartmentId === me,
    };
  }

  function tooManyFailures(ip) {
    const t = clock().getTime();
    const recent = (loginFailures.get(ip) || []).filter((x) => t - x < LOGIN_WINDOW_MS);
    loginFailures.set(ip, recent);
    return recent.length >= LOGIN_MAX_FAILURES;
  }

  const routes = {
    'GET /api/config': (req, res) => send(res, 200, {
      name: config.name, openHour: config.openHour, closeHour: config.closeHour,
      passHours: config.passHours, maxActiveBookings: config.maxActiveBookings,
      bookingHorizonDays: config.bookingHorizonDays,
      apartments: config.apartments.map(({ id, name }) => ({ id, name })),
    }),

    'POST /api/login': async (req, res) => {
      const ip = req.socket.remoteAddress;
      if (tooManyFailures(ip)) return fail(res, 429, 'För många misslyckade försök. Vänta en stund och försök igen.');
      const body = await readJson(req);
      const id = body && String(body.apartmentId);
      const user = id && apartments.has(id) ? store.data.users[id] : null;
      if (!user || !auth.verifyPassword(body.password, user)) {
        loginFailures.get(ip).push(clock().getTime());
        return fail(res, 401, 'Fel lägenhet eller lösenord.');
      }
      loginFailures.delete(ip);
      const token = auth.createSessionToken(store.data.secret, id, user.version || 0, clock().getTime());
      send(res, 200, { apartmentId: id }, { 'Set-Cookie': cookie(token, auth.SESSION_DAYS * 86400) });
    },

    'POST /api/logout': (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) }),

    'GET /api/me': (req, res, me) => send(res, 200, { apartmentId: me, apartmentName: apartments.get(me).name }),

    'POST /api/password': async (req, res, me) => {
      const body = await readJson(req);
      const user = store.data.users[me];
      if (!body || !auth.verifyPassword(body.currentPassword, user)) return fail(res, 400, 'Nuvarande lösenord stämmer inte.');
      if (typeof body.newPassword !== 'string' || body.newPassword.length < 6) {
        return fail(res, 400, 'Det nya lösenordet måste vara minst 6 tecken.');
      }
      const version = (user.version || 0) + 1;
      store.data.users[me] = { ...auth.hashPassword(body.newPassword), version };
      store.save();
      const token = auth.createSessionToken(store.data.secret, me, version, clock().getTime());
      send(res, 200, { ok: true }, { 'Set-Cookie': cookie(token, auth.SESSION_DAYS * 86400) });
    },

    'GET /api/bookings': (req, res, me, url) => {
      const n = now();
      const from = url.searchParams.get('from') || n.date;
      const to = url.searchParams.get('to') || rules.addDays(from, 6);
      if (!rules.isValidDate(from) || !rules.isValidDate(to)) return fail(res, 400, 'Ogiltigt datumintervall.');
      const bookings = store.data.bookings
        .filter((b) => b.date >= from && b.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
        .map((b) => publicBooking(b, me));
      const mine = rules.activeBookingsFor(store.data.bookings, me, n, config)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
        .map((b) => publicBooking(b, me));
      send(res, 200, { now: n, bookings, mine });
    },

    'POST /api/bookings': async (req, res, me) => {
      const body = await readJson(req);
      if (!body) return fail(res, 400, 'Ogiltig förfrågan.');
      const booking = { date: body.date, startHour: body.startHour };
      const error = rules.validateBooking({ bookings: store.data.bookings, apartmentId: me, ...booking, now: now(), config });
      if (error) return fail(res, 409, error);
      const created = { id: crypto.randomUUID(), apartmentId: me, ...booking, createdAt: clock().toISOString() };
      store.data.bookings.push(created);
      store.save();
      send(res, 201, publicBooking(created, me));
    },
  };

  function serveStatic(res, pathname) {
    const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Hittades inte');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Metoden stöds inte.');
        return serveStatic(res, url.pathname);
      }

      const deleteMatch = /^\/api\/bookings\/([\w-]+)$/.exec(url.pathname);
      const route = deleteMatch && req.method === 'DELETE' ? null : routes[`${req.method} ${url.pathname}`];
      if (!route && !deleteMatch) return fail(res, 404, 'Hittades inte.');

      const isPublic = ['GET /api/config', 'POST /api/login', 'POST /api/logout'].includes(`${req.method} ${url.pathname}`);
      const me = currentApartment(req);
      if (!isPublic && !me) return fail(res, 401, 'Du är inte inloggad.');

      if (deleteMatch) {
        if (req.method !== 'DELETE') return fail(res, 405, 'Metoden stöds inte.');
        const index = store.data.bookings.findIndex((b) => b.id === deleteMatch[1]);
        const booking = store.data.bookings[index];
        const error = rules.validateCancel({ booking, apartmentId: me, now: now(), config });
        if (error) return fail(res, booking ? 403 : 404, error);
        store.data.bookings.splice(index, 1);
        store.save();
        return send(res, 200, { ok: true });
      }
      return await route(req, res, me, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) fail(res, 500, 'Något gick fel på servern.');
      else res.end();
    }
  };
}

module.exports = { createHandler, ensureUsers };

'use strict';

const $ = (id) => document.getElementById(id);
const narrow = window.matchMedia('(max-width: 860px)');

const state = {
  config: null,
  me: null,
  adminLogin: false,
  stats: null,
  period: 'month',
  weekStart: null, // måndag, 'YYYY-MM-DD'
  selectedDay: null, // används i mobilvyn
  now: null,
  bookings: [],
  mine: [],
  moving: null, // eget pass som håller på att flyttas (via "Ändra")
};

// ---------- Datum (alltid som 'YYYY-MM-DD'-strängar i lokal tid) ----------
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (s) => addDays(s, -((toDate(s).getUTCDay() + 6) % 7));
const fmt = (s, opts) => toDate(s).toLocaleDateString('sv-SE', { timeZone: 'UTC', ...opts });
const pad = (h) => String(h).padStart(2, '0');
const hourIndex = (date, hour) => toDate(date).getTime() / 3600000 + hour;

function isoWeek(s) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

function describe(b) {
  const day = b.date === state.now.date ? 'idag' : b.date === addDays(state.now.date, 1) ? 'imorgon' : fmt(b.date, { weekday: 'long', day: 'numeric', month: 'short' });
  return { day, time: `${pad(b.startHour)}:00–${pad(b.endHour)}:00` };
}

// ---------- API ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'api/login') { showLogin(); throw new Error(data.error || 'Du är inte inloggad.'); }
  if (!res.ok) throw new Error(data.error || 'Något gick fel.');
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

// ---------- Inloggning ----------
function renderAptPicker() {
  const last = localStorageGet('lastApartment');
  $('apt-picker').innerHTML = '';
  for (const apt of state.config.apartments) {
    const label = document.createElement('label');
    const short = apt.name.replace(/^Lägenhet\s*/i, '');
    label.innerHTML = `<input type="radio" name="apartment" value="${apt.id}"><span><b></b>lgh</span>`;
    label.querySelector('b').textContent = short;
    label.title = apt.name;
    label.querySelector('input').setAttribute('aria-label', apt.name);
    if (apt.id === last) label.querySelector('input').checked = true;
    $('apt-picker').append(label);
  }
}

function localStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function localStorageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* privat läge */ } }

function setAdminLogin(on) {
  state.adminLogin = on;
  $('apt-fieldset').hidden = on;
  $('admin-login-label').hidden = !on;
  $('toggle-admin').textContent = on ? '← Tillbaka till lägenheterna' : 'Hyresvärd? Logga in här';
  $('login-error').textContent = '';
}

function showLogin() {
  state.me = null;
  $('app').hidden = true;
  $('login').hidden = false;
  renderAptPicker();
  setAdminLogin(false);
  $('login-password').value = '';
}

$('toggle-admin').addEventListener('click', () => { setAdminLogin(!state.adminLogin); $('login-password').focus(); });

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apartmentId = state.adminLogin ? 'admin' : new FormData(e.target).get('apartment');
  const password = $('login-password').value;
  $('login-error').textContent = '';
  if (!apartmentId) { $('login-error').textContent = 'Välj din lägenhet.'; return; }
  if (!password) { $('login-error').textContent = 'Skriv ditt lösenord.'; return; }
  try {
    await api('api/login', { method: 'POST', body: { apartmentId, password } });
    localStorageSet('lastApartment', apartmentId);
    await startApp();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('btn-logout').addEventListener('click', async () => {
  await api('api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

// ---------- Byt lösenord ----------
$('btn-password').addEventListener('click', () => {
  $('password-form').reset();
  $('pw-error').textContent = '';
  $('password-dialog').showModal();
});
$('pw-cancel').addEventListener('click', () => $('password-dialog').close());
$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('api/password', { method: 'POST', body: { currentPassword: $('pw-current').value, newPassword: $('pw-new').value } });
    $('password-dialog').close();
    toast('Lösenordet är bytt.');
  } catch (err) {
    $('pw-error').textContent = err.message;
  }
});

// ---------- Kalender ----------
async function load() {
  const data = await api(`api/bookings?from=${state.weekStart}&to=${addDays(state.weekStart, 6)}`);
  state.now = data.now;
  applyRules(data.rules);
  state.bookings = data.bookings;
  state.mine = data.mine;
  if (state.moving) state.moving = state.mine.find((b) => b.id === state.moving.id && isMovable(b)) || null;
  render();
}

const isMovable = (b) => b.mine && hourIndex(b.date, b.startHour) >= hourIndex(state.now.date, state.now.hour) + state.now.minute / 60;

function render() {
  renderMoveBanner();
  renderMine();
  renderHeader();
  renderGrid();
}

function renderMine() {
  const { maxActiveBookings } = state.config;
  $('mine-count').textContent = `${state.mine.length} av ${maxActiveBookings}`;
  const list = $('mine-list');
  list.innerHTML = '';
  if (!state.mine.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Du har inga bokade pass. Välj en ledig starttid i kalendern.';
    list.append(li);
  }
  for (const b of state.mine) {
    const { day, time } = describe(b);
    const li = document.createElement('li');
    li.innerHTML = '<div class="when"><b></b><span></span></div><div class="actions"><a class="btn ghost small" data-act="cal">Kalender</a><button class="btn ghost small" type="button" data-act="move">Ändra</button><button class="btn ghost small danger" type="button" data-act="cancel">Avboka</button></div>';
    li.querySelector('b').textContent = day;
    const len = b.endHour - b.startHour;
    li.querySelector('span').textContent = len < state.config.passHours ? `${time} · ${len} h` : time;
    if (state.moving && state.moving.id === b.id) li.classList.add('is-moving');
    const moveBtn = li.querySelector('[data-act="move"]');
    if (isMovable(b)) moveBtn.addEventListener('click', () => startMoveMode(b));
    else moveBtn.remove();
    li.querySelector('[data-act="cancel"]').addEventListener('click', () => cancelBooking(b));
    setCalendarLink(li.querySelector('[data-act="cal"]'), b);
    list.append(li);
  }
}

function renderHeader() {
  const end = addDays(state.weekStart, 6);
  $('week-title').textContent = `Vecka ${isoWeek(state.weekStart)}`;
  $('week-range').textContent = `${fmt(state.weekStart, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  $('prev-week').disabled = state.weekStart <= mondayOf(state.now.date);
  $('prev-week').style.visibility = $('prev-week').disabled ? 'hidden' : '';
  const horizon = addDays(state.now.date, state.config.bookingHorizonDays);
  $('next-week').style.visibility = addDays(state.weekStart, 7) > horizon ? 'hidden' : '';

  const strip = $('day-strip');
  strip.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(state.weekStart, i);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(d === state.selectedDay));
    if (d === state.now.date) btn.classList.add('today');
    btn.innerHTML = `${fmt(d, { weekday: 'short' }).replace('.', '')}<b>${toDate(d).getUTCDate()}</b>`;
    btn.addEventListener('click', () => { state.selectedDay = d; render(); });
    strip.append(btn);
  }
}

// Lediga timmar från hour fram till nästa pass (eller stängning).
function availableHours(date, hour, ignoreId) {
  let limit = state.config.closeHour;
  for (const b of state.bookings) {
    if (b.id === ignoreId || b.date !== date) continue;
    if (b.startHour <= hour && hour < b.endHour) return { hours: 0, limit };
    if (b.startHour > hour && b.startHour < limit) limit = b.startHour;
  }
  return { hours: limit - hour, limit };
}

// Där den lediga luckan börjar: föregående pass slut, öppning eller (idag) nuvarande timme.
function gapStart(date, hour, ignoreId) {
  let start = state.config.openHour;
  for (const b of state.bookings) {
    if (b.id === ignoreId || b.date !== date) continue;
    if (b.endHour <= hour && b.endHour > start) start = b.endHour;
  }
  return date === state.now.date ? Math.max(start, state.now.hour) : start;
}

const bookable = (status) => status.kind === 'start' || status.kind === 'short';

// ignoreId: passet som flyttas räknas varken som krock eller mot maxantalet.
// 'start' = helt pass får plats, 'short' = bara ett kortare pass får plats.
function cellStatus(date, hour, ignoreId = state.moving && state.moving.id) {
  const { closeHour, passHours, maxActiveBookings, bookingHorizonDays } = state.config;
  const minHours = state.config.minPassHours || passHours;
  if (hour < state.config.openHour || hour >= closeHour) return { kind: 'closed' };
  const start = hourIndex(date, hour);
  if (start < hourIndex(state.now.date, state.now.hour)) return { kind: 'past', reason: 'Tiden har redan passerat.' };
  if (date > addDays(state.now.date, bookingHorizonDays)) return { kind: 'blocked', reason: `Du kan boka högst ${bookingHorizonDays} dagar fram.` };
  const free = availableHours(date, hour, ignoreId);
  if (free.hours <= 0) return { kind: 'blocked', reason: 'Tiden är redan bokad.' };
  if (free.hours < minHours) return { kind: 'blocked', reason: `Bara ${free.hours} h ledigt här, minst ${minHours} h krävs.` };
  if (!ignoreId && state.mine.length >= maxActiveBookings) return { kind: 'blocked', reason: `Du har redan ${maxActiveBookings} pass bokade.` };
  const hours = Math.min(passHours, free.hours);
  if (hours === passHours) return { kind: 'start', hours };
  // Korta pass bara i luckor där ett helt pass inte får plats.
  if (free.limit - gapStart(date, hour, ignoreId) >= passHours) {
    return { kind: 'blocked', reason: `Här får ett helt pass plats – välj en tidigare starttid (senast ${pad(free.limit - passHours)}:00).` };
  }
  const why = free.limit === closeHour ? `tvättstugan stänger ${pad(closeHour)}:00` : `nästa pass börjar ${pad(free.limit)}:00`;
  return { kind: 'short', hours, why };
}

function shortWarning(status, startHour) {
  if (status.kind !== 'short') return '';
  return `Kortare pass än vanligt: ${status.hours} ${status.hours === 1 ? 'timme' : 'timmar'} `
    + `(${pad(startHour)}:00–${pad(startHour + status.hours)}:00), eftersom ${status.why}.`;
}

function renderGrid() {
  const { passHours } = state.config;
  const days = narrow.matches ? [state.selectedDay] : Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  // Visa även timmar utanför öppettiden om det finns pass där (bokade före en regeländring).
  let openHour = state.config.openHour;
  let closeHour = state.config.closeHour;
  for (const b of state.bookings) {
    if (!days.includes(b.date)) continue;
    openHour = Math.min(openHour, b.startHour);
    closeHour = Math.max(closeHour, b.endHour);
  }
  state.gridOpen = openHour;
  const grid = $('grid');
  const hours = closeHour - openHour;
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `44px repeat(${days.length}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `auto repeat(${hours}, var(--row, 26px))`;
  const cells = new Map();

  const place = (el, col, row, span = 1) => { el.style.gridColumn = String(col); el.style.gridRow = `${row} / span ${span}`; grid.append(el); };

  days.forEach((date, i) => {
    const head = document.createElement('div');
    head.className = `day-head${date === state.now.date ? ' today' : ''}`;
    head.innerHTML = `<b></b>${fmt(date, { day: 'numeric', month: 'short' })}`;
    head.querySelector('b').textContent = fmt(date, { weekday: 'short' }).replace('.', '');
    place(head, i + 2, 1);
  });

  for (let h = openHour; h < closeHour; h++) {
    const label = document.createElement('div');
    label.className = 'hour';
    label.textContent = `${pad(h)}:00`;
    place(label, 1, h - openHour + 2);

    days.forEach((date, i) => {
      const status = cellStatus(date, h);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `cell ${status.kind}`;
      cell.dataset.date = date;
      cell.dataset.hour = String(h);
      if (bookable(status)) {
        const end = h + status.hours;
        cell.dataset.label = status.kind === 'short' ? `${pad(h)}–${pad(end)} · ${status.hours} h` : `${pad(h)}–${pad(end)}`;
        if (status.kind === 'short') {
          cell.dataset.short = `${status.hours} h`;
          cell.title = shortWarning(status, h);
        }
        const verb = state.moving ? 'Flytta passet till' : 'Boka';
        const extra = status.kind === 'short' ? ` (kort pass, ${status.hours} h)` : '';
        cell.setAttribute('aria-label', `${verb} ${fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })} ${pad(h)}:00–${pad(end)}:00${extra}`);
        cell.addEventListener('click', () => (state.moving ? confirmMove(state.moving, date, h, status) : confirmBooking(date, h, status)));
        cell.addEventListener('mouseenter', () => preview(cells, date, h, status.hours, true));
        cell.addEventListener('mouseleave', () => preview(cells, date, h, status.hours, false));
        cell.addEventListener('focus', () => preview(cells, date, h, status.hours, true));
        cell.addEventListener('blur', () => preview(cells, date, h, status.hours, false));
      } else {
        cell.tabIndex = -1;
        cell.setAttribute('aria-hidden', 'true');
        if (status.kind === 'closed') cell.title = 'Utanför öppettiden.';
        if (status.reason && status.kind !== 'past') {
          cell.title = status.reason;
          cell.addEventListener('click', () => toast(status.reason, true));
        }
      }
      cells.set(`${date}|${h}`, cell);
      place(cell, i + 2, h - openHour + 2);
    });
  }

  const nowIdx = hourIndex(state.now.date, state.now.hour) + state.now.minute / 60;
  for (const b of state.bookings) {
    const col = days.indexOf(b.date);
    if (col < 0) continue;
    const el = document.createElement('div');
    const ended = hourIndex(b.date, b.endHour) <= nowIdx;
    el.className = `booking ${b.mine ? 'mine' : 'taken'}${ended ? ' ended' : ''}`;
    el.innerHTML = '<b></b><span></span>';
    el.querySelector('b').textContent = b.mine ? 'Ditt pass' : b.apartmentName;
    const len = b.endHour - b.startHour;
    el.querySelector('span').textContent = `${pad(b.startHour)}–${pad(b.endHour)}${len < passHours ? ` · ${len} h` : ''}`;
    if (len < passHours) el.classList.add('short-pass');
    if (isMovable(b)) {
      el.classList.add('movable');
      if (state.moving && state.moving.id === b.id) el.classList.add('moving');
      el.title = 'Dra för att flytta – eller klicka för att välja ny tid';
      el.addEventListener('pointerdown', (e) => startDrag(e, b, el));
    }
    place(el, col + 2, b.startHour - openHour + 2, b.endHour - b.startHour);
  }

  const todayCol = days.indexOf(state.now.date);
  if (todayCol >= 0 && state.now.hour >= openHour && state.now.hour < closeHour) {
    const line = document.createElement('div');
    line.className = 'now-line';
    line.style.marginTop = `calc(${(state.now.minute / 60).toFixed(3)} * var(--row, 26px))`;
    place(line, todayCol + 2, state.now.hour - openHour + 2);
  }
}

function preview(cells, date, hour, hours, on) {
  for (let h = hour; h < hour + hours; h++) {
    const c = cells.get(`${date}|${h}`);
    if (!c) continue;
    c.classList.toggle('preview', on);
    if (h === hour) c.classList.toggle('preview-head', on);
  }
}

function setWarning(text) {
  $('confirm-warn').hidden = !text;
  $('confirm-warn').textContent = text;
}

function confirmBooking(date, startHour, status) {
  const hours = status.hours;
  const endHour = startHour + hours;
  setWarning(shortWarning(status, startHour));
  $('confirm-ok').textContent = status.kind === 'short' ? `Boka ${hours} h` : 'Boka';
  $('confirm-title').textContent = `Boka ${fmt(date, { weekday: 'long', day: 'numeric', month: 'long' })}?`;
  $('confirm-text').textContent = `Tvättstugan blir din kl ${pad(startHour)}:00–${pad(endHour)}:00.`;
  const dialog = $('confirm-dialog');
  dialog.returnValue = '';
  dialog.showModal();
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'ok') return;
    try {
      await api('api/bookings', { method: 'POST', body: { date, startHour, hours } });
      toast(`Bokat ${pad(startHour)}:00–${pad(endHour)}:00.`);
    } catch (err) {
      toast(err.message, true);
    }
    load().catch((err) => toast(err.message, true));
  }, { once: true });
}

// ---------- Påminnelser / kalender ----------
const isAndroid = /Android/i.test(navigator.userAgent);
const reminderLabel = (m) => (m >= 1440 ? 'Dagen före' : m >= 60 ? `${m / 60} ${m === 60 ? 'timme' : 'timmar'} före` : `${m} minuter före`);

// Ett enskilt pass: .ics-fil (iPhone, Mac, Outlook) eller Google Kalender på Android.
function setCalendarLink(a, b) {
  a.title = 'Lägg till passet i din kalender';
  if (!isAndroid) {
    a.href = `api/bookings/${b.id}.ics`;
    return;
  }
  // Lokal svensk tid med ctz, oberoende av telefonens tidszon.
  const local = (date, hour) => `${date.replace(/-/g, '')}T${pad(hour)}0000`;
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'Tvättstugan',
    dates: `${local(b.date, b.startHour)}/${local(b.date, b.endHour)}`,
    ctz: 'Europe/Stockholm',
    location: state.config.name,
    details: `Ditt tvättpass ${pad(b.startHour)}:00–${pad(b.endHour)}:00. ${location.origin}${location.pathname}`,
  });
  a.href = `https://calendar.google.com/calendar/render?${q}`;
  a.target = '_blank';
  a.rel = 'noopener';
}

function renderReminders(data) {
  state.reminders = data;
  fillSelect('remind-minutes', data.options, reminderLabel, data.reminderMinutes);
  const webcal = data.feedUrl.replace(/^https?:/, 'webcal:');
  $('remind-apple').href = webcal;
  $('remind-google').href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}

$('btn-remind').addEventListener('click', async () => {
  try {
    renderReminders(await api('api/reminders'));
    $('remind-dialog').showModal();
  } catch (err) {
    toast(err.message, true);
  }
});

$('remind-minutes').addEventListener('change', async () => {
  try {
    renderReminders(await api('api/reminders', { method: 'POST', body: { reminderMinutes: Number($('remind-minutes').value) } }));
    toast(`Påminnelse ${reminderLabel(state.reminders.reminderMinutes).toLowerCase()} passet.`);
  } catch (err) {
    toast(err.message, true);
  }
});

$('remind-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.reminders.feedUrl);
    toast('Länken är kopierad.');
  } catch {
    window.prompt('Kopiera länken:', state.reminders.feedUrl);
  }
});

$('remind-new').addEventListener('click', async () => {
  if (!window.confirm('Skapa en ny kalenderlänk? Den gamla slutar fungera och behöver tas bort ur kalendern.')) return;
  try {
    renderReminders(await api('api/reminders/new-link', { method: 'POST' }));
    toast('Ny länk skapad – lägg till den i kalendern igen.');
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- Flytta pass ----------
function renderMoveBanner() {
  const banner = $('move-banner');
  banner.hidden = !state.moving;
  if (!state.moving) return;
  const { day, time } = describe(state.moving);
  $('move-text').textContent = `Välj en ny starttid för ditt pass ${day} ${time}.`;
}

function startMoveMode(b) {
  state.moving = b;
  if (b.date >= state.weekStart && b.date <= addDays(state.weekStart, 6)) state.selectedDay = b.date;
  render();
  if (narrow.matches) $('move-banner').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function stopMoveMode() {
  state.moving = null;
  render();
}

$('move-cancel').addEventListener('click', stopMoveMode);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.moving && !document.querySelector('dialog[open]')) stopMoveMode();
});

function describeSlot(date, startHour, hours) {
  return describe({ date, startHour, endHour: startHour + hours });
}

function confirmMove(b, date, startHour, status) {
  const from = describe(b);
  const to = describeSlot(date, startHour, status.hours);
  setWarning(shortWarning(status, startHour));
  $('confirm-ok').textContent = status.kind === 'short' ? `Flytta (${status.hours} h)` : 'Flytta';
  $('confirm-title').textContent = 'Flytta ditt pass?';
  $('confirm-text').textContent = `Från ${from.day} ${from.time} till ${to.day} ${to.time}.`;
  const dialog = $('confirm-dialog');
  dialog.returnValue = '';
  dialog.showModal();
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'ok') moveBooking(b, date, startHour, status.hours);
  }, { once: true });
}

async function moveBooking(b, date, startHour, hours) {
  try {
    await api(`api/bookings/${b.id}`, { method: 'POST', body: { date, startHour, hours } });
    const to = describeSlot(date, startHour, hours);
    toast(`Passet är flyttat till ${to.day} ${to.time}.`);
    state.moving = null;
  } catch (err) {
    toast(err.message, true);
  }
  load().catch((err) => toast(err.message, true));
}

const cellAt = (x, y) => document.elementsFromPoint(x, y).find((el) => el.classList && el.classList.contains('cell')) || null;

// Dra ett eget pass till en ny tid. Ett klick utan att dra öppnar "Ändra".
function startDrag(e, b, el) {
  if (e.button !== 0) return;
  const { openHour, closeHour, passHours } = state.config;
  const gridOpen = state.gridOpen;
  const startX = e.clientX;
  const startY = e.clientY;
  const grab = cellAt(e.clientX, e.clientY);
  const grabOffset = grab ? Number(grab.dataset.hour) - b.startHour : 0;
  const ghost = document.createElement('div');
  let dragging = false;
  let target = null;

  const clear = () => ghost.remove();
  const onMove = (ev) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      dragging = true;
      el.classList.add('dragging');
      document.body.classList.add('is-dragging');
    }
    clear();
    target = null;
    const cell = cellAt(ev.clientX, ev.clientY);
    if (!cell) return;
    const date = cell.dataset.date;
    let start = Math.max(openHour, Math.min(closeHour - passHours, Number(cell.dataset.hour) - grabOffset));
    // Släpp där pekaren är; finns bara en kortare lucka där blir det ett kort pass.
    let status = cellStatus(date, start, b.id);
    if (!bookable(status) && start !== Number(cell.dataset.hour)) {
      start = Number(cell.dataset.hour);
      status = cellStatus(date, start, b.id);
    }
    const ok = bookable(status);
    const span = ok ? status.hours : passHours;
    // Markering ovanpå allt annat i rutnätet, så den syns även över andras pass.
    ghost.className = `drop-ghost ${ok ? (status.kind === 'short' ? 'ok short' : 'ok') : 'bad'}`;
    ghost.textContent = !ok ? 'Upptaget' : `${pad(start)}–${pad(start + span)}${status.kind === 'short' ? ` · bara ${span} h` : ''}`;
    ghost.style.gridColumn = cell.style.gridColumn;
    ghost.style.gridRow = `${start - gridOpen + 2} / span ${Math.max(1, Math.min(span, closeHour - start))}`;
    $('grid').append(ghost);
    target = { date, startHour: start, ok, status };
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    clear();
    if (!dragging) return startMoveMode(b);
    if (!target || (target.date === b.date && target.startHour === b.startHour)) return;
    if (!target.ok) return toast(target.status.reason || 'Den tiden går inte att boka.', true);
    // Kort pass bekräftas alltid, så att man ser att det blir kortare.
    if (target.status.kind === 'short') return confirmMove(b, target.date, target.startHour, target.status);
    moveBooking(b, target.date, target.startHour, target.status.hours);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

async function cancelBooking(b) {
  const { day, time } = describe(b);
  if (!window.confirm(`Avboka ditt pass ${day} ${time}?`)) return;
  if (state.moving && state.moving.id === b.id) state.moving = null;
  try {
    await api(`api/bookings/${b.id}`, { method: 'DELETE' });
    toast('Passet är avbokat.');
  } catch (err) {
    toast(err.message, true);
  }
  load().catch((err) => toast(err.message, true));
}

function goToWeek(monday) {
  const prevIndex = state.selectedDay ? (toDate(state.selectedDay) - toDate(state.weekStart)) / 86400000 : 0;
  state.weekStart = monday;
  state.selectedDay = addDays(monday, prevIndex);
  if (state.selectedDay < state.now.date) state.selectedDay = state.now.date;
  load().catch((err) => toast(err.message, true));
}

$('prev-week').addEventListener('click', () => goToWeek(addDays(state.weekStart, -7)));
$('next-week').addEventListener('click', () => goToWeek(addDays(state.weekStart, 7)));
$('today-btn').addEventListener('click', () => { state.selectedDay = state.now.date; goToWeek(mondayOf(state.now.date)); });
narrow.addEventListener('change', () => state.now && renderGrid());

// ---------- Hyresvärd ----------
const PERIODS = [
  ['month', 'Denna månad'], ['last', 'Förra månaden'], ['year', 'I år'], ['12m', '12 mån'], ['all', 'Totalt'],
];
const monthKey = (date, back = 0) => {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (key) => fmt(`${key}-01`, { month: 'long', year: 'numeric' });

function periodCount(apt, period, field = 'months') {
  const today = state.stats.now.date;
  const months = apt[field];
  const sum = (keys) => keys.reduce((n, k) => n + (months[k] || 0), 0);
  if (period === 'month') return sum([monthKey(today)]);
  if (period === 'last') return sum([monthKey(today, 1)]);
  if (period === 'year') return sum(Object.keys(months).filter((k) => k.startsWith(today.slice(0, 4))));
  if (period === '12m') return sum(Array.from({ length: 12 }, (_, i) => monthKey(today, i)));
  return field === 'monthHours' ? apt.totalHours : apt.total;
}

function periodLabel(period) {
  const today = state.stats.now.date;
  if (period === 'month') return monthName(monthKey(today));
  if (period === 'last') return monthName(monthKey(today, 1));
  if (period === 'year') return `år ${today.slice(0, 4)}`;
  if (period === '12m') return `${monthName(monthKey(today, 11))} – ${monthName(monthKey(today))}`;
  return 'sedan start';
}

async function loadStats() {
  state.stats = await api('api/admin/stats');
  renderStats();
}

function renderStats() {
  const { apartments } = state.stats;
  const chips = $('period-chips');
  chips.innerHTML = '';
  for (const [key, label] of PERIODS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(key === state.period));
    b.textContent = label;
    b.addEventListener('click', () => { state.period = key; renderStats(); });
    chips.append(b);
  }

  const counts = apartments.map((a) => periodCount(a, state.period));
  const hoursPer = apartments.map((a) => periodCount(a, state.period, 'monthHours'));
  const total = counts.reduce((a, b) => a + b, 0);
  const totalHours = hoursPer.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  $('stats-sub').textContent = `${total} pass (${totalHours} timmar) totalt, ${periodLabel(state.period)}.`;

  const bars = $('stats-bars');
  bars.innerHTML = '';
  apartments.forEach((apt, i) => {
    const n = counts[i];
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = '<span class="label"></span><div class="bar-track"><div class="bar"></div></div><span class="value"></span><span class="bar-tip"></span>';
    row.querySelector('.label').textContent = apt.name;
    row.querySelector('.bar').style.width = `${(n / max) * 100}%`;
    row.querySelector('.value').innerHTML = `${n} <span>pass</span>`;
    const share = total ? Math.round((n / total) * 100) : 0;
    row.querySelector('.bar-tip').textContent = `${apt.name}: ${n} pass · ${hoursPer[i]} h · ${share} % av alla`;
    row.setAttribute('aria-label', row.querySelector('.bar-tip').textContent);
    bars.append(row);
  });

  const body = $('stats-body');
  body.innerHTML = '';
  const cols = ['month', 'last', 'year', 'all'];
  const totals = [0, 0, 0, 0, 0];
  for (const apt of apartments) {
    const values = [...cols.map((c) => periodCount(apt, c)), apt.upcoming];
    values.forEach((v, i) => { totals[i] += v; });
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="full"></span><span class="short"></span></td>${values.map((v) => `<td>${v}</td>`).join('')}`;
    tr.querySelector('.full').textContent = apt.name;
    tr.querySelector('.short').textContent = apt.name.replace(/^Lägenhet\s*/i, 'Lgh ');
    body.append(tr);
  }
  $('stats-foot').innerHTML = `<tr><td>Summa</td>${totals.map((v) => `<td>${v}</td>`).join('')}</tr>`;

  const list = $('pw-admin-list');
  list.innerHTML = '';
  for (const apt of apartments) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button class="btn ghost small" type="button">Nytt lösenord</button>';
    li.firstChild.textContent = apt.name;
    li.querySelector('button').addEventListener('click', () => resetPassword(apt));
    list.append(li);
  }
}

function resetPassword(apt) {
  const dialog = $('reset-dialog');
  $('reset-title').textContent = `Nytt lösenord för ${apt.name}?`;
  $('reset-cancel').checked = false;
  dialog.returnValue = '';
  dialog.showModal();
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'ok') return;
    try {
      const res = await api('api/admin/reset-password', { method: 'POST', body: { apartmentId: apt.id, cancelUpcoming: $('reset-cancel').checked } });
      $('reset-result-title').textContent = `Nytt lösenord för ${res.apartmentName}`;
      $('reset-password').textContent = res.password;
      $('reset-cancelled').textContent = res.cancelled ? `${res.cancelled} kommande pass avbokades.` : '';
      $('reset-result').showModal();
      loadStats().catch(() => {});
    } catch (err) {
      toast(err.message, true);
    }
  }, { once: true });
}

$('copy-password').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('reset-password').textContent);
    toast('Lösenordet är kopierat.');
  } catch {
    toast('Kunde inte kopiera – skriv av lösenordet.', true);
  }
});

// ---------- Bokningsregler (hyresvärd) ----------
const RULE_FIELDS = {
  openHour: 'r-open', closeHour: 'r-close', passHours: 'r-pass', minPassHours: 'r-min',
  maxActiveBookings: 'r-max', bookingHorizonDays: 'r-horizon',
};

function fillSelect(id, values, label, selected) {
  const sel = $(id);
  sel.innerHTML = '';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = label(v);
    sel.append(o);
  }
  if (selected !== undefined && values.includes(selected)) sel.value = String(selected);
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function readRulesForm() {
  const r = {};
  for (const [key, id] of Object.entries(RULE_FIELDS)) r[key] = Number.parseInt($(id).value, 10);
  return r;
}

// Fyller formuläret och håller beroende val (längd ≤ öppettid, kortaste ≤ längd) giltiga.
function renderRulesForm(r) {
  fillSelect('r-open', range(0, 23), (h) => `${pad(h)}:00`, r.openHour);
  fillSelect('r-close', range(r.openHour + 1, 24), (h) => `${pad(h)}:00`, Math.max(r.closeHour, r.openHour + 1));
  const span = Number($('r-close').value) - r.openHour;
  fillSelect('r-pass', range(1, Math.min(12, span)), hoursText, Math.min(r.passHours, span));
  const pass = Number($('r-pass').value);
  fillSelect('r-min', range(1, pass), (h) => (h === pass ? `Bara hela pass (${hoursText(h)})` : hoursText(h)), Math.min(r.minPassHours, pass));
  $('r-max').value = String(r.maxActiveBookings);
  $('r-horizon').value = String(r.bookingHorizonDays);
  updateRulesSummary();
}

function updateRulesSummary() {
  const r = readRulesForm();
  const valid = Object.values(r).every(Number.isInteger) && r.maxActiveBookings >= 1 && r.bookingHorizonDays >= 1;
  $('rules-summary').textContent = valid ? rulesSummary(r) : 'Fyll i alla fält.';
}

async function loadRules() {
  const data = await api('api/admin/rules');
  state.ruleDefaults = data.defaults;
  renderRulesForm(data.rules);
}

for (const id of ['r-open', 'r-close', 'r-pass']) {
  $(id).addEventListener('change', () => renderRulesForm(readRulesForm()));
}
for (const id of ['r-min', 'r-max', 'r-horizon']) {
  $(id).addEventListener('input', updateRulesSummary);
}

$('rules-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('rules-error').textContent = '';
  try {
    const data = await api('api/admin/rules', { method: 'POST', body: readRulesForm() });
    renderRulesForm(data.rules);
    toast('Reglerna är sparade och gäller nu.');
  } catch (err) {
    $('rules-error').textContent = err.message;
  }
});

$('rules-reset').addEventListener('click', async () => {
  if (!window.confirm(`Återställa standardreglerna?\n\n${rulesSummary(state.ruleDefaults)}`)) return;
  try {
    const data = await api('api/admin/rules', { method: 'DELETE' });
    renderRulesForm(data.rules);
    toast('Standardreglerna gäller igen.');
  } catch (err) {
    toast(err.message, true);
  }
});

function refresh() {
  if (!state.me || document.hidden) return;
  (state.me.isAdmin ? loadStats() : load()).catch(() => {});
}

// ---------- Start ----------
async function startApp() {
  const me = await api('api/me');
  state.me = me;
  $('me-name').textContent = me.apartmentName;
  $('admin-view').hidden = !me.isAdmin;
  $('resident-view').hidden = me.isAdmin;
  if (me.isAdmin) {
    await Promise.all([loadStats(), loadRules()]);
    $('login').hidden = true;
    $('app').hidden = false;
    return;
  }
  const first = await api('api/bookings');
  state.now = first.now;
  applyRules(first.rules);
  // Efter sista starttiden finns inget kvar att boka idag – visa imorgon.
  const lastStart = state.config.closeHour - (state.config.minPassHours || state.config.passHours);
  const firstDay = state.now.hour > lastStart ? addDays(state.now.date, 1) : state.now.date;
  state.weekStart = mondayOf(firstDay);
  state.selectedDay = firstDay;
  await load();
  $('login').hidden = true;
  $('app').hidden = false;
}

const hoursText = (n) => `${n} ${n === 1 ? 'timme' : 'timmar'}`;

function rulesSummary(r) {
  const lastFull = r.closeHour - r.passHours;
  const short = r.minPassHours < r.passHours
    ? `Får ett helt pass inte plats kan man boka ett kortare, ned till ${hoursText(r.minPassHours)}. `
    : '';
  return `Pass om ${hoursText(r.passHours)} mellan ${pad(r.openHour)}:00 och ${pad(r.closeHour)}:00, alla dagar `
    + `(hela pass startar senast ${pad(lastFull)}:00). ${short}`
    + `Max ${r.maxActiveBookings} bokade pass åt gången, upp till ${r.bookingHorizonDays} dagar fram.`;
}

// Reglerna kan ändras av hyresvärden; servern skickar med dem vid varje hämtning.
function applyRules(rules) {
  if (rules) Object.assign(state.config, rules);
  $('rules-text').textContent = rulesSummary(state.config).replace('man boka', 'du boka');
  $('legend-short').hidden = !(state.config.minPassHours < state.config.passHours);
}

async function init() {
  state.config = await api('api/config');
  applyRules();
  try {
    await startApp();
  } catch {
    showLogin();
  }
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', refresh);
}

init();

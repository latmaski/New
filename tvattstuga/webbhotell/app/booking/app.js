'use strict';

// Bokningssidan för de boende. Hjälpfunktioner ($, api, toast, datum,
// anslagstavla …) finns i common.js.
const narrow = window.matchMedia('(max-width: 860px)');

const state = {
  config: null,
  me: null,
  weekStart: null, // måndag, 'YYYY-MM-DD'
  selectedDay: null, // används i mobilvyn
  now: null,
  bookings: [],
  mine: [],
  moving: null, // eget pass som håller på att flyttas (via "Ändra")
};

function describe(b) {
  const day = b.date === state.now.date ? 'idag' : b.date === addDays(state.now.date, 1) ? 'imorgon' : fmt(b.date, { weekday: 'long', day: 'numeric', month: 'short' });
  return { day, time: `${pad(b.startHour)}:00–${pad(b.endHour)}:00` };
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

function showLogin() {
  state.me = null;
  $('app').hidden = true;
  $('login').hidden = false;
  renderAptPicker();
  $('login-password').value = '';
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apartmentId = new FormData(e.target).get('apartment');
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
    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = `note-line${b.note ? '' : ' empty-note'}`;
    noteBtn.textContent = b.note ? `”${b.note}” ✎` : '+ Lägg till anteckning';
    noteBtn.title = 'Anteckningen syns för alla i kalendern';
    noteBtn.addEventListener('click', () => editNote(b));
    li.append(noteBtn);
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
    if (!dayHours(state.config, d)) {
      btn.classList.add('closed');
      btn.title = 'Stängt';
    }
    btn.addEventListener('click', () => { state.selectedDay = d; render(); });
    strip.append(btn);
  }
}

// Lediga timmar från hour fram till nästa pass (eller stängning).
function availableHours(date, hour, ignoreId) {
  const day = dayHours(state.config, date);
  let limit = day ? day[1] : 0;
  let block = false;
  for (const b of state.bookings) {
    if (b.id === ignoreId || b.date !== date) continue;
    if (b.startHour <= hour && hour < b.endHour) return { hours: 0, limit };
    if (b.startHour > hour && b.startHour < limit) limit = b.startHour;
  }
  // Timmar som hyresvärden stängt räknas som upptagna.
  for (const [from, to] of dayBlocks(state.config, date)) {
    if (from <= hour && hour < to) return { hours: 0, limit };
    if (from > hour && from <= limit) { limit = from; block = true; }
  }
  return { hours: limit - hour, limit, block };
}

// Där den lediga luckan börjar: föregående pass slut, öppning eller (idag) nuvarande timme.
function gapStart(date, hour, ignoreId) {
  const day = dayHours(state.config, date);
  let start = day ? day[0] : 0;
  for (const b of state.bookings) {
    if (b.id === ignoreId || b.date !== date) continue;
    if (b.endHour <= hour && b.endHour > start) start = b.endHour;
  }
  for (const [, to] of dayBlocks(state.config, date)) {
    if (to <= hour && to > start) start = to;
  }
  return date === state.now.date ? Math.max(start, state.now.hour) : start;
}

const bookable = (status) => status.kind === 'start' || status.kind === 'short';

// ignoreId: passet som flyttas räknas varken som krock eller mot maxantalet.
// 'start' = helt pass får plats, 'short' = bara ett kortare pass får plats.
function cellStatus(date, hour, ignoreId = state.moving && state.moving.id) {
  const { passHours, maxActiveBookings, bookingHorizonDays } = state.config;
  const minHours = state.config.minPassHours || passHours;
  const day = dayHours(state.config, date);
  const ex = exceptionFor(state.config, date);
  const note = ex && ex.note ? ` (${ex.note})` : '';
  if (!day) return { kind: 'closed', reason: `Tvättstugan är stängd den här dagen${note}.` };
  if (hour < day[0] || hour >= day[1]) return { kind: 'closed', reason: `Öppet ${pad(day[0])}–${pad(day[1])} den här dagen${note}.` };
  for (const [from, to] of dayBlocks(state.config, date)) {
    if (from <= hour && hour < to) return { kind: 'closed', reason: `Stängt ${pad(from)}–${pad(to)} den här dagen${note}.` };
  }
  const closeHour = day[1];
  const start = hourIndex(date, hour);
  if (start < hourIndex(state.now.date, state.now.hour)) return { kind: 'past', reason: 'Tiden har redan passerat.' };
  if (date > addDays(state.now.date, bookingHorizonDays)) return { kind: 'blocked', reason: `Du kan boka högst ${bookingHorizonDays} dagar fram.` };
  const free = availableHours(date, hour, ignoreId);
  if (free.hours <= 0) return { kind: 'blocked', reason: 'Tiden är redan bokad.' };
  if (free.hours < minHours) return { kind: 'blocked', reason: `Bara ${free.hours} h ledigt här, minst ${minHours} h krävs.` };
  if (!ignoreId && state.mine.length >= maxActiveBookings) return { kind: 'blocked', reason: `Du har redan ${maxActiveBookings} pass bokade.` };
  const hours = Math.min(passHours, free.hours);
  if (hours === passHours) return { kind: 'start', hours };
  // Före ett annat pass: korta pass bara i luckor där ett helt pass inte får plats.
  // I slutet av dagen (fram till stängning) är korta pass alltid tillåtna.
  if (free.limit < closeHour && free.limit - gapStart(date, hour, ignoreId) >= passHours) {
    return { kind: 'blocked', reason: `Här får ett helt pass plats – välj en tidigare starttid (senast ${pad(free.limit - passHours)}:00).` };
  }
  const why = free.limit === closeHour ? `tvättstugan stänger ${pad(closeHour)}:00`
    : free.block ? `tvättstugan är stängd från ${pad(free.limit)}:00` : `nästa pass börjar ${pad(free.limit)}:00`;
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
  // Raderna täcker de visade dagarnas öppettider, och även pass utanför dem
  // (bokade före en regeländring).
  const open = days.map((d) => dayHours(state.config, d)).filter(Boolean);
  let openHour = open.length ? Math.min(...open.map((d) => d[0])) : state.config.openHour;
  let closeHour = open.length ? Math.max(...open.map((d) => d[1])) : state.config.closeHour;
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
    const closed = !dayHours(state.config, date);
    const ex = exceptionFor(state.config, date);
    head.className = `day-head${date === state.now.date ? ' today' : ''}${closed ? ' closed' : ''}${ex ? ' has-exception' : ''}`;
    head.innerHTML = `<b></b>${closed ? 'Stängt' : fmt(date, { day: 'numeric', month: 'short' })}`;
    head.querySelector('b').textContent = fmt(date, { weekday: 'short' }).replace('.', '') + (ex ? ' ⚠' : '');
    if (ex) head.title = `${describeException(ex)}${ex.note ? ` – ${ex.note}` : ''}`;
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
    el.querySelector('b').textContent = (b.mine ? 'Ditt pass' : b.apartmentName) + (b.note ? ' 💬' : '');
    const len = b.endHour - b.startHour;
    if (b.note) {
      const note = document.createElement('em');
      note.className = 'note';
      note.textContent = b.note;
      el.append(note);
      el.classList.add('has-note');
      if (!b.mine) {
        el.title = `${b.apartmentName}: ${b.note}`;
        el.addEventListener('click', () => showNote(b));
      }
    }
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

  // Timmar som hyresvärden stängt (t.ex. service) visas som ett eget block.
  days.forEach((date, i) => {
    const ex = exceptionFor(state.config, date);
    for (const [from, to] of dayBlocks(state.config, date)) {
      const el = document.createElement('div');
      el.className = 'booking closed-block';
      el.innerHTML = '<b>Stängt</b><span></span>';
      el.querySelector('span').textContent = `${pad(from)}–${pad(to)}`;
      if (ex.note) {
        const note = document.createElement('em');
        note.className = 'note';
        note.textContent = ex.note;
        el.append(note);
      }
      el.title = `Stängt ${pad(from)}–${pad(to)}${ex.note ? ` – ${ex.note}` : ''}`;
      place(el, i + 2, Math.max(from, openHour) - openHour + 2, Math.min(to, closeHour) - Math.max(from, openHour));
    }
  });

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
  $('confirm-note-field').hidden = false;
  $('confirm-note').value = '';
  const dialog = $('confirm-dialog');
  dialog.returnValue = '';
  dialog.showModal();
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'ok') return;
    try {
      await api('api/bookings', { method: 'POST', body: { date, startHour, hours, note: $('confirm-note').value } });
      toast(`Bokat ${pad(startHour)}:00–${pad(endHour)}:00.`);
    } catch (err) {
      toast(err.message, true);
    }
    load().catch((err) => toast(err.message, true));
  }, { once: true });
}

// Enter i anteckningsfältet ska boka, inte välja dialogens första knapp (Avbryt).
$('confirm-note').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('confirm-dialog').close('ok');
  }
});

// ---------- Anteckningar ----------
function showNote(b) {
  const { day, time } = describe(b);
  $('note-view-title').textContent = b.apartmentName;
  $('note-view-time').textContent = `${day.charAt(0).toUpperCase()}${day.slice(1)} ${time}`;
  $('note-view-text').textContent = b.note;
  $('note-view').showModal();
}

let editingNote = null;
function editNote(b) {
  editingNote = b;
  const { day, time } = describe(b);
  $('note-title').textContent = `Anteckning – ${day} ${time}`;
  $('note-input').value = b.note || '';
  $('note-error').textContent = '';
  $('note-dialog').showModal();
  $('note-input').focus();
}

$('note-cancel').addEventListener('click', () => $('note-dialog').close());
$('note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const saved = await api(`api/bookings/${editingNote.id}/note`, { method: 'POST', body: { note: $('note-input').value } });
    $('note-dialog').close();
    toast(saved.note ? 'Anteckningen är sparad.' : 'Anteckningen är borttagen.');
    load().catch((err) => toast(err.message, true));
  } catch (err) {
    $('note-error').textContent = err.message;
  }
});

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
  $('confirm-note-field').hidden = true;
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
  const { passHours } = state.config;
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
    const [openHour, closeHour] = dayHours(state.config, date) || [0, 24];
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
    ghost.textContent = !ok ? (status.kind === 'closed' ? 'Stängt' : 'Upptaget') : `${pad(start)}–${pad(start + span)}${status.kind === 'short' ? ` · bara ${span} h` : ''}`;
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

// ---------- Anslagstavla ----------
const board = createBoard($('board'), 'api/');

function refresh() {
  if (!state.me || document.hidden) return;
  load().catch(() => {});
  board.load().catch(() => {});
}

// ---------- Start ----------
async function startApp() {
  const me = await api('api/me');
  state.me = me;
  $('me-name').textContent = me.apartmentName;
  board.load().catch(() => {});
  const first = await api('api/bookings');
  state.now = first.now;
  applyRules(first.rules);
  // Efter sista starttiden finns inget kvar att boka idag – visa imorgon.
  const today = dayHours(state.config, state.now.date);
  const lastStart = today ? today[1] - (state.config.minPassHours || state.config.passHours) : -1;
  const firstDay = state.now.hour > lastStart ? addDays(state.now.date, 1) : state.now.date;
  state.weekStart = mondayOf(firstDay);
  state.selectedDay = firstDay;
  await load();
  $('login').hidden = true;
  $('app').hidden = false;
}

// Reglerna kan ändras av hyresvärden; servern skickar med dem vid varje hämtning.
function applyRules(rules) {
  if (rules) Object.assign(state.config, rules);
  $('rules-text').textContent = rulesSummary(state.config).replace('man boka', 'du boka');
  $('legend-short').hidden = !(state.config.minPassHours < state.config.passHours);
  renderExceptions();
}

// Kommande avvikande dagar med hyresvärdens anteckning, under "Mina pass".
function renderExceptions() {
  const today = state.now ? state.now.date : '';
  const list = Object.values(state.config.exceptions || {})
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const ul = $('exceptions-list');
  ul.innerHTML = '';
  $('exceptions').hidden = !list.length;
  for (const e of list) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><span class="ex-what"></span><span class="ex-note"></span>';
    li.querySelector('b').textContent = fmt(e.date, { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
    li.querySelector('.ex-what').textContent = describeException(e);
    li.querySelector('.ex-note').textContent = e.note;
    if (!e.note) li.querySelector('.ex-note').remove();
    ul.append(li);
  }
}

async function init() {
  window.onUnauthorized = showLogin;
  state.config = await api('api/config');
  for (const el of document.querySelectorAll('.building-name')) el.textContent = state.config.name;
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

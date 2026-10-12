'use strict';

// Gemensamt för startsidan och bokningssidorna.

const $ = (id) => document.getElementById(id);

// ---------- Datum (alltid som 'YYYY-MM-DD'-strängar i lokal tid) ----------
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (s) => addDays(s, -((toDate(s).getUTCDay() + 6) % 7));
const fmt = (s, opts) => toDate(s).toLocaleDateString('sv-SE', { timeZone: 'UTC', ...opts });
const pad = (h) => String(h).padStart(2, '0');
const hourIndex = (date, hour) => toDate(date).getTime() / 3600000 + hour;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const hoursText = (n) => `${n} ${n === 1 ? 'timme' : 'timmar'}`;

function isoWeek(s) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

// ---------- API ----------
// Sidan sätter window.onUnauthorized för att visa inloggningen vid 401.
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith('api/login')) {
    if (window.onUnauthorized) window.onUnauthorized();
    throw new Error(data.error || 'Du är inte inloggad.');
  }
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

function localStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function localStorageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* privat läge */ } }

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

// ---------- Öppettider (veckoschema) ----------
const DAY_NAMES = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
const DAY_SHORT = ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön'];
const weekdayIndex = (date) => (toDate(date).getUTCDay() + 6) % 7; // måndag = 0

// Avvikande dag som hyresvärden lagt in (stängt, andra tider eller stängt några timmar).
const exceptionFor = (r, date) => (r.exceptions && r.exceptions[date]) || null;

// [öppnar, stänger] för ett datum, eller null om stängt.
function dayHours(r, date) {
  const ex = exceptionFor(r, date);
  if (ex && ex.mode === 'closed') return null;
  if (ex && ex.mode === 'hours') return [ex.open, ex.close];
  const days = r.days || Array(7).fill([r.openHour, r.closeHour]);
  return days[weekdayIndex(date)] || null;
}

// Stängda timmar inom en öppen dag: [[från, till]].
function dayBlocks(r, date) {
  const ex = exceptionFor(r, date);
  return ex && ex.mode === 'block' ? [[ex.from, ex.to]] : [];
}

function describeException(ex) {
  if (ex.mode === 'closed') return 'Stängt hela dagen';
  if (ex.mode === 'hours') return `Öppet ${pad(ex.open)}–${pad(ex.close)}`;
  return `Stängt ${pad(ex.from)}–${pad(ex.to)}`;
}

// "mån–fre 06–23, lör 08–18, sön stängt" – dagar i följd med samma tider slås ihop.
function scheduleText(days) {
  const same = (a, b) => (a && b ? a[0] === b[0] && a[1] === b[1] : a === b);
  const parts = [];
  for (let i = 0; i < 7;) {
    let j = i;
    while (j < 6 && same(days[j + 1], days[i])) j++;
    const label = i === j ? DAY_SHORT[i] : `${DAY_SHORT[i]}–${DAY_SHORT[j]}`;
    parts.push(`${label} ${days[i] ? `${pad(days[i][0])}–${pad(days[i][1])}` : 'stängt'}`);
    i = j + 1;
  }
  return parts.join(', ');
}

function rulesSummary(r) {
  const days = r.days || Array(7).fill([r.openHour, r.closeHour]);
  const uniform = days.every((d) => d && d[0] === days[0][0] && d[1] === days[0][1]);
  const short = r.minPassHours < r.passHours
    ? `Får ett helt pass inte plats kan man boka ett kortare, ned till ${hoursText(r.minPassHours)}. `
    : '';
  const hours = uniform
    ? `Pass om ${hoursText(r.passHours)} mellan ${pad(days[0][0])}:00 och ${pad(days[0][1])}:00, alla dagar `
      + `(hela pass startar senast ${pad(days[0][1] - r.passHours)}:00). `
    : `Pass om ${hoursText(r.passHours)}. Öppet ${scheduleText(days)}. `;
  return `${hours}${short}Max ${r.maxActiveBookings} bokade pass åt gången, upp till ${r.bookingHorizonDays} dagar fram.`;
}

function postTime(iso) {
  const d = new Date(iso);
  const tz = { timeZone: 'Europe/Stockholm' };
  const day = d.toLocaleDateString('sv-SE', tz);
  const time = d.toLocaleTimeString('sv-SE', { ...tz, hour: '2-digit', minute: '2-digit' });
  const today = new Date().toLocaleDateString('sv-SE', tz);
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', tz);
  if (day === today) return `idag ${time}`;
  if (day === yesterday) return `igår ${time}`;
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return `${d.toLocaleDateString('sv-SE', { ...tz, weekday: 'short', day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })} ${time}`;
}

// ---------- Anslagstavla ----------
// root innehåller .board-form, .board-text, .board-count, .board-list, .board-more.
// apiBase är t.ex. 'api/' (boende) eller 'api/properties/pukevagen/' (hyresvärd).
function createBoard(root, apiBase) {
  const SHOWN = 8;
  const q = (sel) => root.querySelector(sel);
  let expanded = false;
  let base = apiBase;

  function render(posts) {
    const list = q('.board-list');
    list.innerHTML = '';
    if (!posts.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Inga inlägg ännu.';
      list.append(li);
    }
    for (const p of expanded ? posts : posts.slice(0, SHOWN)) {
      const li = document.createElement('li');
      li.innerHTML = '<div class="meta"><span><b></b> · <time></time></span></div><p class="text"></p>';
      li.querySelector('b').textContent = p.mine ? `${p.authorName} (du)` : p.authorName;
      const time = li.querySelector('time');
      time.dateTime = p.createdAt;
      time.textContent = postTime(p.createdAt);
      time.title = new Date(p.createdAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
      li.querySelector('.text').textContent = p.text;
      if (p.canDelete) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete';
        del.textContent = 'Ta bort';
        del.addEventListener('click', () => remove(p));
        li.querySelector('.meta').append(del);
      }
      list.append(li);
    }
    q('.board-more').hidden = expanded || posts.length <= SHOWN;
  }

  async function load() {
    render((await api(`${base}board`)).posts);
  }

  async function remove(p) {
    if (!window.confirm('Ta bort inlägget?')) return;
    try {
      await api(`${base}board/${p.id}`, { method: 'DELETE' });
      toast('Inlägget är borttaget.');
    } catch (err) {
      toast(err.message, true);
    }
    load().catch(() => {});
  }

  const updateCount = () => {
    const n = q('.board-text').value.length;
    q('.board-count').textContent = n > 400 ? `${n}/500` : '';
  };
  q('.board-text').addEventListener('input', updateCount);
  q('.board-more').addEventListener('click', () => { expanded = true; load().catch(() => {}); });
  q('.board-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api(`${base}board`, { method: 'POST', body: { text: q('.board-text').value } });
      q('.board-text').value = '';
      updateCount();
      render(data.posts);
      toast('Inlägget är publicerat.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  return {
    load,
    // Byt fastighet (hyresvärdens vy).
    use(newBase) {
      base = newBase;
      expanded = false;
      q('.board-text').value = '';
      updateCount();
    },
  };
}

'use strict';

// Startsidan: länkar till bokningssidorna och hyresvärdens administration.
// Hjälpfunktioner ($, api, toast, createBoard …) finns i common.js.

const state = {
  properties: [],
  slug: null,
  property: null,
  stats: null,
  period: 'month',
  ruleDefaults: null,
};
const base = () => `api/properties/${state.slug}/`;

// Stäng-knappar i dialoger.
for (const btn of document.querySelectorAll('dialog [data-close]')) {
  btn.addEventListener('click', () => btn.closest('dialog').close());
}

// ---------- Startsidan ----------
function renderLinks() {
  const list = $('property-links');
  list.innerHTML = '';
  for (const p of state.properties) {
    const li = document.createElement('li');
    li.innerHTML = '<a class="property-link"><span class="pl-text"><b></b><span>Tvättstugebokning</span></span><span class="pl-arrow" aria-hidden="true">→</span></a>';
    li.querySelector('a').href = p.url;
    li.querySelector('b').textContent = p.name;
    list.append(li);
  }
}

async function loadSite() {
  const site = await api('api/site');
  state.properties = site.properties;
  renderLinks();
}

function showLanding() {
  $('admin').hidden = true;
  $('landing').hidden = false;
  document.body.classList.add('start-page');
}

// ---------- Inloggning ----------
$('open-admin-login').addEventListener('click', () => {
  $('login-form').reset();
  $('login-error').textContent = '';
  $('login-dialog').showModal();
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await api('api/login', { method: 'POST', body: { password: $('login-password').value } });
    $('login-dialog').close();
    await showAdmin();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('btn-logout').addEventListener('click', async () => {
  await api('api/logout', { method: 'POST' }).catch(() => {});
  showLanding();
});

$('btn-password').addEventListener('click', () => {
  $('password-form').reset();
  $('pw-error').textContent = '';
  $('password-dialog').showModal();
});
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

// ---------- Administration ----------
const board = createBoard($('board'), 'api/properties/-/');

async function showAdmin() {
  await loadSite();
  $('landing').hidden = true;
  $('admin').hidden = false;
  document.body.classList.remove('start-page');
  const remembered = localStorageGet('adminProperty');
  const slug = state.properties.some((p) => p.slug === remembered) ? remembered : state.properties[0]?.slug;
  renderNav();
  if (slug) await selectProperty(slug);
}

function renderNav() {
  const list = $('property-nav');
  list.innerHTML = '';
  for (const p of state.properties) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = p.name;
    btn.setAttribute('aria-current', String(p.slug === state.slug));
    btn.addEventListener('click', () => selectProperty(p.slug).catch((err) => toast(err.message, true)));
    li.append(btn);
    list.append(li);
  }
}

async function selectProperty(slug) {
  state.slug = slug;
  localStorageSet('adminProperty', slug);
  renderNav();
  board.use(base());
  const [property] = await Promise.all([api(base()), loadStats(), loadRules(), board.load()]);
  renderProperty(property);
}

function renderProperty(p) {
  state.property = p;
  $('p-name').textContent = p.name;
  $('p-url').textContent = p.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  $('p-url').href = p.url;
  renderApartments();
}

// ---------- Statistik ----------
const PERIODS = [
  ['month', 'Denna månad'], ['last', 'Förra månaden'], ['year', 'I år'], ['12m', '12 mån'], ['all', 'Totalt'],
];
const monthKey = (date, back = 0) => {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 7);
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
  state.stats = await api(`${base()}stats`);
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
}

// ---------- Lägenheter och lösenord ----------
function renderApartments() {
  const list = $('pw-admin-list');
  list.innerHTML = '';
  for (const apt of state.property.apartments) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="apt-name"></span><span class="apt-actions"><button class="btn ghost small" type="button" data-act="rename">Byt namn</button><button class="btn ghost small" type="button" data-act="reset">Nytt lösenord</button></span>';
    li.querySelector('.apt-name').textContent = apt.name;
    li.querySelector('[data-act="rename"]').addEventListener('click', () => editApartment(apt));
    li.querySelector('[data-act="reset"]').addEventListener('click', () => resetPassword(apt));
    list.append(li);
  }
}

let editingApartment = null;
function editApartment(apt) {
  editingApartment = apt;
  $('apt-title').textContent = apt ? `Byt namn på ${apt.name}` : `Ny lägenhet i ${state.property.name}`;
  $('apt-name').value = apt ? apt.name : `Lägenhet ${state.property.apartments.length + 1}`;
  $('apt-error').textContent = '';
  $('apt-dialog').showModal();
}
$('btn-add-apartment').addEventListener('click', () => editApartment(null));
$('apt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const path = editingApartment ? `${base()}apartments/${editingApartment.id}` : `${base()}apartments`;
  try {
    const res = await api(path, { method: 'POST', body: { name: $('apt-name').value } });
    $('apt-dialog').close();
    renderProperty(await api(base()));
    loadStats().catch(() => {});
    if (res.password) showPassword(`Lösenord för ${res.apartment.name}`, res.password, '');
    else toast('Namnet är ändrat.');
  } catch (err) {
    $('apt-error').textContent = err.message;
  }
});

function showPassword(title, password, extra) {
  $('reset-result-title').textContent = title;
  $('reset-password').textContent = password;
  $('reset-cancelled').textContent = extra;
  $('reset-result').showModal();
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
      const res = await api(`${base()}reset-password`, { method: 'POST', body: { apartmentId: apt.id, cancelUpcoming: $('reset-cancel').checked } });
      showPassword(`Nytt lösenord för ${res.apartmentName}`, res.password, res.cancelled ? `${res.cancelled} kommande pass avbokades.` : '');
      loadStats().catch(() => {});
    } catch (err) {
      toast(err.message, true);
    }
  }, { once: true });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Kopierat.');
  } catch {
    toast('Kunde inte kopiera – skriv av det i stället.', true);
  }
}
$('copy-password').addEventListener('click', () => copyText($('reset-password').textContent));

// ---------- Bokningsregler ----------
const RULE_FIELDS = {
  passHours: 'r-pass', minPassHours: 'r-min', maxActiveBookings: 'r-max', bookingHorizonDays: 'r-horizon',
};

// Veckoschemat: en rad per dag med öppnar/stänger och "Stängt".
function readDays() {
  return [...$('r-days').rows].map((row) => {
    if (row.querySelector('.d-closed').checked) return null;
    const open = Number(row.querySelector('.d-open').value);
    return [open, Math.max(open + 1, Number(row.querySelector('.d-close').value))];
  });
}

function renderDays(days) {
  const body = $('r-days');
  body.innerHTML = '';
  days.forEach((d, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th scope="row"></th><td><select class="d-open" aria-label="Öppnar ${DAY_NAMES[i]}"></select></td>`
      + `<td><select class="d-close" aria-label="Stänger ${DAY_NAMES[i]}"></select></td>`
      + `<td><input class="d-closed" type="checkbox" aria-label="Stängt ${DAY_NAMES[i]}"></td>`;
    tr.querySelector('th').textContent = DAY_NAMES[i].charAt(0).toUpperCase() + DAY_NAMES[i].slice(1);
    const [open, close] = d || days.find(Boolean) || [6, 23];
    const fill = (sel, values, selected) => {
      for (const v of values) sel.add(new Option(`${pad(v)}:00`, String(v), false, v === selected));
    };
    fill(tr.querySelector('.d-open'), range(0, 23), open);
    fill(tr.querySelector('.d-close'), range(open + 1, 24), Math.max(close, open + 1));
    tr.querySelector('.d-closed').checked = !d;
    tr.classList.toggle('is-closed', !d);
    for (const el of tr.querySelectorAll('select')) el.disabled = !d;
    tr.addEventListener('change', () => renderRulesForm(readRulesForm()));
    body.append(tr);
  });
}

function readRulesForm() {
  const r = { days: readDays() };
  for (const [key, id] of Object.entries(RULE_FIELDS)) r[key] = Number.parseInt($(id).value, 10);
  return r;
}

// Fyller formuläret och håller beroende val (längd ≤ längsta öppettid, kortaste ≤ längd) giltiga.
function renderRulesForm(r) {
  const days = r.days || Array(7).fill([r.openHour, r.closeHour]);
  renderDays(days);
  const span = Math.max(1, ...days.filter(Boolean).map((d) => d[1] - d[0]));
  fillSelect('r-pass', range(1, Math.min(12, span)), hoursText, Math.min(r.passHours, span));
  const pass = Number($('r-pass').value);
  fillSelect('r-min', range(1, pass), (h) => (h === pass ? `Bara hela pass (${hoursText(h)})` : hoursText(h)), Math.min(r.minPassHours, pass));
  $('r-max').value = String(r.maxActiveBookings);
  $('r-horizon').value = String(r.bookingHorizonDays);
  $('rules-error').textContent = '';
  updateRulesSummary();
}

function updateRulesSummary() {
  const r = readRulesForm();
  const valid = Object.keys(RULE_FIELDS).every((k) => Number.isInteger(r[k])) && r.maxActiveBookings >= 1 && r.bookingHorizonDays >= 1;
  if (!r.days.some(Boolean)) $('rules-summary').textContent = 'Minst en dag måste vara öppen.';
  else $('rules-summary').textContent = valid ? rulesSummary(r) : 'Fyll i alla fält.';
}

async function loadRules() {
  const data = await api(`${base()}rules`);
  state.ruleDefaults = data.defaults;
  renderRulesForm(data.rules);
}

$('r-pass').addEventListener('change', () => renderRulesForm(readRulesForm()));
$('r-copy-monday').addEventListener('click', () => {
  const r = readRulesForm();
  renderRulesForm({ ...r, days: Array(7).fill(r.days[0] || [6, 23]) });
});
for (const id of ['r-min', 'r-max', 'r-horizon']) {
  $(id).addEventListener('input', updateRulesSummary);
}

$('rules-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('rules-error').textContent = '';
  try {
    renderRulesForm((await api(`${base()}rules`, { method: 'POST', body: readRulesForm() })).rules);
    toast('Reglerna är sparade och gäller nu.');
  } catch (err) {
    $('rules-error').textContent = err.message;
  }
});

$('rules-reset').addEventListener('click', async () => {
  if (!window.confirm(`Återställa standardreglerna?\n\n${rulesSummary(state.ruleDefaults)}`)) return;
  try {
    renderRulesForm((await api(`${base()}rules`, { method: 'DELETE' })).rules);
    toast('Standardreglerna gäller igen.');
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- Ändra fastighet ----------
$('btn-edit-property').addEventListener('click', () => {
  $('ep-name').value = state.property.name;
  $('ep-url').value = state.property.customUrl;
  $('ep-error').textContent = '';
  $('edit-dialog').showModal();
});
$('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const p = await api(base(), { method: 'POST', body: { name: $('ep-name').value, url: $('ep-url').value } });
    $('edit-dialog').close();
    await loadSite();
    renderNav();
    renderProperty(p);
    toast('Fastigheten är uppdaterad.');
  } catch (err) {
    $('ep-error').textContent = err.message;
  }
});

// ---------- Lägg till fastighet ----------
const slugify = (s) => s.toLowerCase()
  .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
let slugTouched = false;

function updateUrlPreview() {
  const slug = $('np-slug').value || 'kortnamn';
  $('np-url-preview').textContent = `Bokningen hamnar på ${location.origin}/${slug}/`;
}

$('btn-add-property').addEventListener('click', () => {
  $('property-form').reset();
  slugTouched = false;
  $('np-apartments').value = range(1, 4).map((n) => `Lägenhet ${n}`).join('\n');
  $('np-error').textContent = '';
  updateUrlPreview();
  $('property-dialog').showModal();
});
$('np-name').addEventListener('input', () => {
  if (!slugTouched) $('np-slug').value = slugify($('np-name').value);
  updateUrlPreview();
});
$('np-slug').addEventListener('input', () => {
  slugTouched = true;
  updateUrlPreview();
});

$('property-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('np-error').textContent = '';
  const apartments = $('np-apartments').value.split('\n').map((s) => s.trim()).filter(Boolean);
  try {
    const res = await api('api/properties', { method: 'POST', body: { name: $('np-name').value, slug: $('np-slug').value, apartments } });
    $('property-dialog').close();
    await loadSite();
    await selectProperty(res.property.slug);
    showCreated(res);
  } catch (err) {
    $('np-error').textContent = err.message;
  }
});

function showCreated(res) {
  $('created-title').textContent = `${res.property.name} är skapad`;
  $('created-url').textContent = `Bokningssidan: ${res.property.url}`;
  $('created-folder').hidden = res.folderCreated;
  $('created-folder').textContent = res.folderCreated ? '' : `Mappen för bokningssidan kunde inte skapas automatiskt. Skapa mappen public_html/${res.property.slug}/ och kopiera dit index.php och .htaccess från en annan fastighet (ändra kortnamnet i index.php).`;
  const tbody = $('created-passwords');
  tbody.innerHTML = '';
  for (const p of res.passwords) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td><code></code></td>';
    tr.firstChild.textContent = p.name;
    tr.querySelector('code').textContent = p.password;
    tbody.append(tr);
  }
  state.created = res;
  $('created-dialog').showModal();
}
$('created-copy').addEventListener('click', () => {
  const r = state.created;
  copyText(`${r.property.name}\n${r.property.url}\n\n${r.passwords.map((p) => `${p.name}: ${p.password}`).join('\n')}`);
});
$('created-print').addEventListener('click', () => window.print());

// ---------- Start ----------
async function init() {
  window.onUnauthorized = showLanding;
  try {
    await loadSite();
  } catch (err) {
    toast(err.message, true);
  }
  // Redan inloggad som hyresvärd? Fråga utan att visa felmeddelanden.
  const me = await fetch('api/me').catch(() => null);
  if (me && me.ok) await showAdmin().catch((err) => toast(err.message, true));
}

init();

'use strict';

// Startar hela webbplatsen i PHP:s inbyggda server mot en tillfällig datamapp
// och en fejkad klocka. Startsidan ligger på /, Stora Pukevägen på /pukevagen/.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// prepare(dataDir) körs innan servern startar, t.ex. för att lägga in en gammal databas.
async function setup(localTime = '2026-10-07T12:30:00+02:00', { prepare } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvatt-'));
  const dataDir = path.join(dir, 'data');
  const webRoot = path.join(dir, 'public_html');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(webRoot);
  if (prepare) prepare(dataDir);
  const nowFile = path.join(dir, 'now.txt');
  const setClock = (iso) => fs.writeFileSync(nowFile, iso);
  setClock(localTime);
  const port = await freePort();
  const php = spawn('php', ['-S', `127.0.0.1:${port}`, 'dev-router.php'], {
    cwd: ROOT,
    env: { ...process.env, TVATT_DATA_DIR: dataDir, TVATT_WEBROOT: webRoot, TVATT_TEST_NOW_FILE: nowFile },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/site`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  await fetch(`${base}/pukevagen/api/config`); // skapar fastigheten och dess lösenord

  const readPasswords = () => {
    const passwords = {};
    const text = fs.readFileSync(path.join(dataDir, 'losenord.txt'), 'utf8');
    for (const m of text.matchAll(/^Lägenhet (\d+): (\S+)$/gm)) passwords[m[1]] = m[2];
    for (const m of text.matchAll(/^Hyresvärd: (\S+)$/gm)) passwords.admin = m[1];
    return passwords;
  };
  const passwords = readPasswords();

  // prefix: '/pukevagen' för de boendes anrop, '' för startsidan.
  const client = (prefix = '/pukevagen') => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + prefix + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* inte JSON, t.ex. kalenderfil */ }
      return { status: res.status, body: json, text, headers: res.headers };
    };
  };
  const admin = async () => {
    const c = client('');
    await c('POST', '/api/login', { password: passwords.admin });
    return c;
  };
  const login = async (id, prefix = '/pukevagen', password = passwords[id]) => {
    if (id === 'admin') return admin();
    const c = client(prefix);
    await c('POST', '/api/login', { apartmentId: id, password });
    return c;
  };

  return {
    base, dir, dataDir, webRoot, passwords, readPasswords, client, login, admin, setClock,
    dataFile: path.join(dataDir, 'properties', 'pukevagen', 'db.json'),
    close: () => { php.kill(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

module.exports = { setup };

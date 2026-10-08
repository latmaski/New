'use strict';

// Startar PHP:s inbyggda server mot en tillfällig datamapp och en fejkad klocka.
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

async function setup(localTime = '2026-10-07T12:30:00+02:00') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvatt-'));
  const nowFile = path.join(dir, 'now.txt');
  const setClock = (iso) => fs.writeFileSync(nowFile, iso);
  setClock(localTime);
  const port = await freePort();
  const php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'public', 'dev-router.php'], {
    cwd: ROOT,
    env: { ...process.env, TVATT_DATA_DIR: path.join(dir, 'data'), TVATT_TEST_NOW_FILE: nowFile },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/api/config`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  const passwords = {};
  const text = fs.readFileSync(path.join(dir, 'data', 'losenord.txt'), 'utf8');
  for (const m of text.matchAll(/^Lägenhet (\d+): (\S+)$/gm)) passwords[m[1]] = m[2];
  passwords.admin = /^Hyresvärd: (\S+)$/m.exec(text)[1];

  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
    };
  };
  const login = async (id) => {
    const c = client();
    await c('POST', '/api/login', { apartmentId: id, password: passwords[id] });
    return c;
  };

  return {
    base, dir, passwords, client, login, setClock,
    dataFile: path.join(dir, 'data', 'db.json'),
    close: () => { php.kill(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

module.exports = { setup };

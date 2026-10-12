'use strict';

// Bygger tvattstuga-webbhotell.zip av public/ och stämplar ett nytt
// versionsnummer på style.css och app.js i index.html, så att webbläsarna
// hämtar de nya filerna direkt efter en uppladdning.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const zip = path.join(root, 'tvattstuga-webbhotell.zip');
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'tvatt-paket-'));
const version = new Date().toISOString().replace(/\D/g, '').slice(0, 12);

fs.cpSync(path.join(root, 'public'), build, { recursive: true, filter: (src) => !src.includes(`${path.sep}data`) });
const index = path.join(build, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/\?v=[\w-]+/g, `?v=${version}`));
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: build });
fs.rmSync(build, { recursive: true, force: true });
console.log(`Skapade ${path.basename(zip)} (version ${version})`);

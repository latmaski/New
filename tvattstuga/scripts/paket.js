'use strict';

// Bygger tvattstuga-webbhotell.zip av webbhotell/ (utan data). Zip-filen packas
// upp i roten på FTP-kontot, så att app/, public_html/ och pukevagen/ hamnar
// bredvid varandra. Sidorna får automatiskt nya versionsnummer på sina filer.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const zip = path.join(root, 'tvattstuga-webbhotell.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.', '-x', 'data/*', '-x', '*.DS_Store'], { cwd: path.join(root, 'webbhotell') });
console.log(`Skapade ${path.basename(zip)}`);

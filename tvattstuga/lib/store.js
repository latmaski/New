'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Enkel JSON-fil som databas. Servern är en enda process och alla ändringar
// görs synkront, så det blir inga kapplöpningar mellan två bokningar.
class Store {
  constructor(file) {
    this.file = file;
    this.data = { secret: null, users: {}, bookings: [] };
    if (fs.existsSync(file)) {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    if (!this.data.secret) {
      this.data.secret = crypto.randomBytes(32).toString('hex');
      this.save();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };

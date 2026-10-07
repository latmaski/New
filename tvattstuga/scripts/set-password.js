'use strict';

// Användning: node scripts/set-password.js <lägenhets-id> [nytt lösenord]
// Utan lösenord genereras ett slumpat. Loggar ut lägenheten överallt.
const path = require('node:path');
const config = require('../config');
const { Store } = require('../lib/store');
const auth = require('../lib/auth');

const [id, given] = process.argv.slice(2);
const apartment = config.apartments.find((a) => a.id === id);
if (!apartment) {
  console.error(`Okänd lägenhet. Giltiga id: ${config.apartments.map((a) => a.id).join(', ')}`);
  process.exit(1);
}
if (given !== undefined && given.length < 6) {
  console.error('Lösenordet måste vara minst 6 tecken.');
  process.exit(1);
}

const store = new Store(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'));
const password = given || auth.generatePassword();
const version = (store.data.users[id]?.version || 0) + 1;
store.data.users[id] = { ...auth.hashPassword(password), version };
store.save();
console.log(`Nytt lösenord för ${apartment.name}: ${password}`);

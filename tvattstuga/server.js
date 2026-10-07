'use strict';

const http = require('node:http');
const path = require('node:path');
const config = require('./config');
const { Store } = require('./lib/store');
const { createHandler, ensureUsers } = require('./lib/app');

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const store = new Store(dataFile);

const created = ensureUsers(store, config);
if (created.length) {
  console.log('\nNya inloggningar skapade – dela ut lösenorden till respektive lägenhet:');
  for (const { apartment, password } of created) console.log(`  ${apartment.name.padEnd(14)} ${password}`);
  console.log('Lösenorden visas bara nu. Byt med: npm run set-password -- <lägenhets-id> <nytt lösenord>\n');
}

const handler = createHandler({ store, config, secureCookies: process.env.COOKIE_SECURE === '1' });
http.createServer(handler).listen(port, () => {
  console.log(`Tvättstugebokning för ${config.name} körs på http://localhost:${port}`);
});

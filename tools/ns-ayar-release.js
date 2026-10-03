#!/usr/bin/env node
/* Ayar (ns-ayar) — stamps a new version into the service worker.
 * Usage (from the project root):  node tools/ns-ayar-release.js
 * The version is a hash of every file the service worker caches, so it changes exactly when
 * the app changes. Upload the files after running this; users get the update banner. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const swPath = path.join(root, 'ns-ayar-sw.js');
let sw = fs.readFileSync(swPath, 'utf8');

const list = sw.match(/NS_AYAR_ASSETS = \[([\s\S]*?)\]/);
if (!list) throw new Error('NS_AYAR_ASSETS not found in ns-ayar-sw.js');
const assets = [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

const hash = crypto.createHash('sha256');
for (const a of assets) {
  const p = path.join(root, a);
  if (!fs.existsSync(p)) throw new Error('Missing asset listed in ns-ayar-sw.js: ' + a);
  hash.update(a).update(fs.readFileSync(p));
}
const d = new Date(), pad = n => String(n).padStart(2, '0');
const version = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}-${hash.digest('hex').slice(0, 8)}`;

const prev = (sw.match(/NS_AYAR_VERSION = '([^']*)'/) || [])[1];
if (prev && prev.slice(-8) === version.slice(-8)) {
  console.log(`No changes since ${prev}, version kept.`);
} else {
  sw = sw.replace(/NS_AYAR_VERSION = '[^']*'/, `NS_AYAR_VERSION = '${version}'`);
  fs.writeFileSync(swPath, sw);
  console.log(`ns-ayar version: ${prev} -> ${version}`);
}

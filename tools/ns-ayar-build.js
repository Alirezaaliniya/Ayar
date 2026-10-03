#!/usr/bin/env node
/* Ayar (ns-ayar) — builds the upload package.
 * Usage (from the project root):  node tools/ns-ayar-build.js
 * Stamps a new version (tools/ns-ayar-release.js), then writes dist/ns-ayar-upload.zip containing
 * only the files the live site needs: no tests, dev tools, docs, logo source or local data. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const root = path.resolve(__dirname, '..');
require('./ns-ayar-release.js');

// Everything that goes to the server. Folders are included recursively.
const INCLUDE = [
  '.htaccess', 'index.html', 'ns-ayar-sw.js', 'ns-ayar.webmanifest', 'LICENSE',
  'css', 'js', 'fonts', 'icons', 'api',
  // The admin panel lives in a privately named folder (ns-ayar-panel-<random>), not in the repo.
  ...fs.readdirSync(root).filter(n => /^ns-ayar-panel-[a-z0-9]{12,}$/.test(n) && fs.statSync(path.join(root, n)).isDirectory()),
  'brand/ns-ayar-logo.png', 'brand/ns-ayar-logo-dark.png',
  'server/.htaccess', 'server/ns-ayar-bootstrap.php', 'server/ns-ayar-admin-lib.php', 'server/data/.htaccess',
  'tools/.htaccess', 'tools/ns-ayar-admin-password.php'
];

const files = [];
const walk = rel => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error('Missing: ' + rel);
  if (fs.statSync(abs).isDirectory()) fs.readdirSync(abs).sort().forEach(n => walk(path.posix.join(rel, n)));
  else files.push(rel);
};
INCLUDE.forEach(walk);

// Minimal ZIP writer (deflate), so no extra tools are needed.
let CRC;
function crc32(d) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
const parts = [], central = [];
let offset = 0;
for (const rel of files) {
  const data = fs.readFileSync(path.join(root, rel)), packed = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from('ayar/' + rel, 'utf8'), crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt16LE(0x21, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
  parts.push(local, name, packed); central.push(cen, name);
  offset += 30 + name.length + packed.length;
}
const cdSize = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);

const out = path.join(root, 'dist', 'ns-ayar-upload.zip');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([...parts, ...central, end]));
console.log(`${files.length} files -> ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);

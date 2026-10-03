# Ayar (آیار)

Cuts chat screenshots into ready-to-share images, one per message. Everything runs in the
browser; images never leave the device. Works offline once opened (PWA).

All CSS classes, ids, data attributes, storage keys, cache names and files use the `ns-ayar` prefix.

## Structure

| Path | Purpose |
| --- | --- |
| `index.html` | App page |
| `css/ns-ayar.css` | Styles (scoped to `.ns-ayar`) |
| `js/ns-ayar-app.js` | App logic |
| `js/ns-ayar-detect.js` | Chat-bubble detection (pure function) |
| `js/ns-ayar-worker.js` | Runs detection in a Web Worker |
| `ns-ayar-sw.js` | Service worker: offline cache, updates, share target |
| `ns-ayar.webmanifest`, `icons/` | Install as an app |
| `tests/` | Detection tests: open `tests/` in the browser |
| `tools/ns-ayar-release.js` | Stamps a new version before publishing |
| `api/ns-ayar-collect.php` | Receives anonymous usage events |
| `ns-ayar-panel-…/` | Admin panel. Private: its folder name is secret and it is not in this repository |
| `server/` | Shared PHP code + `data/` (SQLite database, secret). Not web-accessible |

## Deploying

1. `node tools/ns-ayar-build.js` — stamps the version and writes `dist/ns-ayar-upload.zip`
   (only what the live site needs: no tests, dev tools, docs or local data).
2. Upload and extract it on the server (it contains an `ayar/` folder).
3. Make `ayar/server/data/` writable by PHP (the database and secret key are created there on first use).
4. Open the admin panel's private address and set the password. On shared hosting (no command
   line) the panel asks for the one-time setup code from `dist/ns-ayar-setup-code.txt`; the code
   is deleted from the host once used. (With shell access, `php tools/ns-ayar-admin-password.php` also works.)
5. Serve the site over HTTPS (needed for offline use and installing).

## Publishing an update

1. Change the files.
2. Run `node tools/ns-ayar-build.js` (it also runs `tools/ns-ayar-release.js`, which hashes every
   cached file into `NS_AYAR_VERSION`).
3. Upload and extract the new package over the old one. It never contains `server/data/` contents
   other than a fresh setup code, so the usage data and the admin password on the host are kept
   (the unused code is deleted automatically, since a password already exists).

Users who already have the app get the new version in the background the next time they are
online, then see a "new version is ready" banner. It only switches when they tap update, so no
one loses work mid-task. If you add a new file the app needs offline, add it to
`NS_AYAR_ASSETS` in `ns-ayar-sw.js`.

The service worker only runs over `https://` (or `http://localhost`).

## Adding a detection test

Put a screenshot in `tests/fixtures/` and add one line to `tests/ns-ayar-fixtures.js` with the
expected result, then open `tests/` in the browser.

## Admin panel

Open the panel's private address (kept outside this repository). The first visit asks for a
password; on a remote host it also asks for the one-time setup code created by the build script.

What is recorded: app opens, images processed (detection result, message count, time), exports
(download / copy / share, count, settings used), upload errors, installs and updates. No images,
file names, IP addresses or personal data. Each browser gets a random id, so "users" means
browsers/devices. Events are queued in the browser and sent when online, so offline use is
counted once the device reconnects (duplicates are ignored). Data older than 400 days is deleted.

Requirements: PHP 7.4+ (8.1+ recommended) with `pdo_sqlite`, or `pdo_mysql` and a MySQL 5.7+ / MariaDB 10.2+
database. Without SQLite (e.g. DirectAdmin) the setup page asks for the MySQL details; all tables use
the `ns_ayar_` prefix, so an existing database can be shared. If the server is missing something, the
panel shows a checklist of what to fix instead of an error. The `server/`, `server/data/` and `tools/` folders are
protected with `.htaccess` (Apache); on nginx, deny them in the site config.

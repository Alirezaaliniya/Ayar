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
| `admin/` | Admin panel (usage report, CSV export) |
| `server/` | Shared PHP code + `data/` (SQLite database, secret). Not web-accessible |

## Publishing an update

1. Change the files.
2. Run `node tools/ns-ayar-release.js` (it hashes every cached file into `NS_AYAR_VERSION`).
3. Upload everything to the server.

Users who already have the app get the new version in the background the next time they are
online, then see a "new version is ready" banner. It only switches when they tap update, so no
one loses work mid-task. If you add a new file the app needs offline, add it to
`NS_AYAR_ASSETS` in `ns-ayar-sw.js`.

The service worker only runs over `https://` (or `http://localhost`).

## Adding a detection test

Put a screenshot in `tests/fixtures/` and add one line to `tests/ns-ayar-fixtures.js` with the
expected result, then open `tests/` in the browser.

## Admin panel

Open `admin/` in the browser. On the first visit from the server itself (localhost) it asks you
to choose a password; on a remote server set it with `php tools/ns-ayar-admin-password.php`.

What is recorded: app opens, images processed (detection result, message count, time), exports
(download / copy / share, count, settings used), upload errors, installs and updates. No images,
file names, IP addresses or personal data. Each browser gets a random id, so "users" means
browsers/devices. Events are queued in the browser and sent when online, so offline use is
counted once the device reconnects (duplicates are ignored). Data older than 400 days is deleted.

Requirements: PHP 8.1+ with `pdo_sqlite`. The `server/`, `server/data/` and `tools/` folders are
protected with `.htaccess` (Apache); on nginx, deny them in the site config.

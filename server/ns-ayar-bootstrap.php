<?php
/**
 * Ayar (ns-ayar) — shared server code: SQLite storage, config, rate limits, request helpers.
 * Only included by api/ and admin/ scripts; the server/ folder itself is not web-accessible.
 *
 * Privacy: no images, no IP addresses and no personal data are stored. Visitors are counted by a
 * random id generated in their browser; IPs are only used, hashed with a daily salt, for rate limits.
 */
declare(strict_types=1);

const NS_AYAR_DATA_DIR = __DIR__ . '/data';
const NS_AYAR_DB_FILE = NS_AYAR_DATA_DIR . '/ns-ayar.sqlite';
const NS_AYAR_CONFIG_FILE = NS_AYAR_DATA_DIR . '/ns-ayar-config.json';
const NS_AYAR_TIMEZONE = 'Asia/Tehran';
const NS_AYAR_RETENTION_DAYS = 400;

date_default_timezone_set(NS_AYAR_TIMEZONE);

function ns_ayar_config(?array $replace = null): array
{
    static $cfg = null;
    if ($replace !== null) {
        return $cfg = $replace;
    }
    if ($cfg !== null) {
        return $cfg;
    }
    ns_ayar_data_dir();
    $cfg = is_file(NS_AYAR_CONFIG_FILE) ? (json_decode((string) file_get_contents(NS_AYAR_CONFIG_FILE), true) ?: []) : [];
    if (empty($cfg['secret'])) {
        $cfg['secret'] = bin2hex(random_bytes(32));
        ns_ayar_config_save($cfg);
    }
    return $cfg;
}

function ns_ayar_config_save(array $cfg): void
{
    ns_ayar_data_dir();
    $tmp = NS_AYAR_CONFIG_FILE . '.tmp';
    file_put_contents($tmp, json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);
    rename($tmp, NS_AYAR_CONFIG_FILE);
    ns_ayar_config($cfg); // keep the in-memory copy in sync
}

function ns_ayar_data_dir(): void
{
    if (!is_dir(NS_AYAR_DATA_DIR)) {
        mkdir(NS_AYAR_DATA_DIR, 0770, true);
    }
    // Defence in depth for Apache; on nginx deny /server/ in the site config instead.
    $ht = NS_AYAR_DATA_DIR . '/.htaccess';
    if (!is_file($ht)) {
        file_put_contents($ht, "Require all denied\n");
    }
}

function ns_ayar_db(): PDO
{
    static $db = null;
    if ($db) {
        return $db;
    }
    ns_ayar_data_dir();
    $db = new PDO('sqlite:' . NS_AYAR_DB_FILE, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $db->exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000; PRAGMA foreign_keys = ON;');
    $db->exec('
        CREATE TABLE IF NOT EXISTS ns_ayar_events (
            id INTEGER PRIMARY KEY,
            eid TEXT NOT NULL UNIQUE,
            vid TEXT NOT NULL,
            type TEXT NOT NULL,
            ts INTEGER NOT NULL,
            day TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT \'{}\',
            device TEXT NOT NULL DEFAULT \'\',
            os TEXT NOT NULL DEFAULT \'\',
            browser TEXT NOT NULL DEFAULT \'\',
            installed INTEGER NOT NULL DEFAULT 0,
            offline INTEGER NOT NULL DEFAULT 0,
            received INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ns_ayar_events_day ON ns_ayar_events (day);
        CREATE INDEX IF NOT EXISTS ns_ayar_events_type_day ON ns_ayar_events (type, day);
        CREATE INDEX IF NOT EXISTS ns_ayar_events_vid ON ns_ayar_events (vid);
        CREATE TABLE IF NOT EXISTS ns_ayar_visitors (
            vid TEXT PRIMARY KEY,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            device TEXT NOT NULL DEFAULT \'\',
            os TEXT NOT NULL DEFAULT \'\',
            browser TEXT NOT NULL DEFAULT \'\',
            installed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS ns_ayar_limits (
            k TEXT PRIMARY KEY,
            n INTEGER NOT NULL,
            until INTEGER NOT NULL
        );
    ');
    return $db;
}

/** Hashed client IP; the salt rotates daily so hashes can't be linked across days. */
function ns_ayar_ip_key(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return hash('sha256', $ip . '|' . date('Y-m-d') . '|' . ns_ayar_config()['secret']);
}

/** Fixed-window counter. Returns false once $max is exceeded within $window seconds. */
function ns_ayar_limit(string $key, int $max, int $window, int $add = 1): bool
{
    $db = ns_ayar_db();
    $now = time();
    $row = $db->prepare('SELECT n, until FROM ns_ayar_limits WHERE k = ?');
    $row->execute([$key]);
    $r = $row->fetch();
    if (!$r || $r['until'] < $now) {
        $db->prepare('REPLACE INTO ns_ayar_limits (k, n, until) VALUES (?, ?, ?)')->execute([$key, $add, $now + $window]);
        return $add <= $max;
    }
    if ($r['n'] + $add > $max) {
        return false;
    }
    $db->prepare('UPDATE ns_ayar_limits SET n = n + ? WHERE k = ?')->execute([$add, $key]);
    return true;
}

function ns_ayar_limit_count(string $key): int
{
    $s = ns_ayar_db()->prepare('SELECT n FROM ns_ayar_limits WHERE k = ? AND until >= ?');
    $s->execute([$key, time()]);
    return (int) ($s->fetchColumn() ?: 0);
}

function ns_ayar_limit_clear(string $key): void
{
    ns_ayar_db()->prepare('DELETE FROM ns_ayar_limits WHERE k = ?')->execute([$key]);
}

/** Coarse device / OS / browser from the User-Agent (never stored raw). */
function ns_ayar_ua(): array
{
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $device = preg_match('/iPad|Tablet|Tab(?!le)/i', $ua) ? 'tablet' : (preg_match('/Mobi|Android|iPhone/i', $ua) ? 'mobile' : 'desktop');
    $os = preg_match('/Android/i', $ua) ? 'Android' : (preg_match('/iPhone|iPad|iPod/i', $ua) ? 'iOS' : (preg_match('/Windows/i', $ua) ? 'Windows' : (preg_match('/Mac OS X|Macintosh/i', $ua) ? 'macOS' : (preg_match('/Linux|CrOS/i', $ua) ? 'Linux' : 'Other'))));
    $browser = 'Other';
    foreach (['SamsungBrowser' => 'Samsung', 'Edg' => 'Edge', 'OPR' => 'Opera', 'Firefox|FxiOS' => 'Firefox', 'Chrome|CriOS' => 'Chrome', 'Safari' => 'Safari'] as $re => $name) {
        if (preg_match('/' . $re . '/', $ua)) {
            $browser = $name;
            break;
        }
    }
    return [$device, $os, $browser];
}

function ns_ayar_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('Cache-Control: no-store');
}

function ns_ayar_is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function ns_ayar_is_local_request(): bool
{
    return in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
}

<?php
/**
 * Ayar (ns-ayar) — shared server code: storage (SQLite or MySQL), config, rate limits, helpers.
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
    // Fail loudly: silently losing the config would e.g. "set" a password that is never saved.
    if (@file_put_contents($tmp, json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX) === false || !@rename($tmp, NS_AYAR_CONFIG_FILE)) {
        throw new RuntimeException('Cannot write ' . basename(NS_AYAR_CONFIG_FILE) . ': server/data is not writable');
    }
    ns_ayar_config($cfg); // keep the in-memory copy in sync
}

function ns_ayar_data_dir(): void
{
    if (!is_dir(NS_AYAR_DATA_DIR)) {
        @mkdir(NS_AYAR_DATA_DIR, 0770, true);
    }
    // Defence in depth for Apache; on nginx deny /server/ in the site config instead.
    $ht = NS_AYAR_DATA_DIR . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents($ht, "Require all denied\n");
    }
}

/*
 * Storage: MySQL/MariaDB when its connection details are saved in the config (set on the admin
 * setup page — for hosts like DirectAdmin where pdo_sqlite cannot be enabled), otherwise a local
 * SQLite file. All tables use the ns_ayar_ prefix, so a shared MySQL database is fine.
 */
function ns_ayar_db_driver(): ?string
{
    if (!empty(ns_ayar_config()['db']['name'])) {
        return 'mysql';
    }
    return extension_loaded('pdo_sqlite') ? 'sqlite' : null;
}

/** Connects to MySQL with the given details ['host', 'port', 'name', 'user', 'pass']. */
function ns_ayar_mysql_connect(array $c): PDO
{
    $dsn = 'mysql:host=' . $c['host'] . ';port=' . (int) ($c['port'] ?? 3306) . ';dbname=' . $c['name'] . ';charset=utf8mb4';
    return new PDO($dsn, (string) $c['user'], (string) $c['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 5,
    ]);
}

function ns_ayar_db(): PDO
{
    static $db = null;
    if ($db) {
        return $db;
    }
    $driver = ns_ayar_db_driver();
    if ($driver === null) {
        throw new RuntimeException('No database: pdo_sqlite is missing and MySQL is not configured yet');
    }
    if ($driver === 'mysql') {
        $db = ns_ayar_mysql_connect(ns_ayar_config()['db']);
    } else {
        ns_ayar_data_dir();
        $db = new PDO('sqlite:' . NS_AYAR_DB_FILE, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $db->exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000;');
    }
    ns_ayar_schema($db, $driver);
    return $db;
}

function ns_ayar_schema(PDO $db, string $driver): void
{
    if ($driver === 'mysql') {
        $t = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        $db->exec('CREATE TABLE IF NOT EXISTS ns_ayar_events (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            eid VARCHAR(40) NOT NULL,
            vid VARCHAR(40) NOT NULL,
            type VARCHAR(20) NOT NULL,
            ts INT UNSIGNED NOT NULL,
            day CHAR(10) NOT NULL,
            data TEXT NOT NULL,
            device VARCHAR(12) NOT NULL DEFAULT \'\',
            os VARCHAR(12) NOT NULL DEFAULT \'\',
            browser VARCHAR(12) NOT NULL DEFAULT \'\',
            installed TINYINT NOT NULL DEFAULT 0,
            offline TINYINT NOT NULL DEFAULT 0,
            received INT UNSIGNED NOT NULL,
            UNIQUE KEY ns_ayar_events_eid (eid),
            KEY ns_ayar_events_day (day),
            KEY ns_ayar_events_type_day (type, day),
            KEY ns_ayar_events_vid (vid)
        )' . $t);
        $db->exec('CREATE TABLE IF NOT EXISTS ns_ayar_visitors (
            vid VARCHAR(40) NOT NULL PRIMARY KEY,
            first_seen INT UNSIGNED NOT NULL,
            last_seen INT UNSIGNED NOT NULL,
            device VARCHAR(12) NOT NULL DEFAULT \'\',
            os VARCHAR(12) NOT NULL DEFAULT \'\',
            browser VARCHAR(12) NOT NULL DEFAULT \'\',
            installed TINYINT NOT NULL DEFAULT 0
        )' . $t);
        $db->exec('CREATE TABLE IF NOT EXISTS ns_ayar_limits (
            k VARCHAR(100) NOT NULL PRIMARY KEY,
            n BIGINT NOT NULL,
            `until` INT UNSIGNED NOT NULL
        )' . $t);
        return;
    }
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
            `until` INTEGER NOT NULL
        );
    ');
}

/** SQL expression reading one key of the events' JSON data column (MySQL quotes strings). */
function ns_ayar_json(string $key): string
{
    return ns_ayar_db_driver() === 'mysql'
        ? "JSON_UNQUOTE(JSON_EXTRACT(data, '$.$key'))"
        : "json_extract(data, '$.$key')";
}

/**
 * Tests MySQL details entered on the setup page. Returns null when usable, otherwise a Persian
 * message saying what to fix (the raw error goes to the host's error log).
 */
function ns_ayar_mysql_check(array $c): ?string
{
    try {
        $db = ns_ayar_mysql_connect($c);
        if ($db->query("SELECT JSON_UNQUOTE(JSON_EXTRACT('{\"a\":\"b\"}', '$.a'))")->fetchColumn() !== 'b') {
            return 'نسخه‌ی MySQL هاست خیلی قدیمی است (حداقل MySQL ۵٫۷ یا MariaDB ۱۰٫۲ لازم است)';
        }
        ns_ayar_schema($db, 'mysql');
        return null;
    } catch (Throwable $e) {
        $m = $e->getMessage();
        error_log('ns-ayar mysql: ' . $m);
        // 1044: the user exists but has no rights on that database name (usually a typo in the name).
        if (stripos($m, 'to database') !== false || stripos($m, 'Unknown database') !== false) {
            return 'دیتابیسی با این نام پیدا نشد یا این کاربر به آن دسترسی ندارد، نام دیتابیس را بررسی کن';
        }
        if (stripos($m, 'Access denied') !== false) {
            return 'نام کاربری یا رمز دیتابیس درست نیست، یا این کاربر به دیتابیس دسترسی ندارد';
        }
        if (preg_match('/2002|2005|getaddrinfo|Connection refused|No such host|timed out/i', $m)) {
            return 'به سرور دیتابیس وصل نشد، آدرس سرور را بررسی کن (معمولاً localhost)';
        }
        if (stripos($m, 'JSON') !== false) {
            return 'نسخه‌ی MySQL هاست خیلی قدیمی است (حداقل MySQL ۵٫۷ یا MariaDB ۱۰٫۲ لازم است)';
        }
        return 'اتصال به دیتابیس برقرار نشد، متن کامل خطا در error_log هاست ثبت شد';
    }
}

/** Hashed client IP; the salt rotates daily so hashes can't be linked across days. */
function ns_ayar_ip_key(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return hash('sha256', $ip . '|' . date('Y-m-d') . '|' . ns_ayar_config()['secret']);
}

/*
 * Fixed-window counters (abuse limits, failed logins). Stored in the database; before a database
 * exists (first-time setup on a host without pdo_sqlite) they live in a small locked JSON file.
 */
const NS_AYAR_LIMITS_FILE = NS_AYAR_DATA_DIR . '/ns-ayar-limits.json';

/** Runs $fn on the file-based counters under an exclusive lock and saves the result. */
function ns_ayar_limits_file(callable $fn)
{
    ns_ayar_data_dir();
    $h = @fopen(NS_AYAR_LIMITS_FILE, 'c+');
    if (!$h) {
        throw new RuntimeException('Cannot open ' . basename(NS_AYAR_LIMITS_FILE) . ': server/data is not writable');
    }
    try {
        flock($h, LOCK_EX);
        $all = json_decode((string) stream_get_contents($h), true) ?: [];
        $now = time();
        $all = array_filter($all, fn($r) => ($r['until'] ?? 0) >= $now);
        $result = $fn($all, $now);
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, json_encode($all));
        return $result;
    } finally {
        flock($h, LOCK_UN);
        fclose($h);
    }
}

/** Returns false once $max is exceeded within $window seconds. */
function ns_ayar_limit(string $key, int $max, int $window, int $add = 1): bool
{
    if (ns_ayar_db_driver() === null) {
        return ns_ayar_limits_file(function (array &$all, int $now) use ($key, $max, $window, $add) {
            if (!isset($all[$key])) {
                $all[$key] = ['n' => $add, 'until' => $now + $window];
                return $add <= $max;
            }
            if ($all[$key]['n'] + $add > $max) {
                return false;
            }
            $all[$key]['n'] += $add;
            return true;
        });
    }
    $db = ns_ayar_db();
    $now = time();
    $row = $db->prepare('SELECT n, `until` FROM ns_ayar_limits WHERE k = ?');
    $row->execute([$key]);
    $r = $row->fetch();
    if (!$r || $r['until'] < $now) {
        $db->prepare('REPLACE INTO ns_ayar_limits (k, n, `until`) VALUES (?, ?, ?)')->execute([$key, $add, $now + $window]);
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
    if (ns_ayar_db_driver() === null) {
        return ns_ayar_limits_file(fn(array &$all) => (int) ($all[$key]['n'] ?? 0));
    }
    $s = ns_ayar_db()->prepare('SELECT n FROM ns_ayar_limits WHERE k = ? AND `until` >= ?');
    $s->execute([$key, time()]);
    return (int) ($s->fetchColumn() ?: 0);
}

function ns_ayar_limit_clear(string $key): void
{
    if (ns_ayar_db_driver() === null) {
        ns_ayar_limits_file(function (array &$all) use ($key) {
            unset($all[$key]);
        });
        return;
    }
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

/**
 * What the server needs, checked live. Each item: [ok, label, how to fix] (Persian, shown on the
 * admin setup page so problems on shared hosting can be fixed without reading server logs).
 */
function ns_ayar_requirements(): array
{
    $r = [];
    $r[] = [PHP_VERSION_ID >= 70400, 'نسخه‌ی PHP (' . PHP_VERSION . ')', 'در پنل هاست بخش PHP Version نسخه‌ی ۸٫۱ یا بالاتر را انتخاب کن، یا از پشتیبانی هاست بخواه'];
    if (!is_dir(NS_AYAR_DATA_DIR)) {
        @mkdir(NS_AYAR_DATA_DIR, 0770, true);
    }
    $writable = is_dir(NS_AYAR_DATA_DIR) && is_writable(NS_AYAR_DATA_DIR);
    $r[] = [$writable, 'دسترسی نوشتن در پوشه‌ی server/data', 'در فایل منیجر هاست پوشه‌ی ayar/server/data را انتخاب کن و Permission آن را ۷۵۵ بگذار، اگر درست نشد ۷۷۵'];
    if (!$writable) {
        return $r;
    }
    $driver = ns_ayar_db_driver();
    if ($driver === null) {
        // No SQLite: MySQL details are asked for on the setup form.
        $mysql = extension_loaded('pdo_mysql');
        $r[] = [$mysql, $mysql ? 'دیتابیس MySQL (اطلاعات اتصال را در فرم وارد کن)' : 'دیتابیس', 'روی هاست نه pdo_mysql فعال است نه pdo_sqlite، از پشتیبانی هاست بخواه pdo_mysql را فعال کنند'];
        return $r;
    }
    try {
        ns_ayar_db()->query('SELECT 1');
        $ok = true;
    } catch (Throwable $e) {
        error_log('ns-ayar database: ' . $e->getMessage());
        $ok = false;
    }
    $r[] = $driver === 'mysql'
        ? [$ok, 'اتصال به دیتابیس MySQL', 'به دیتابیس وصل نشد، اگر نام، کاربر یا رمز دیتابیس عوض شده فایل server/data/ns-ayar-config.json را پاک کن و پنل را دوباره راه‌اندازی کن']
        : [$ok, 'دیتابیس SQLite', 'دیتابیس ساخته نشد، متن کامل خطا در error_log هاست ثبت شده است، آن را برای پشتیبانی هاست بفرست'];
    return $r;
}

function ns_ayar_requirements_ok(): bool
{
    foreach (ns_ayar_requirements() as [$ok]) {
        if (!$ok) {
            return false;
        }
    }
    return true;
}

/** Unicode-aware length that does not depend on the mbstring extension. */
function ns_ayar_strlen(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : (int) preg_match_all('/./us', $s);
}

/** Small delay against guessing; skipped where the host disables usleep(). */
function ns_ayar_slow_down(): void
{
    if (function_exists('usleep')) {
        usleep(400000);
    }
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

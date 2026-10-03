<?php
/**
 * Ayar (ns-ayar) — receives anonymous usage events from the app.
 * The app queues events in the browser (also while offline) and sends them in batches; every event
 * carries a random id so re-sent batches are ignored instead of counted twice.
 */
declare(strict_types=1);
require __DIR__ . '/../server/ns-ayar-bootstrap.php';

ns_ayar_security_headers();

/** Allowed event types and, per type, the data keys that are kept (everything else is dropped). */
const NS_AYAR_EVENT_KEYS = [
    'open' => ['theme', 'online'],
    'analyze' => ['status', 'n', 'ms', 'batch', 'src'],
    'export' => ['kind', 'n', 'what', 'frame', 'size', 'width', 'side', 'strip', 'blur', 'manual'],
    'upload_error' => ['code'],
    'install' => [],
    'update' => [],
];
const NS_AYAR_MAX_BODY = 65536;
const NS_AYAR_MAX_EVENTS = 50;

function ns_ayar_reply(int $code): void
{
    http_response_code($code);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    ns_ayar_reply(405);
}
// Same-origin only: the app is served from this site, so a foreign Origin is never legitimate.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)) {
    ns_ayar_reply(403);
}

$raw = file_get_contents('php://input', false, null, 0, NS_AYAR_MAX_BODY + 1);
if ($raw === false || $raw === '' || strlen($raw) > NS_AYAR_MAX_BODY) {
    ns_ayar_reply(413);
}
$body = json_decode($raw, true);
$vid = is_array($body) ? ($body['v'] ?? '') : '';
$events = is_array($body) ? ($body['e'] ?? null) : null;
if (!is_string($vid) || !preg_match('/^[a-z0-9-]{8,40}$/', $vid) || !is_array($events) || count($events) > NS_AYAR_MAX_EVENTS) {
    ns_ayar_reply(400);
}
$installed = !empty($body['inst']) ? 1 : 0;

try {
    // Abuse limits: per hashed IP and per visitor id, per day.
    if (!ns_ayar_limit('ip:' . ns_ayar_ip_key(), 5000, 86400, count($events)) || !ns_ayar_limit('vid:' . $vid, 3000, 86400, count($events))) {
        ns_ayar_reply(429);
    }

    $db = ns_ayar_db();
    [$device, $os, $browser] = ns_ayar_ua();
    $now = time();
    $ins = $db->prepare('INSERT OR IGNORE INTO ns_ayar_events (eid, vid, type, ts, day, data, device, os, browser, installed, offline, received) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $db->beginTransaction();
    $added = 0;
    foreach ($events as $e) {
        if (!is_array($e)) {
            continue;
        }
        $type = $e['t'] ?? '';
        $eid = $e['id'] ?? '';
        if (!is_string($type) || !isset(NS_AYAR_EVENT_KEYS[$type]) || !is_string($eid) || !preg_match('/^[a-z0-9-]{8,40}$/', $eid)) {
            continue;
        }
        // Events recorded offline keep their original time (bounded to the last 30 days). An event that
        // arrives more than 5 minutes after it happened was queued offline, even if the browser thought
        // it was online (navigator.onLine is only a hint).
        $ts = is_numeric($e['at'] ?? null) ? (int) floor($e['at'] / 1000) : $now;
        if ($ts > $now + 300 || $ts < $now - 30 * 86400) {
            $ts = $now;
        }
        $data = [];
        $in = is_array($e['d'] ?? null) ? $e['d'] : [];
        foreach (NS_AYAR_EVENT_KEYS[$type] as $k) {
            if (!array_key_exists($k, $in)) {
                continue;
            }
            $v = $in[$k];
            if (is_int($v) || is_float($v)) {
                $data[$k] = max(-1e6, min(1e6, $v));
            } elseif (is_bool($v)) {
                $data[$k] = $v ? 1 : 0;
            } elseif (is_string($v) && preg_match('/^[a-z0-9_-]{1,24}$/i', $v)) {
                $data[$k] = $v;
            }
        }
        $ins->execute([$eid, $vid, $type, $ts, date('Y-m-d', $ts), json_encode($data), $device, $os, $browser, $installed, !empty($e['off']) || $now - $ts > 300 ? 1 : 0, $now]);
        $added += $ins->rowCount();
    }
    $db->prepare('INSERT INTO ns_ayar_visitors (vid, first_seen, last_seen, device, os, browser, installed) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(vid) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen), device = excluded.device, os = excluded.os, browser = excluded.browser, installed = MAX(installed, excluded.installed)')
        ->execute([$vid, $now, $now, $device, $os, $browser, $installed]);
    $db->commit();

    // Occasional housekeeping: drop events past the retention period and expired limits.
    if (random_int(1, 200) === 1) {
        $db->prepare('DELETE FROM ns_ayar_events WHERE ts < ?')->execute([$now - NS_AYAR_RETENTION_DAYS * 86400]);
        $db->prepare('DELETE FROM ns_ayar_limits WHERE until < ?')->execute([$now]);
    }
} catch (Throwable $err) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log('ns-ayar collect: ' . $err->getMessage());
    ns_ayar_reply(500);
}
ns_ayar_reply(204);

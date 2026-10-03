/* Ayar (ns-ayar) — app logic (vanilla JS, no dependencies).
 * Screens: landing → analyzing → review (+ crop editor), or landing → batch queue → review.
 * Everything runs in the browser; images never leave the device.
 * Naming: every class, id, data attribute, storage key and cache name starts with "ns-ayar". */
(function () {
  'use strict';

  const $root = document.querySelector('.ns-ayar');
  if (!$root) return;
  const $view = $root.querySelector('#ns-ayar-view');
  const $file = $root.querySelector('#ns-ayar-file');
  const $toast = $root.querySelector('#ns-ayar-toast');
  const $update = $root.querySelector('#ns-ayar-update');
  const CFG = { worker: $root.dataset.nsAyarWorker || '', sw: $root.dataset.nsAyarSw || '', stats: $root.dataset.nsAyarStats || '', base: $root.dataset.nsAyarBase || '' };

  // ---------- constants ----------
  const MAX = 20 * 1024 * 1024, MAX_PX = 80e6, MAX_FILES = 20, MIN = .01;
  const LONG_MAX_W = 1600, LONG_MAX_H = 16000, LONG_MAX_AREA = 16e6; // stay inside mobile canvas limits
  const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const EXT = /\.(png|jpe?g|webp)$/i;
  const FULL = { x: 0, y: 0, w: 1, h: 1 };
  const KEY_THEME = 'ns-ayar-theme', KEY_SETTINGS = 'ns-ayar-settings', KEY_VISITOR = 'ns-ayar-visitor', KEY_QUEUE = 'ns-ayar-stats-queue';
  const SHARE_CACHE = 'ns-ayar-share', SHARE_PARAM = 'ns-ayar-shared';
  const ERR = {
    format: ['این فرمت پشتیبانی نمی‌شود', 'فقط فایل‌های PNG، JPG و WEBP قابل پردازش هستند'],
    size: ['حجم فایل بیشتر از حد مجاز است', 'حداکثر حجم هر تصویر ۲۰ مگابایت است'],
    corrupt: ['این تصویر قابل خواندن نیست', 'فایل ممکن است خراب باشد، دوباره اسکرین‌شات بگیر و امتحان کن'],
    dims: ['ابعاد تصویر خیلی بزرگ است', 'حداکثر ۸۰ مگاپیکسل پشتیبانی می‌شود'],
    clip: ['تصویری در کلیپ‌بورد پیدا نشد', 'اول از اسکرین‌شات کپی بگیر، بعد اینجا Ctrl+V بزن یا گزینه چسباندن را انتخاب کن']
  };
  const AN = ['خواندن تصویر و ابعاد', 'تحلیل لبه‌ها و پس‌زمینه', 'تشخیص پیام‌ها و فرستنده', 'آماده‌سازی خروجی‌ها'];
  const SIDES = [['them', 'طرف مقابل'], ['me', 'من'], ['both', 'هر دو']];
  const WIDTHS = [['full', 'تمام عرض'], ['bubble', 'فقط پیام']];
  const FRAMES = [['none', 'بدون قاب'], ['plain', 'رنگ ساده'], ['transparent', 'شفاف']];
  const SIZES = [['original', 'اندازه اصلی'], ['story', 'استوری ۹:۱۶'], ['post', 'پست ۱:۱']];
  const PADS = [['sm', 'کم'], ['md', 'متوسط'], ['lg', 'زیاد']];
  const PADV = { sm: .03, md: .06, lg: .1 };
  const BGS = [['#ffffff', 'سفید'], ['#efefeb', 'خاکستری روشن'], ['#18181b', 'تیره']];
  const PILL = {
    analyzing: 'در حال تشخیص', confident: 'تشخیص مطمئن', review: 'نیاز به بررسی',
    low: 'تنظیم دستی', none: 'پیامی پیدا نشد', manual: 'تنظیم‌شده دستی'
  };
  const TXT = {
    manual: 'کادرها را دستی تنظیم کردی و خروجی‌ها بر اساس همین کادرها ساخته می‌شوند',
    confident: 'پیام‌ها با اطمینان تشخیص داده شدند، خروجی‌هایی را که لازم داری انتخاب کن',
    review: 'پیام‌ها پیدا شدند، ولی بهتر است قبل از دانلود مرز کادرها را بررسی کنی',
    low: 'کادرهای پیشنهادی ممکن است بخشی از پیام‌های دیگر یا زمان‌ها را هم شامل شوند',
    none: 'ممکن است این تصویر اسکرین‌شات چت نباشد، می‌توانی کادر را خودت مشخص کنی'
  };
  // Which outputs every image gets by default (also applies to all images of a batch).
  const OUT_KINDS = [['outOriginal', 'original', 'تصویر اصلی', 'کل اسکرین‌شات بدون برش'], ['outBlocks', 'block', 'تک‌تک پیام‌ها', 'برای هر پیام یک تصویر جدا'], ['outGroups', 'group', 'پیام‌های ترکیبی', 'ریپلای همراه پیام زیرش در یک تصویر']];
  const DEFAULT_ST = { outOriginal: false, outBlocks: true, outGroups: true, side: 'them', width: 'full', strip: false, avatar: false, names: false, links: false, frame: 'none', bg: '#ffffff', size: 'original', pad: 'md', round: true };

  // ---------- helpers ----------
  const fa = n => Number(n).toLocaleString('fa-IR', { useGrouping: false });
  const pct = v => (v * 100).toFixed(3) + '%';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const copy = o => JSON.parse(JSON.stringify(o));
  const union = rs => { const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y)), x2 = Math.max(...rs.map(r => r.x + r.w)), y2 = Math.max(...rs.map(r => r.y + r.h)); return { x, y, w: x2 - x, h: y2 - y }; };
  const ar = (w, h) => (w / h).toFixed(5);
  const boxStyle = r => `left:${pct(r.x)};top:${pct(r.y)};width:${pct(r.w)};height:${pct(r.h)}`;
  const act = (a, v) => `data-ns-ayar-act="${a}"${v !== undefined ? ` data-ns-ayar-v="${esc(v)}"` : ''}`;
  const $q = sel => $view.querySelector(sel);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shareOK = (() => {
    try { return !!(navigator.canShare && navigator.share) && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] }); }
    catch (e) { return false; }
  })();

  const I = {
    upload: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>',
    clip: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"/></svg>',
    alert: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>`,
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    lock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    offline: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01"/></svg>',
    sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    check: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>`,
    plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    sliders: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    left: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    download: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>`,
    copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
    share: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>',
    crop: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/></svg>',
    blur: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/></svg>',
    long: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="7" rx="2"/><rect x="6" y="14.5" width="12" height="7" rx="2"/><path d="M12 9.5v5" stroke-linecap="round"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7H9a5 5 0 0 0 0 10h6"/><path d="M12 4l3 3-3 3" transform="matrix(-1 0 0 1 27 0)"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    install: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3"/></svg>',
    minus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    zplus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    reset: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/></svg>'
  };

  // ---------- state ----------
  const S = {
    screen: 'landing', items: [], cur: null, batch: false, anStep: 0, error: null, dz: false, sheet: false,
    st: Object.assign({}, DEFAULT_ST, store.get(KEY_SETTINGS) || {}),
    edit: null, draft: null, zoom: 1, pan: { x: 0, y: 0 }, install: null
  };
  let session = 0, uid = 0, drag = null, toastTimer = 0, pendingShare = null;

  const cur = () => S.items.find(i => i.id === S.cur);
  const upd = (id, fn) => { S.items = S.items.map(i => i.id === id ? fn(i) : i); };
  function set(patch) { Object.assign(S, patch); render(); }
  function setSt(p) { S.st = Object.assign({}, S.st, p); store.set(KEY_SETTINGS, S.st); render(); }
  function toast(t, ms) {
    clearTimeout(toastTimer); $toast.textContent = t; $toast.hidden = false;
    toastTimer = setTimeout(() => { $toast.hidden = true; }, ms || 2600);
  }
  function forget(item) { if (item.src.startsWith('blob:')) URL.revokeObjectURL(item.src); }
  function goHome() { session++; S.items.forEach(forget); set({ screen: 'landing', items: [], cur: null, batch: false, error: null, sheet: false, edit: null }); }

  // ---------- anonymous usage stats ----------
  // Only counts and settings are recorded, never images or file names. Events are queued in
  // localStorage (so offline use is counted too) and sent in batches when the browser is online;
  // each event has a random id so a batch that is sent twice is only counted once.
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)).toLowerCase();
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let statsTimer = 0, statsBusy = false;
  function visitor() {
    let v = store.get(KEY_VISITOR);
    if (typeof v !== 'string' || !/^[a-z0-9-]{8,40}$/.test(v)) { v = rid(); store.set(KEY_VISITOR, v); }
    return v;
  }
  function track(t, d) {
    if (!CFG.stats) return;
    const q = store.get(KEY_QUEUE) || [];
    q.push({ id: rid(), t, at: Date.now(), d: d || {}, off: navigator.onLine ? 0 : 1 });
    store.set(KEY_QUEUE, q.slice(-500));
    clearTimeout(statsTimer); statsTimer = setTimeout(flushStats, 3000);
  }
  function trackExport(kind, n, what) {
    const st = S.st;
    track('export', { kind, n, what: what || 'single', frame: st.frame, size: st.frame === 'none' ? 'original' : st.size, width: st.width, side: st.side, strip: st.strip ? 1 : 0, blur: [st.avatar, st.names, st.links].filter(Boolean).length, manual: S.items.reduce((m, i) => m + i.blur.length, 0) });
  }
  async function flushStats(beacon) {
    if (!CFG.stats || statsBusy || !navigator.onLine) return;
    const batch = (store.get(KEY_QUEUE) || []).slice(0, 50);
    if (!batch.length) return;
    const body = JSON.stringify({ v: visitor(), inst: installed() ? 1 : 0, e: batch });
    if (beacon === true && navigator.sendBeacon) { navigator.sendBeacon(CFG.stats, new Blob([body], { type: 'application/json' })); return; }
    statsBusy = true;
    try {
      const r = await fetch(CFG.stats, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' });
      // Sent (or rejected as malformed, which retrying would not fix): drop from the queue.
      if (r.ok || r.status === 400 || r.status === 413) {
        const sent = new Set(batch.map(e => e.id)), rest = (store.get(KEY_QUEUE) || []).filter(e => !sent.has(e.id));
        store.set(KEY_QUEUE, rest);
        if (rest.length) statsTimer = setTimeout(flushStats, 500);
      }
    } catch (e) { /* offline or server unreachable: keep the queue for later */ }
    finally { statsBusy = false; }
  }
  window.addEventListener('online', () => flushStats());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushStats(true); });

  // ---------- input ----------
  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }
  async function decode(file) {
    const name = file.name || 'pasted.png';
    if (!TYPES.includes(file.type) || !EXT.test(name)) return { ok: false, err: 'format' };
    if (file.size > MAX) return { ok: false, err: 'size' };
    const url = URL.createObjectURL(file);
    try {
      const im = await loadImage(url);
      if (im.naturalWidth * im.naturalHeight > MAX_PX) { URL.revokeObjectURL(url); return { ok: false, err: 'dims' }; }
      return { ok: true, src: url, name, w: im.naturalWidth, h: im.naturalHeight, im };
    } catch (e) { URL.revokeObjectURL(url); return { ok: false, err: 'corrupt' }; }
  }
  function makeItem(r) {
    return { id: 'i' + (++uid), src: r.src, name: r.name, w: r.w, h: r.h, im: r.im, status: 'analyzing', blocks: [], groups: [], redact: { avatar: [], names: [], links: [] }, bg: '#ffffff', blur: [], sel: {}, manual: false, hist: [] };
  }
  const named = f => f.name && EXT.test(f.name) ? f : new File([f], 'pasted.' + f.type.split('/')[1].replace('jpeg', 'jpg'), { type: f.type });
  async function addFiles(list, src) {
    const room = MAX_FILES - S.items.length, all = [...list].filter(Boolean), files = all.slice(0, room);
    if (!files.length) return toast('حداکثر ۲۰ تصویر قابل پردازش است');
    const res = await Promise.all(files.map(decode)), ok = res.filter(r => r.ok), bad = res.filter(r => !r.ok);
    bad.forEach(b => track('upload_error', { code: b.err }));
    if (!ok.length) return S.screen === 'landing' ? set({ error: bad[0].err }) : toast(ERR[bad[0].err][0]);
    if (bad.length || all.length > room) toast(`${fa(bad.length + Math.max(0, all.length - room))} فایل نامعتبر یا اضافه کنار گذاشته شد`);
    launch(ok.map(r => Object.assign(makeItem(r), { srcKind: src || 'file' })));
  }
  async function pasteClip() {
    try {
      const items = await navigator.clipboard.read(), fs = [];
      for (const ci of items) { const t = ci.types.find(x => x.startsWith('image/')); if (t) fs.push(named(new File([await ci.getType(t)], '', { type: t }))); }
      if (fs.length) addFiles(fs, 'paste'); else { track('upload_error', { code: 'clip' }); set({ error: 'clip' }); }
    } catch (e) { track('upload_error', { code: 'clip' }); set({ error: 'clip' }); }
  }
  // Images shared to the installed app (Web Share Target) are parked in a cache by the service worker.
  async function takeShared() {
    const url = new URL(location.href);
    if (!url.searchParams.has(SHARE_PARAM) || !('caches' in window)) return;
    url.searchParams.delete(SHARE_PARAM); history.replaceState(null, '', url.pathname + url.search + url.hash);
    try {
      const cache = await caches.open(SHARE_CACHE), keys = await cache.keys(), files = [];
      for (const k of keys) {
        const r = await cache.match(k), b = await r.blob();
        files.push(named(new File([b], decodeURIComponent(r.headers.get('x-ns-ayar-name') || ''), { type: b.type })));
        await cache.delete(k);
      }
      if (files.length) addFiles(files, 'share');
    } catch (e) { toast('تصویرهای ارسال‌شده خوانده نشد'); }
  }

  // ---------- detection (in a Web Worker when possible) ----------
  let worker = null, wid = 0;
  const waiting = new Map();
  function getWorker() {
    if (worker !== null) return worker;
    worker = false;
    if (!CFG.worker || typeof Worker === 'undefined') return worker;
    try {
      worker = new Worker(CFG.worker);
      worker.onmessage = e => { const p = waiting.get(e.data.id); if (!p) return; waiting.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.res); };
      worker.onerror = () => { worker = false; waiting.forEach(p => p.rej(new Error('worker failed'))); waiting.clear(); };
    } catch (e) { worker = false; }
    return worker;
  }
  async function analyze(item) {
    const D = window.nsAyarDetect, t0 = performance.now();
    let r = null;
    try {
      const w = getWorker();
      if (w) {
        const px = D.pixels(item.im, item.w, item.h), id = ++wid;
        r = await new Promise((res, rej) => { waiting.set(id, { res, rej }); w.postMessage({ id, data: px.data.buffer, w: px.w, h: px.h }, [px.data.buffer]); });
      }
    } catch (e) { r = null; }
    try { if (!r) { const px = D.pixels(item.im, item.w, item.h); r = D.detect(px.data, px.w, px.h); } }
    catch (e) { r = { status: 'none', blocks: [], groups: [], redact: { avatar: [], names: [], links: [] }, bg: { hex: '#ffffff' } }; }
    r.blocks.forEach(b => { b.auto = Object.assign({}, b.r); });
    track('analyze', { status: r.status, n: r.blocks.length, ms: Math.round(performance.now() - t0), batch: S.batch ? 1 : 0, src: item.srcKind || 'file' });
    return { status: r.status, blocks: r.blocks, groups: r.groups, redact: r.redact, bg: r.bg && r.bg.hex || '#ffffff', im: null };
  }
  async function launch(its) {
    const batch = S.batch || S.items.length + its.length > 1, my = session;
    if (!batch) {
      const it = its[0], d = reduced ? 120 : 380;
      set({ items: [it], cur: it.id, batch: false, screen: 'analyzing', anStep: 0, error: null });
      await wait(d); if (my !== session) return; set({ anStep: 1 });
      const job = analyze(it);
      await wait(d); if (my !== session) return; set({ anStep: 2 });
      const res = await job;
      await wait(d); if (my !== session) return; set({ anStep: 3 });
      await wait(d); if (my !== session) return;
      upd(it.id, x => Object.assign({}, x, res)); set({ screen: 'review' });
      return;
    }
    set({ items: S.items.concat(its), batch: true, screen: S.screen === 'review' ? 'review' : 'batch', error: null });
    for (const it of its) {
      if (my !== session || !S.items.some(i => i.id === it.id)) continue;
      const res = await analyze(it);
      if (my !== session) return;
      upd(it.id, x => Object.assign({}, x, res));
      if (S.screen !== 'editor') render();
      await wait(reduced ? 0 : 120);
    }
  }

  // ---------- regions & outputs ----------
  // Effective crop of a block: hand-edited boxes are used as-is, otherwise the "crop width" setting applies.
  function effR(b) { return b.edited || !b.bx || S.st.width !== 'bubble' ? b.r : Object.assign({}, b.r, { x: b.bx.x, w: b.bx.w }); }
  function cutR(b) { const r = effR(b); return S.st.strip && b.labelCut ? Object.assign({}, r, { y: r.y + b.labelCut, h: Math.max(.02, r.h - b.labelCut) }) : r; }
  function regionOf(it, o) {
    if (o.kind === 'original') return FULL;
    if (o.kind === 'block') return cutR(o.b);
    const ps = o.g.parts.map(p => it.blocks.find(b => b.id === p));
    return union(ps.map((b, i) => i === 0 ? cutR(b) : effR(b)));
  }
  function outputsOf(it) {
    const side = S.st.side, ok = x => side === 'both' || x.side === side;
    const vis = it.blocks.filter(ok), num = {};
    vis.forEach((b, i) => { num[b.id] = i + 1; });
    return [{ key: 'original', kind: 'original', label: 'تصویر اصلی', file: 'original' }]
      .concat(vis.map(b => ({ key: b.id, kind: 'block', b, label: b.label, n: num[b.id], file: `message-${num[b.id]}` })))
      .concat(it.groups.filter(g => ok(g) && g.parts.every(p => num[p])).map((g, i) => ({ key: g.id, kind: 'group', g, label: g.label, parts: g.parts.map(p => num[p]), file: `group-${i + 1}` })));
  }
  const defSel = o => !!S.st[OUT_KINDS.find(k => k[1] === o.kind)[0]];
  const isSel = (it, o) => it.sel[o.key] ?? defSel(o);
  const blocked = it => ['low', 'none'].includes(it.status) && !it.manual;
  const rects = it => [].concat(S.st.avatar ? it.redact.avatar : [], S.st.names ? it.redact.names : [], S.st.links ? it.redact.links : [], it.blur.map(b => b.r));
  const readyItems = () => S.items.filter(i => i.status !== 'analyzing' && !blocked(i));
  const selectedBlocks = it => outputsOf(it).filter(o => o.kind === 'block' && isSel(it, o));

  function layout(cw, ch) {
    const st = S.st;
    if (st.frame === 'none') return { outW: cw, outH: ch, dx: 0, dy: 0, dw: cw, dh: ch, R: 0 };
    let outW, outH, p = PADV[st.pad];
    if (st.size === 'original') { p *= Math.min(cw, ch * 2); outW = cw + 2 * p; outH = ch + 2 * p; }
    else { outW = 1080; outH = st.size === 'story' ? 1920 : 1080; p *= outW; }
    const k = Math.min((outW - 2 * p) / cw, (outH - 2 * p) / ch), dw = cw * k, dh = ch * k;
    return { outW, outH, dx: (outW - dw) / 2, dy: (outH - dh) / 2, dw, dh, R: st.round ? Math.min(dw * .035, dh * .3, 48) : 0 };
  }
  const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
  // The cropped region at full resolution, with redactions pixelated.
  function cropCanvas(it, im, r) {
    const sx = Math.round(r.x * it.w), sy = Math.round(r.y * it.h), sw = Math.max(1, Math.round(r.w * it.w)), sh = Math.max(1, Math.round(r.h * it.h));
    const c = canvasOf(sw, sh), ctx = c.getContext('2d');
    ctx.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
    for (const q of rects(it)) {
      const ix = Math.max(q.x * it.w, sx), iy = Math.max(q.y * it.h, sy), ix2 = Math.min((q.x + q.w) * it.w, sx + sw), iy2 = Math.min((q.y + q.h) * it.h, sy + sh);
      if (ix2 <= ix || iy2 <= iy) continue;
      const W = ix2 - ix, H = iy2 - iy, bs = Math.max(6, Math.min(W, H) / 6), t = canvasOf(Math.ceil(W / bs), Math.ceil(H / bs));
      t.getContext('2d').drawImage(im, ix, iy, W, H, 0, 0, t.width, t.height);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(t, 0, 0, t.width, t.height, ix - sx, iy - sy, W, H); ctx.imageSmoothingEnabled = true;
      t.width = t.height = 0;
    }
    return c;
  }
  // Applies the presentation frame (background, size, padding, rounded corners) and encodes PNG.
  async function frameBlob(src) {
    const st = S.st, L = layout(src.width, src.height), c = canvasOf(L.outW, L.outH), ctx = c.getContext('2d');
    if (st.frame === 'plain') { ctx.fillStyle = st.bg; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.save();
    if (L.R) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(L.dx, L.dy, L.dw, L.dh, L.R) : ctx.rect(L.dx, L.dy, L.dw, L.dh); ctx.clip(); }
    ctx.drawImage(src, 0, 0, src.width, src.height, L.dx, L.dy, L.dw, L.dh);
    ctx.restore();
    const b = await new Promise(res => c.toBlob(res, 'image/png'));
    c.width = c.height = src.width = src.height = 0;
    if (!b) throw new Error('toBlob failed');
    return b;
  }
  async function compose(it, o) { const im = await loadImage(it.src); return frameBlob(cropCanvas(it, im, regionOf(it, o))); }
  // Stacks several message crops into one tall image (gaps use the chat's own background colour).
  async function composeLong(parts) {
    const crops = [], ims = {};
    for (const [it, o] of parts) { ims[it.id] = ims[it.id] || await loadImage(it.src); crops.push(cropCanvas(it, ims[it.id], regionOf(it, o))); }
    let W = Math.min(LONG_MAX_W, Math.max(...crops.map(c => c.width)));
    const gap = Math.round(W * .02);
    let H = crops.reduce((n, c) => n + c.height * W / c.width, 0) + gap * (crops.length + 1);
    const k = Math.min(1, LONG_MAX_H / H, Math.sqrt(LONG_MAX_AREA / (W * H)));
    W = Math.round(W * k); H = Math.round(H * k);
    const out = canvasOf(W, H), ctx = out.getContext('2d'), g = gap * k;
    ctx.fillStyle = parts[0][0].bg; ctx.fillRect(0, 0, W, H);
    let y = g;
    for (const c of crops) { const h = c.height * W / c.width; ctx.drawImage(c, 0, y, W, h); y += h + g; c.width = c.height = 0; }
    return frameBlob(out);
  }

  // ---------- export: download / copy / share ----------
  const base = it => (it.name || 'ayar').replace(/\.[^.]+$/, '').replace(/[^\w؀-ۿ-]+/g, '-').slice(0, 40) || 'ayar';
  const job = (it, o, name) => ({ name: name || `${base(it)}-${o.file}.png`, make: () => compose(it, o) });
  function save(blob, name) {
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  // Several outputs are saved as separate PNG files, one after another (no ZIP to unpack).
  async function download(jobs, what) {
    if (!jobs.length) return toast('خروجی‌ای انتخاب نشده است');
    trackExport('download', jobs.length, what);
    let done = 0;
    if (jobs.length > 1) toast(`در حال آماده‌سازی ${fa(jobs.length)} تصویر`, 60000);
    for (const j of jobs) {
      try { save(await j.make(), j.name); done++; } catch (e) { /* reported below */ }
      if (jobs.length > 1) await wait(350);
    }
    toast(done === jobs.length ? (done > 1 ? `${fa(done)} تصویر دانلود شد` : 'تصویر دانلود شد') : `${fa(jobs.length - done)} تصویر ساخته نشد`);
  }
  async function share(jobs, what) {
    if (!jobs.length) return toast('خروجی‌ای انتخاب نشده است');
    const key = jobs.map(j => j.name).join('|') + JSON.stringify(S.st);
    let files;
    if (pendingShare && pendingShare.key === key && Date.now() - pendingShare.at < 60000) files = pendingShare.files;
    else {
      try { files = []; for (const j of jobs) files.push(new File([await j.make()], j.name, { type: 'image/png' })); }
      catch (e) { return toast('ساخت تصویر با خطا مواجه شد'); }
    }
    try { await navigator.share({ files }); pendingShare = null; trackExport('share', files.length, what); }
    catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotAllowedError') { pendingShare = { key, files, at: Date.now() }; return toast('تصویرها آماده شد، دوباره روی اشتراک‌گذاری بزن', 4000); }
      toast('اشتراک‌گذاری انجام نشد، از دانلود استفاده کن');
    }
  }
  async function copyOne(it, o) {
    if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') return toast('مرورگر شما از کپی تصویر پشتیبانی نمی‌کند، از دانلود استفاده کن');
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': compose(it, o) })]); toast('تصویر کپی شد'); trackExport('copy', 1, 'single'); }
    catch (e) { toast('مرورگر اجازه کپی تصویر را نداد، از دانلود استفاده کن'); }
  }
  const selectedJobs = it => outputsOf(it).filter(o => isSel(it, o)).map(o => job(it, o));
  function batchJobs() {
    const list = [];
    readyItems().forEach((it, n) => outputsOf(it).filter(o => isSel(it, o)).forEach(o => list.push(job(it, o, `${String(n + 1).padStart(2, '0')}-${base(it)}-${o.file}.png`))));
    return list;
  }
  function longJob(items) {
    const parts = [];
    items.forEach(it => selectedBlocks(it).forEach(o => parts.push([it, o])));
    return parts.length ? [{ name: `${items.length > 1 ? 'ayar' : base(items[0])}-long.png`, make: () => composeLong(parts) }] : [];
  }

  // ---------- undo ----------
  function snapshot(it) {
    const h = it.hist.concat([copy({ blocks: it.blocks, blur: it.blur, manual: it.manual, sel: it.sel })]).slice(-30);
    upd(it.id, x => Object.assign({}, x, { hist: h }));
  }
  function undo() {
    const it = cur(); if (!it || !it.hist.length) return;
    const last = it.hist[it.hist.length - 1];
    upd(it.id, x => Object.assign({}, x, last, { hist: x.hist.slice(0, -1) }));
    render(); toast('آخرین تغییر برگردانده شد');
  }

  // ---------- editor ----------
  function startEditor(edit, draft) { set({ screen: 'editor', sheet: false, edit, draft: Object.assign({}, draft), zoom: 1, pan: { x: 0, y: 0 } }); }
  function openEditor(blockId) { const b = cur().blocks.find(x => x.id === blockId); if (b) startEditor({ kind: 'block', id: blockId }, effR(b)); }
  function addManual() { startEditor({ kind: 'block', id: 'u' + Date.now(), isNew: true }, { x: 0, y: .35, w: 1, h: .2 }); }
  function addBlur() { startEditor({ kind: 'blur', id: 'z' + Date.now(), isNew: true }, { x: .25, y: .42, w: .5, h: .06 }); }
  function openBlur(id) { const z = cur().blur.find(x => x.id === id); if (z) startEditor({ kind: 'blur', id }, z.r); }
  function cancelEditor() { set({ screen: 'review', edit: null }); }
  function confirmEditor() {
    const it = cur(), e = S.edit, d = Object.assign({}, S.draft);
    snapshot(it);
    if (e.kind === 'blur') {
      upd(it.id, x => Object.assign({}, x, { blur: e.isNew ? x.blur.concat({ id: e.id, r: d }) : x.blur.map(z => z.id === e.id ? Object.assign({}, z, { r: d }) : z) }));
    } else if (e.isNew) {
      const b = { id: e.id, side: S.st.side === 'me' ? 'me' : 'them', label: 'کادر دستی', r: d, auto: Object.assign({}, d), edited: true };
      upd(it.id, x => Object.assign({}, x, { manual: true, blocks: x.blocks.concat(b) }));
    } else {
      upd(it.id, x => Object.assign({}, x, {
        manual: true,
        blocks: x.blocks.map(b => b.id !== e.id ? b : Object.assign({}, b, { r: d, edited: true, labelCut: b.labelCut && Math.abs(d.y - b.r.y) < .005 && b.labelCut < d.h ? b.labelCut : undefined }))
      }));
    }
    set({ screen: 'review', edit: null });
  }
  function resetDraft() {
    const it = cur(), e = S.edit, b = e.kind === 'block' && it.blocks.find(x => x.id === e.id);
    S.draft = b && b.auto ? Object.assign({}, effR(Object.assign({}, b, { r: b.auto, edited: false }))) : e.kind === 'blur' ? { x: .25, y: .42, w: .5, h: .06 } : Object.assign({}, FULL);
    S.zoom = 1; S.pan = { x: 0, y: 0 }; paintEditor();
  }
  const dimsText = (r, it) => `${fa(Math.round(r.w * it.w))} × ${fa(Math.round(r.h * it.h))}`;
  // Updates the editor DOM in place so dragging does not re-render the page.
  function paintEditor() {
    const it = cur(), box = $q('.ns-ayar-ed-box'), rect = $q('.ns-ayar-ed-rect');
    if (!it || !box || !rect) return;
    box.style.transform = `translate(${S.pan.x}px, ${S.pan.y}px) scale(${S.zoom})`;
    box.classList.toggle('ns-ayar-nodelay', !!drag);
    rect.style.cssText = boxStyle(S.draft);
    rect.setAttribute('aria-valuetext', dimsText(S.draft, it));
    rect.classList.toggle('ns-ayar-dragging', !!drag && drag.h !== 'pan');
    $view.querySelectorAll('.ns-ayar-hd').forEach(h => { h.style.transform = `scale(${1 / S.zoom})`; });
    $q('.ns-ayar-ed-dims').textContent = dimsText(S.draft, it);
    $q('.ns-ayar-zoom span').textContent = fa(Math.round(S.zoom * 100)) + '٪';
    $q('.ns-ayar-ed-stage').classList.toggle('ns-ayar-zoomed', S.zoom > 1);
  }
  function setZoom(z) {
    z = clamp(Math.round(z * 100) / 100, 1, 4);
    S.zoom = z; if (z === 1) S.pan = { x: 0, y: 0 };
    paintEditor();
  }
  function edDown(e) {
    const t = e.target.closest('[data-ns-ayar-h]'); if (!t || e.button > 0) return;
    const h = t.dataset.nsAyarH;
    if (h === 'pan' && S.zoom <= 1) return;
    const box = $q('.ns-ayar-ed-box').getBoundingClientRect();
    e.preventDefault(); t.setPointerCapture && t.setPointerCapture(e.pointerId);
    if (h === 'move') t.focus({ preventScroll: true });
    drag = { h, sx: e.clientX, sy: e.clientY, r0: Object.assign({}, S.draft), p0: Object.assign({}, S.pan), bw: box.width, bh: box.height };
    paintEditor();
  }
  function edMove(e) {
    const d = drag; if (!d) return;
    if (d.h === 'pan') { S.pan = { x: d.p0.x + e.clientX - d.sx, y: d.p0.y + e.clientY - d.sy }; return paintEditor(); }
    const dx = (e.clientX - d.sx) / d.bw, dy = (e.clientY - d.sy) / d.bh, r0 = d.r0;
    let { x, y, w, h } = r0;
    if (d.h === 'move') { x = clamp(r0.x + dx, 0, 1 - r0.w); y = clamp(r0.y + dy, 0, 1 - r0.h); }
    if (d.h.includes('w')) { x = clamp(r0.x + dx, 0, r0.x + r0.w - MIN); w = r0.x + r0.w - x; }
    if (d.h.includes('e')) w = clamp(r0.w + dx, MIN, 1 - r0.x);
    if (d.h.includes('n')) { y = clamp(r0.y + dy, 0, r0.y + r0.h - MIN); h = r0.y + r0.h - y; }
    if (d.h.includes('s')) h = clamp(r0.h + dy, MIN, 1 - r0.y);
    S.draft = { x, y, w, h }; paintEditor();
  }
  function edUp() { if (!drag) return; drag = null; paintEditor(); }

  // ---------- views ----------
  const seg = (opts, val, a, role) => opts.map(([k, l]) => `<button type="button" ${role === 'tab' ? `role="tab" aria-selected="${val === k}"` : `aria-pressed="${val === k}"`} ${act(a, k)}>${l}</button>`).join('');
  const sw = (label, hint, on, key, plain) => `<button type="button" class="ns-ayar-sw${plain ? ' ns-ayar-plain' : ''}" role="switch" aria-checked="${on}" ${act('flip', key)}><span class="ns-ayar-t"><span>${label}</span>${hint ? `<span>${hint}</span>` : ''}</span><span class="ns-ayar-track"></span></button>`;
  function summary() {
    const st = S.st, outs = OUT_KINDS.filter(k => st[k[0]]).map(k => k[2]);
    const parts = [outs.length ? outs.join(' + ') : 'بدون خروجی پیش‌فرض', SIDES.find(x => x[0] === st.side)[1]];
    if (st.width === 'bubble') parts.push('فقط پیام');
    parts.push(FRAMES.find(x => x[0] === st.frame)[1]);
    if (st.frame !== 'none' && st.size !== 'original') parts.push(SIZES.find(x => x[0] === st.size)[1]);
    const n = [st.avatar, st.names, st.links].filter(Boolean).length; if (n) parts.push(`محو ${fa(n)} مورد`);
    if (st.strip) parts.push('بدون برچسب');
    return parts.join(' · ');
  }

  function vHeader() {
    const dark = $root.dataset.nsAyarTheme === 'dark';
    return `<header class="ns-ayar-hdr">
      <div class="ns-ayar-hdr-l">
        <button type="button" class="ns-ayar-logo" ${act('home')} aria-label="آیار، صفحه اصلی"><img class="ns-ayar-logo-light" src="${CFG.base}brand/ns-ayar-logo.png" alt="" width="96" height="28"><img class="ns-ayar-logo-dark" src="${CFG.base}brand/ns-ayar-logo-dark.png" alt="" width="96" height="28"></button>
        <a class="ns-ayar-by" href="https://nias.ir/" target="_blank" rel="noopener" dir="ltr">by Nias</a>
      </div>
      <div class="ns-ayar-hdr-r">
        ${S.install && S.screen === 'landing' ? `<button type="button" class="ns-ayar-btn ns-ayar-hdr-btn" ${act('install')}>${I.install}نصب</button>` : ''}
        ${['batch', 'review'].includes(S.screen) ? `<button type="button" class="ns-ayar-btn ns-ayar-hdr-btn" ${act('home')}>شروع دوباره</button>` : ''}
        <button type="button" class="ns-ayar-icon-btn" ${act('theme')} aria-label="تغییر حالت روشن و تیره">${dark ? I.sun : I.moon}</button>
      </div>
    </header>`;
  }

  function vLanding() {
    const err = S.error ? ERR[S.error] : null;
    return `<main class="ns-ayar-main"><div class="ns-ayar-landing">
      <div class="ns-ayar-hero">
        <h1>اسکرین‌شات چتت رو تمیز و آماده کن</h1>
        <p>آیار پیام‌ها را از اسکرین‌شات تشخیص می‌دهد و برای هر پیام یک تصویر آماده بهت می‌دهد</p>
      </div>
      <div class="ns-ayar-drop${S.dz ? ' ns-ayar-over' : ''}" id="ns-ayar-drop">
        <span class="ns-ayar-drop-icon">${I.upload}</span>
        <div><p class="ns-ayar-drop-t">اسکرین‌شاتت رو اینجا بنداز</p><p class="ns-ayar-drop-s">ناحیه چت را هوشمندانه تشخیص بده و تصویر را آماده کن، می‌توانی چند تصویر را با هم انتخاب کنی</p></div>
        <div class="ns-ayar-drop-btns">
          <button type="button" class="ns-ayar-btn ns-ayar-btn-ink" ${act('pick')}>انتخاب تصویر</button>
          <button type="button" class="ns-ayar-btn" ${act('paste')}>${I.clip}چسباندن از کلیپ‌بورد</button>
        </div>
        <p class="ns-ayar-drop-note"><span dir="ltr">PNG · JPG · JPEG · WEBP</span> — تا ۲۰ تصویر، هر کدام حداکثر ۲۰ مگابایت</p>
      </div>
      ${err ? `<div class="ns-ayar-alert" role="alert"><span class="ns-ayar-alert-ic">${I.alert(20)}</span><div class="ns-ayar-alert-b"><strong>${err[0]}</strong><span>${err[1]}</span></div><button type="button" class="ns-ayar-icon-btn ns-ayar-ghost" ${act('clearError')} aria-label="بستن پیام">${I.x}</button></div>` : ''}
      <div class="ns-ayar-features">
        <span>${I.lock}تصاویر شما ذخیره نمی‌شوند و از مرورگرت خارج نمی‌شوند</span>
        <span>${I.offline}بدون اینترنت هم کار می‌کند</span>
        <span>${I.sliders}فقط آمار ناشناس استفاده ثبت می‌شود، بدون تصویر و اطلاعات شخصی</span>
      </div>
      <ol class="ns-ayar-steps"><li><span>۱</span><span>آپلود</span></li><li><span>۲</span><span>تشخیص</span></li><li><span>۳</span><span>برش</span></li><li><span>۴</span><span>دانلود</span></li></ol>
      <div style="flex:1"></div>
      <footer class="ns-ayar-foot"><a href="https://nias.ir/" target="_blank" rel="noopener" dir="ltr">Developed by Nias</a></footer>
    </div></main>`;
  }

  function vAnalyzing() {
    const it = cur();
    return `<main class="ns-ayar-main"><div class="ns-ayar-an">
      <div class="ns-ayar-an-stage"><div class="ns-ayar-an-img" style="--ns-ayar-ar:${ar(it.w, it.h)}"><img src="${esc(it.src)}" alt="اسکرین‌شات آپلودشده"><div class="ns-ayar-scan"></div></div></div>
      <div class="ns-ayar-an-status" role="status" aria-live="polite">
        <div class="ns-ayar-an-title"><span class="ns-ayar-spin" aria-hidden="true"></span>در حال تشخیص پیام‌ها</div>
        <ul class="ns-ayar-an-steps">${AN.map((l, i) => `<li class="${i <= S.anStep ? 'ns-ayar-on' : ''}${i < S.anStep ? ' ns-ayar-done' : ''}"><span class="ns-ayar-an-dot">${i < S.anStep ? I.check(12) : ''}</span>${l}</li>`).join('')}</ul>
        <p class="ns-ayar-muted">پردازش در مرورگر خودت انجام می‌شود</p>
      </div>
    </div></main>
    <div class="ns-ayar-bar"><button type="button" class="ns-ayar-btn" style="flex:1;height:48px" ${act('home')}>لغو</button></div>`;
  }

  function vBatch() {
    const items = S.items, ready = items.filter(i => i.status !== 'analyzing'), busy = items.length - ready.length;
    const blockedN = ready.filter(blocked).length, reviewN = ready.filter(i => i.status === 'review' && !i.manual).length;
    const fileCount = readyItems().reduce((n, i) => n + outputsOf(i).filter(o => isSel(i, o)).length, 0);
    const longN = readyItems().reduce((n, i) => n + selectedBlocks(i).length, 0);
    const sub = busy ? `در حال تشخیص ${fa(busy)} تصویر` : [`${fa(ready.length - blockedN - reviewN)} آماده`, reviewN ? `${fa(reviewN)} نیاز به بررسی` : '', blockedN ? `${fa(blockedN)} نیاز به تنظیم دستی` : ''].filter(Boolean).join(' · ');
    const rows = items.map((i, n) => {
      const an = i.status === 'analyzing', st = i.manual ? 'manual' : i.status, cnt = outputsOf(i).filter(o => isSel(i, o)).length;
      return `<li>
        <button type="button" class="ns-ayar-q-open" ${act('open', i.id)} ${an ? 'disabled' : ''}>
          <span class="ns-ayar-q-thumb"><img src="${esc(i.src)}" alt="تصویر ${fa(n + 1)}"></span>
          <span class="ns-ayar-q-info"><span class="ns-ayar-q-name" dir="auto">${esc(i.name)}</span>
            <span class="ns-ayar-q-meta"><span class="ns-ayar-pill ns-ayar-pill-${st}">${an ? '<span class="ns-ayar-spin" aria-hidden="true"></span>' : ''}${PILL[st]}</span><span>${an ? '' : blocked(i) ? 'دانلود نمی‌شود' : `${fa(cnt)} خروجی`}</span></span>
          </span>
        </button>
        <button type="button" class="ns-ayar-q-rm" ${act('remove', i.id)} aria-label="حذف ${esc(i.name)}">${I.x}</button>
      </li>`;
    }).join('');
    const off = busy > 0 || !fileCount;
    return `<main class="ns-ayar-main"><div class="ns-ayar-wrap">
      <div class="ns-ayar-b-head"><div><h2>${fa(items.length)} تصویر</h2><p>${sub}</p></div><button type="button" class="ns-ayar-btn" ${act('pick')}>${I.plus}افزودن تصویر</button></div>
      <button type="button" class="ns-ayar-set-row" ${act('sheet')}><span class="ns-ayar-set-ic">${I.sliders}</span><span class="ns-ayar-set-txt"><strong>تنظیمات خروجی برای همه</strong><span>${summary()}</span></span><span class="ns-ayar-chev">${I.left}</span></button>
      <ul class="ns-ayar-queue">${rows}</ul>
      ${blockedN ? `<div class="ns-ayar-warnbox"><span>${I.alert(18)}</span><span>${fa(blockedN)} تصویر به تنظیم دستی نیاز دارد و تا وقتی کادرش را تنظیم نکنی دانلود نمی‌شود</span></div>` : ''}
      ${!busy && longN > 1 ? `<div class="ns-ayar-tools"><button type="button" class="ns-ayar-btn" ${act('longBatch')}>${I.long}یک تصویر بلند از ${fa(longN)} پیام</button></div>` : ''}
    </div></main>
    <div class="ns-ayar-bar">
      ${shareOK ? `<button type="button" class="ns-ayar-icon-btn" ${act('shareBatch')} ${off ? 'disabled' : ''} aria-label="اشتراک‌گذاری همه">${I.share}</button>` : ''}
      <button type="button" class="ns-ayar-btn ns-ayar-btn-accent ns-ayar-btn-wide" ${act('dlBatch')} ${off ? 'disabled' : ''}>${I.download(18)}${busy ? 'در حال تشخیص' : `دانلود همه · ${fa(fileCount)} تصویر`}</button>
    </div>`;
  }

  function vReview() {
    const it = cur(), st = S.st, items = S.items;
    const status = it.manual ? 'manual' : it.status, needsManual = blocked(it);
    const outs = outputsOf(it), vis = outs.filter(o => o.kind === 'block'), selN = outs.filter(o => isSel(it, o)).length;
    const idx = items.findIndex(i => i.id === it.id), navable = items.map((i, n) => [i, n]).filter(([i]) => i.status !== 'analyzing');
    const prev = navable.slice().reverse().find(([, n]) => n < idx), next = navable.find(([, n]) => n > idx);
    const allSel = outs.every(o => isSel(it, o)), tall = it.h / it.w > .9, red = rects(it), longN = selectedBlocks(it).length;

    const overlays = vis.map(o => `<div class="ns-ayar-ov ${needsManual ? 'ns-ayar-warn' : isSel(it, o) ? 'ns-ayar-sel' : ''}" style="${boxStyle(cutR(o.b))}"><b>${fa(o.n)}</b></div>`).join('')
      + red.map(q => `<div class="ns-ayar-ov ns-ayar-redact" style="${boxStyle(q)}"></div>`).join('')
      + it.blur.map(z => `<div class="ns-ayar-ov ns-ayar-redact ns-ayar-manual-blur" style="${boxStyle(z.r)}"></div>`).join('');

    const cards = outs.map(o => {
      const r = regionOf(it, o), L = layout(r.w * it.w, r.h * it.h), sel = isSel(it, o);
      const blurs = red.map(q => { const x1 = Math.max(q.x, r.x), y1 = Math.max(q.y, r.y), x2 = Math.min(q.x + q.w, r.x + r.w), y2 = Math.min(q.y + q.h, r.y + r.h); return x2 > x1 && y2 > y1 ? `<div class="ns-ayar-blur" style="left:${pct((x1 - r.x) / r.w)};top:${pct((y1 - r.y) / r.h)};width:${pct((x2 - x1) / r.w)};height:${pct((y2 - y1) / r.h)}"></div>` : ''; }).join('');
      const num = o.kind === 'group' ? o.parts.map(fa).join('+') : fa(o.n || 0);
      const info = o.kind === 'original' ? 'تصویر کامل' : o.kind === 'group' ? `ترکیب پیام‌های ${o.parts.map(fa).join(' و ')}` : (o.b.side === 'me' ? 'پیام من' : 'پیام طرف مقابل') + (st.strip && o.b.labelCut ? ' · بدون برچسب' : '') + (o.b.edited ? ' · دستی' : '');
      const radius = L.R ? `${(L.R / L.dw * 100).toFixed(2)}% / ${(L.R / L.dh * 100).toFixed(2)}%` : '0';
      const cls = 'ns-ayar-canvas' + (st.frame !== 'none' ? ' ns-ayar-framed' : '') + (st.frame === 'transparent' ? ' ns-ayar-checker' : '');
      return `<article class="ns-ayar-card${sel ? ' ns-ayar-sel' : ''}">
        <div class="ns-ayar-card-pv">
          <div class="${cls}" style="--ns-ayar-ar:${ar(L.outW, L.outH)};${st.frame === 'plain' ? `background:${st.bg}` : ''}">
            <div class="ns-ayar-crop" style="left:${pct(L.dx / L.outW)};top:${pct(L.dy / L.outH)};width:${pct(L.dw / L.outW)};height:${pct(L.dh / L.outH)};border-radius:${radius}">
              <img src="${esc(it.src)}" alt="پیش‌نمایش ${o.label}" style="left:${pct(-r.x / r.w)};top:${pct(-r.y / r.h)};width:${pct(1 / r.w)};height:${pct(1 / r.h)}">${blurs}
            </div>
          </div>
          ${o.kind !== 'original' ? `<span class="ns-ayar-num">${num}</span>` : ''}
        </div>
        <button type="button" class="ns-ayar-card-sel" role="checkbox" aria-checked="${sel}" ${act('toggleOut', o.key)}>
          <span class="ns-ayar-cb">${sel ? I.check(13) : ''}</span>
          <span class="ns-ayar-t"><strong>${o.label}</strong><span>${info}</span></span>
          <span class="ns-ayar-dims">${fa(Math.round(L.outW))} × ${fa(Math.round(L.outH))}</span>
        </button>
        <div class="ns-ayar-card-act">
          ${o.kind === 'block' ? `<button type="button" class="ns-ayar-icon-btn" ${act('edit', o.b.id)} aria-label="تنظیم کادر ${o.label}">${I.crop}</button>` : ''}
          <button type="button" class="ns-ayar-btn ns-ayar-btn-ink" ${act('dl', o.key)} aria-label="دانلود ${o.label}">${I.download(15)}دانلود</button>
          <button type="button" class="ns-ayar-btn" ${act('copy', o.key)} aria-label="کپی ${o.label}">${I.copy}کپی</button>
          ${shareOK ? `<button type="button" class="ns-ayar-icon-btn ns-ayar-share" ${act('share', o.key)} aria-label="اشتراک‌گذاری ${o.label}">${I.share}</button>` : ''}
        </div>
      </article>`;
    }).join('');

    const primary = needsManual ? (it.blocks.length ? 'تنظیم دستی' : 'افزودن کادر دستی') : S.batch ? (next ? 'تأیید و تصویر بعدی' : 'بازگشت به صف') : selN > 1 ? `دانلود ${fa(selN)} تصویر` : 'دانلود';

    return `<main class="ns-ayar-main"><div class="ns-ayar-rv">
      <section class="ns-ayar-rv-pv" aria-label="پیش‌نمایش پیام‌های تشخیص‌داده‌شده">
        ${S.batch ? `<div class="ns-ayar-rv-nav">
          <button type="button" class="ns-ayar-back" ${act('queue')}>${I.right}صف تصاویر</button>
          <div class="ns-ayar-pos">
            <button type="button" class="ns-ayar-icon-btn" ${act('nav', prev ? prev[0].id : '')} ${prev ? '' : 'disabled'} aria-label="تصویر قبلی">${I.right}</button>
            <span>${fa(idx + 1)} از ${fa(items.length)}</span>
            <button type="button" class="ns-ayar-icon-btn" ${act('nav', next ? next[0].id : '')} ${next ? '' : 'disabled'} aria-label="تصویر بعدی">${I.left}</button>
          </div>
        </div>` : ''}
        <div class="ns-ayar-stage${tall ? ' ns-ayar-tall' : ''}"><div class="ns-ayar-fit" style="--ns-ayar-ar:${ar(it.w, it.h)}"><img src="${esc(it.src)}" alt="اسکرین‌شات با پیام‌های تشخیص‌داده‌شده">${overlays}</div></div>
      </section>
      <aside class="ns-ayar-rv-side">
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="ns-ayar-pill ns-ayar-st-pill ns-ayar-pill-${status}"><i></i>${PILL[status]}</span>
          <p class="ns-ayar-st-text">${TXT[status]}</p>
        </div>
        ${needsManual ? `<div class="ns-ayar-warnbox" role="alert"><span>${I.alert(20)}</span><strong>${it.status === 'none' ? 'پیامی در این تصویر پیدا نشد' : 'تشخیص پیام با اطمینان کافی انجام نشد'}</strong></div>` : ''}
        <div class="ns-ayar-tools">
          ${it.hist.length ? `<button type="button" class="ns-ayar-btn ns-ayar-undo" ${act('undo')}>${I.undo}واگرد</button>` : ''}
          <button type="button" class="ns-ayar-btn" ${act('addBlur')}>${I.blur}محو یک ناحیه</button>
          ${vis.length ? `<button type="button" class="ns-ayar-btn" ${act('addManual')}>${I.plus}کادر جدید</button>` : ''}
          ${longN > 1 ? `<button type="button" class="ns-ayar-btn" ${act('longOne')}>${I.long}یک تصویر بلند</button>` : ''}
        </div>
        ${it.blur.length ? `<ul class="ns-ayar-blurs">${it.blur.map((z, i) => `<li><span>ناحیه‌ی محو ${fa(i + 1)}</span>
          <button type="button" class="ns-ayar-icon-btn" ${act('editBlur', z.id)} aria-label="تنظیم ناحیه‌ی محو ${fa(i + 1)}">${I.crop}</button>
          <button type="button" class="ns-ayar-icon-btn" ${act('delBlur', z.id)} aria-label="حذف ناحیه‌ی محو ${fa(i + 1)}">${I.trash}</button></li>`).join('')}</ul>` : ''}
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="ns-ayar-lbl">پیام‌های</span>
          <div class="ns-ayar-seg" role="tablist" aria-label="پیام‌های کدام طرف">${seg(SIDES, st.side, 'side', 'tab')}</div>
        </div>
        <div class="ns-ayar-out-head"><div><h2>خروجی‌ها</h2><span>${fa(selN)} از ${fa(outs.length)} انتخاب شده</span></div><button type="button" class="ns-ayar-btn-text" ${act('toggleAll')}>${allSel ? 'لغو انتخاب همه' : 'انتخاب همه'}</button></div>
        ${!vis.length ? `<div class="ns-ayar-empty">${it.blocks.length ? 'برای این طرف گفتگو پیامی پیدا نشد' : 'پیامی برای برش پیدا نشد'}<button type="button" class="ns-ayar-btn" ${act('addManual')}>افزودن کادر دستی</button></div>` : ''}
        ${cards}
        <p class="ns-ayar-meta">تصویر اصلی ${dimsText(FULL, it)} — تشخیص با تحلیل تصویر در مرورگر انجام شد و تصویر به سرویس خارجی ارسال نشده است</p>
      </aside>
    </div></main>
    <div class="ns-ayar-bar">
      <button type="button" class="ns-ayar-btn" ${act('sheet')}>${I.sliders}تنظیمات</button>
      ${shareOK && !needsManual && !S.batch ? `<button type="button" class="ns-ayar-icon-btn" ${act('shareSel')} ${selN ? '' : 'disabled'} aria-label="اشتراک‌گذاری خروجی‌های انتخاب‌شده">${I.share}</button>` : ''}
      <button type="button" class="ns-ayar-btn ns-ayar-btn-accent ns-ayar-btn-primary" ${act('primary')}>${primary}</button>
    </div>`;
  }

  function vEditor() {
    const it = cur(), e = S.edit, blur = e.kind === 'blur', eb = !blur && it.blocks.find(b => b.id === e.id);
    const title = blur ? 'ناحیه‌ی محو' : eb ? `تنظیم «${eb.label}»` : 'کادر جدید';
    const others = it.blocks.filter(b => blur || b.id !== e.id).map(b => effR(b)).concat(it.blur.filter(z => z.id !== e.id).map(z => z.r));
    const handles = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].map(h => `<div class="ns-ayar-hd ns-ayar-hd-${h}" data-ns-ayar-h="${h}" style="transform:scale(${1 / S.zoom})"><span></span></div>`).join('');
    return `<div class="ns-ayar-ed">
      <div class="ns-ayar-ed-top">
        <button type="button" class="ns-ayar-cancel" ${act('edCancel')}>انصراف</button>
        <strong>${title}</strong>
        <button type="button" class="ns-ayar-ok" ${act('edOk')}>تأیید</button>
      </div>
      <div class="ns-ayar-ed-stage${S.zoom > 1 ? ' ns-ayar-zoomed' : ''}" data-ns-ayar-h="pan">
        <div class="ns-ayar-ed-box" style="--ns-ayar-ar:${ar(it.w, it.h)};transform:translate(${S.pan.x}px, ${S.pan.y}px) scale(${S.zoom})">
          <img src="${esc(it.src)}" alt="تصویر در حال برش" draggable="false">
          ${others.map(r => `<div class="ns-ayar-ed-other" style="${boxStyle(r)}"></div>`).join('')}
          <div class="ns-ayar-ed-rect${blur ? ' ns-ayar-blur-mode' : ''}" tabindex="0" role="slider" aria-label="${blur ? 'ناحیه‌ی محو' : 'کادر پیام'}؛ با کلیدهای جهت جابه‌جا کنید" aria-valuetext="${dimsText(S.draft, it)}" data-ns-ayar-h="move" style="${boxStyle(S.draft)}">
            <div class="ns-ayar-ed-grid"></div>${handles}
          </div>
        </div>
        <span class="ns-ayar-ed-dims">${dimsText(S.draft, it)}</span>
      </div>
      <div class="ns-ayar-ed-bot">
        <div class="ns-ayar-ed-row">
          <div class="ns-ayar-zoom"><button type="button" ${act('zoomOut')} aria-label="کوچک‌نمایی">${I.minus}</button><span>${fa(Math.round(S.zoom * 100))}٪</span><button type="button" ${act('zoomIn')} aria-label="بزرگ‌نمایی">${I.zplus}</button></div>
          <button type="button" class="ns-ayar-ed-reset" ${act('edReset')}>${I.reset}بازنشانی</button>
        </div>
        <p class="ns-ayar-ed-hint">${blur ? 'کادر را روی بخشی که باید محو شود بکش' : 'گوشه‌ها و لبه‌ها را بکشید و برای جابه‌جایی داخل کادر را بکشید'}</p>
      </div>
    </div>`;
  }

  function vSheet() {
    const st = S.st, it = !S.batch && cur();
    const none = k => it && it.status !== 'analyzing' && !it.redact[k].length ? ' — در این تصویر پیدا نشد' : '';
    return `<div class="ns-ayar-sheet">
      <div class="ns-ayar-sheet-bd" ${act('sheetClose')}></div>
      <div class="ns-ayar-sheet-panel" role="dialog" aria-modal="true" aria-label="تنظیمات خروجی">
        <span class="ns-ayar-grab"></span>
        <div class="ns-ayar-sheet-hd"><div><strong>تنظیمات خروجی</strong><span>${S.batch ? 'روی خروجی همه‌ی تصاویر اعمال می‌شود' : 'روی همه‌ی خروجی‌های این تصویر اعمال می‌شود'}</span></div><button type="button" class="ns-ayar-icon-btn" ${act('sheetClose')} aria-label="بستن">${I.x}</button></div>
        <div class="ns-ayar-sheet-body">
          <section style="gap:4px"><h3 style="margin-bottom:6px">خروجی‌های هر تصویر</h3>
            ${OUT_KINDS.map(([k, , l, h]) => sw(l, h, st[k], k)).join('')}
            ${S.items.length > 1 ? `<p class="ns-ayar-sheet-note">با این تنظیم از ${fa(readyItems().length)} تصویر آماده، ${fa(readyItems().reduce((n, i) => n + outputsOf(i).filter(o => isSel(i, o)).length, 0))} فایل خروجی ساخته می‌شود</p>` : ''}
          </section>
          <section><h3>پیام‌های کدام طرف</h3><div class="ns-ayar-seg">${seg(SIDES, st.side, 'side')}</div></section>
          <section><h3>عرض برش</h3><div class="ns-ayar-seg" style="grid-template-columns:repeat(2,1fr)">${seg(WIDTHS, st.width, 'width')}</div></section>
          <section style="gap:4px"><h3 style="margin-bottom:6px">پاک‌سازی و حریم خصوصی</h3>
            ${sw('حذف برچسب‌های سیستمی', 'مثل «Replied to your story» بالای پیام', st.strip, 'strip')}
            ${sw('محو آواتارها', 'عکس پروفایل کنار پیام‌ها' + none('avatar'), st.avatar, 'avatar')}
            ${sw('محو نام‌ها', 'نام و نام کاربری در سربرگ چت' + none('names'), st.names, 'names')}
            ${sw('محو لینک‌ها', 'آدرس‌های وب آبی‌رنگ داخل پیام‌ها' + none('links'), st.links, 'links')}
          </section>
          <section style="gap:12px"><h3>قاب ارائه</h3>
            <div class="ns-ayar-seg">${seg(FRAMES, st.frame, 'frame')}</div>
            ${st.frame !== 'none' ? `<div style="display:flex;flex-direction:column;gap:14px">
              ${st.frame === 'plain' ? `<div class="ns-ayar-sw-row"><span>رنگ پس‌زمینه</span><div>${BGS.map(([c, l]) => `<button type="button" class="ns-ayar-swatch" ${act('bg', c)} aria-label="${l}" aria-pressed="${st.bg === c}"><span style="background:${c}"></span></button>`).join('')}</div></div>` : ''}
              <div class="ns-ayar-field"><span>اندازه</span><div class="ns-ayar-seg">${seg(SIZES, st.size, 'size')}</div></div>
              <div class="ns-ayar-field"><span>فاصله از لبه</span><div class="ns-ayar-seg">${seg(PADS, st.pad, 'pad')}</div></div>
              ${sw('گوشه‌های گرد', '', st.round, 'round', true)}
            </div>` : ''}
          </section>
          <button type="button" class="ns-ayar-btn-text ns-ayar-reset-st" ${act('resetSt')}>بازگشت به تنظیمات پیش‌فرض</button>
        </div>
        <div class="ns-ayar-sheet-ft"><button type="button" class="ns-ayar-btn ns-ayar-btn-ink" ${act('sheetClose')}>تأیید</button></div>
      </div>
    </div>`;
  }

  function render() {
    const a = document.activeElement, d = a && $view.contains(a) && a.dataset.nsAyarAct ? a.dataset : null;
    const fk = d ? `[data-ns-ayar-act="${d.nsAyarAct}"]${d.nsAyarV ? `[data-ns-ayar-v="${CSS.escape(d.nsAyarV)}"]` : ''}` : null;
    const scroller = $q('.ns-ayar-main'), top = scroller ? scroller.scrollTop : 0, prevScreen = $view.dataset.nsAyarScreen;
    const it = cur();
    let screen = S.screen;
    if ((screen === 'review' || screen === 'editor' || screen === 'analyzing') && !it) screen = S.batch ? 'batch' : 'landing';
    if (screen === 'editor' && !S.edit) screen = 'review';
    let html = screen === 'editor' ? '' : vHeader();
    html += screen === 'landing' ? vLanding() : screen === 'analyzing' ? vAnalyzing() : screen === 'batch' ? vBatch() : screen === 'review' ? vReview() : vEditor();
    if (S.sheet && screen !== 'editor') html += vSheet();
    $view.innerHTML = html;
    $view.dataset.nsAyarScreen = screen;
    const sc = $q('.ns-ayar-main');
    if (sc && prevScreen === screen) sc.scrollTop = top;
    if (fk) { const el = $q(fk); if (el) el.focus({ preventScroll: true }); }
    if (S.sheet && !fk) { const c = $q('.ns-ayar-sheet-hd .ns-ayar-icon-btn'); if (c) c.focus(); }
  }

  // ---------- events ----------
  const outOf = v => { const it = cur(); return [it, outputsOf(it).find(o => o.key === v)]; };
  const actions = {
    home: goHome,
    theme() {
      const t = $root.dataset.nsAyarTheme === 'dark' ? 'light' : 'dark';
      $root.dataset.nsAyarTheme = t;
      try { localStorage.setItem(KEY_THEME, t); } catch (e) { /* ignore */ }
      render();
    },
    async install() { const p = S.install; if (!p) return; S.install = null; render(); try { await p.prompt(); } catch (e) { /* dismissed */ } },
    pick: () => $file.click(),
    paste: pasteClip,
    clearError: () => set({ error: null }),
    sheet: () => set({ sheet: true }),
    sheetClose: () => set({ sheet: false }),
    side: v => setSt({ side: v }), width: v => setSt({ width: v }), frame: v => setSt({ frame: v }), size: v => setSt({ size: v }), pad: v => setSt({ pad: v }), bg: v => setSt({ bg: v }),
    flip(v) {
      // Changing which outputs every image gets resets per-image choices, so it applies to all images.
      if (v.startsWith('out')) S.items = S.items.map(i => Object.assign({}, i, { sel: {} }));
      setSt({ [v]: !S.st[v] });
    },
    resetSt() {
      S.items = S.items.map(i => Object.assign({}, i, { sel: {} }));
      S.st = Object.assign({}, DEFAULT_ST);
      try { localStorage.removeItem(KEY_SETTINGS); } catch (e) { /* ignore */ }
      render(); toast('تنظیمات به حالت پیش‌فرض برگشت');
    },
    open: v => set({ cur: v, screen: 'review' }),
    remove(v) {
      const i = S.items.find(x => x.id === v); if (!i) return;
      forget(i);
      const rest = S.items.filter(y => y.id !== v);
      set(rest.length ? { items: rest } : { items: rest, screen: 'landing', batch: false });
    },
    dlBatch: () => download(batchJobs(), 'batch'),
    shareBatch: () => share(batchJobs(), 'batch'),
    longBatch: () => download(longJob(readyItems()), 'long'),
    longOne: () => download(longJob([cur()]), 'long'),
    queue: () => set({ screen: 'batch' }),
    nav: v => v && set({ cur: v }),
    toggleAll() {
      const it = cur(), outs = outputsOf(it), all = outs.every(o => isSel(it, o));
      upd(it.id, x => Object.assign({}, x, { sel: Object.assign({}, x.sel, Object.fromEntries(outs.map(o => [o.key, !all]))) })); render();
    },
    toggleOut(v) {
      const [it, o] = outOf(v);
      upd(it.id, x => Object.assign({}, x, { sel: Object.assign({}, x.sel, { [v]: !isSel(it, o) }) })); render();
    },
    edit: openEditor, addManual, addBlur, editBlur: openBlur, undo,
    delBlur(v) { const it = cur(); snapshot(it); upd(it.id, x => Object.assign({}, x, { blur: x.blur.filter(z => z.id !== v) })); render(); },
    dl: v => { const [it, o] = outOf(v); download([job(it, o)], 'single'); },
    copy: v => { const [it, o] = outOf(v); copyOne(it, o); },
    share: v => { const [it, o] = outOf(v); share([job(it, o)], 'single'); },
    shareSel: () => share(selectedJobs(cur()), 'selected'),
    primary() {
      const it = cur(), idx = S.items.indexOf(it);
      if (blocked(it)) return it.blocks.length ? openEditor(it.blocks[0].id) : addManual();
      if (S.batch) { const next = S.items.find((i, n) => n > idx && i.status !== 'analyzing'); return next ? set({ cur: next.id }) : set({ screen: 'batch' }); }
      download(selectedJobs(it), 'selected');
    },
    edCancel: cancelEditor, edOk: confirmEditor, edReset: resetDraft,
    zoomIn: () => setZoom(S.zoom + .25), zoomOut: () => setZoom(S.zoom - .25)
  };

  $view.addEventListener('click', e => {
    const t = e.target.closest('[data-ns-ayar-act]');
    if (!t || t.disabled || !$view.contains(t)) return;
    const fn = actions[t.dataset.nsAyarAct]; if (fn) fn(t.dataset.nsAyarV);
  });
  $file.addEventListener('change', () => { addFiles($file.files || [], 'file'); $file.value = ''; });

  // drag & drop (anywhere on landing/batch, highlighted on the drop zone)
  const dropZone = on => { const d = $q('#ns-ayar-drop'); if (d) d.classList.toggle('ns-ayar-over', on); };
  $view.addEventListener('dragover', e => {
    if (!['landing', 'batch'].includes(S.screen)) return;
    e.preventDefault();
    if (!S.dz) { S.dz = true; dropZone(true); }
  });
  $view.addEventListener('dragleave', e => {
    if (e.relatedTarget && $view.contains(e.relatedTarget)) return;
    S.dz = false; dropZone(false);
  });
  $view.addEventListener('drop', e => {
    if (!['landing', 'batch'].includes(S.screen)) return;
    e.preventDefault(); S.dz = false; dropZone(false);
    addFiles(e.dataTransfer.files || [], 'drop');
  });
  window.addEventListener('paste', e => {
    if (!['landing', 'batch'].includes(S.screen)) return;
    const fs = [...((e.clipboardData && e.clipboardData.items) || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
    if (fs.length) { e.preventDefault(); addFiles(fs.map(named), 'paste'); }
  });

  // editor pointer/keyboard
  $view.addEventListener('pointerdown', e => { if (S.screen === 'editor') edDown(e); });
  $view.addEventListener('pointermove', e => { if (S.screen === 'editor') edMove(e); });
  $view.addEventListener('pointerup', edUp);
  $view.addEventListener('pointercancel', edUp);
  $view.addEventListener('wheel', e => {
    if (S.screen !== 'editor' || !e.target.closest('.ns-ayar-ed-stage')) return;
    e.preventDefault(); setZoom(S.zoom - e.deltaY * .002);
  }, { passive: false });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (S.sheet) return set({ sheet: false });
      if (S.screen === 'editor') return cancelEditor();
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && S.screen === 'review' && !S.sheet) { e.preventDefault(); return undo(); }
    if (S.screen === 'editor' && e.target.classList && e.target.classList.contains('ns-ayar-ed-rect')) {
      const k = e.shiftKey ? .02 : .005, m = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[e.key];
      if (!m) return;
      e.preventDefault();
      const d = S.draft;
      S.draft = Object.assign({}, d, { x: clamp(d.x + m[0], 0, 1 - d.w), y: clamp(d.y + m[1], 0, 1 - d.h) });
      paintEditor();
    }
  });
  window.addEventListener('beforeunload', () => S.items.forEach(forget));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.install = e; if (S.screen === 'landing') render(); });
  window.addEventListener('appinstalled', () => { S.install = null; track('install'); render(); });

  // ---------- offline app & updates ----------
  // A new version is downloaded in the background; it only takes over when the user taps "update",
  // so nobody loses work mid-task.
  function offerUpdate(reg) {
    if (!$update || !reg.waiting) return;
    $update.hidden = false;
    $update.querySelector('[data-ns-ayar-update="now"]').onclick = () => {
      if (S.items.length && !confirm('با به‌روزرسانی، تصویرهای فعلی بسته می‌شوند، ادامه می‌دهی؟')) return;
      track('update'); flushStats(true);
      reg.waiting.postMessage('ns-ayar-skip-waiting');
    };
    $update.querySelector('[data-ns-ayar-update="later"]').onclick = () => { $update.hidden = true; };
  }
  if (CFG.sw && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register(CFG.sw, { updateViaCache: 'none' });
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg); });
        });
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
        // Check for a new version when the app comes back to the foreground, and hourly.
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
        setInterval(() => reg.update().catch(() => {}), 36e5);
      } catch (e) { /* offline support unavailable */ }
    });
  }

  render();
  takeShared();
  track('open', { theme: $root.dataset.nsAyarTheme, online: navigator.onLine ? 1 : 0 });
})();

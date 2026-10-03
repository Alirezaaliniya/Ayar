/* Ayar (ns-ayar) — in-browser chat-bubble detection.
 * Works on raw RGBA pixels (usually a downscaled copy of the screenshot) and returns
 * message blocks, reply groups and redaction regions as rects normalised to 0..1.
 * Pure function with no DOM access so it can also run in Node for testing. */
(function (root) {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Most common colour (quantised to 6 bits per channel), averaged over its bin.
  // Fine bins matter: chat bubbles are often only a few levels off the background.
  function background(px, w, h) {
    const bins = new Uint32Array(262144), step = Math.max(1, Math.floor((w * h) / 120000));
    let n = 0;
    for (let i = 0; i < w * h; i += step) {
      const o = i * 4;
      bins[((px[o] >> 2) << 12) | ((px[o + 1] >> 2) << 6) | (px[o + 2] >> 2)]++; n++;
    }
    let best = 0;
    for (let k = 1; k < bins.length; k++) if (bins[k] > bins[best]) best = k;
    let r = 0, g = 0, b = 0, c = 0;
    for (let i = 0; i < w * h; i += step) {
      const o = i * 4;
      if ((((px[o] >> 2) << 12) | ((px[o + 1] >> 2) << 6) | (px[o + 2] >> 2)) === best) { r += px[o]; g += px[o + 1]; b += px[o + 2]; c++; }
    }
    return { r: r / c, g: g / c, b: b / c, frac: bins[best] / n };
  }

  // Runs of indices where test(i) holds, bridging gaps shorter than `bridge`.
  function runs(len, test, bridge) {
    const out = [];
    let s = -1, last = -1;
    for (let i = 0; i < len; i++) {
      if (!test(i)) continue;
      if (s < 0) s = i;
      else if (i - last > bridge) { out.push([s, last]); s = i; }
      last = i;
    }
    if (s >= 0) out.push([s, last]);
    return out;
  }

  function detect(px, w, h) {
    // A pixel is content when it clearly differs from the background, or when it is part of a
    // long horizontal run of faint difference (pale bubble fills). Short faint runs are JPEG noise.
    const bg = background(px, w, h), STRONG = 14, FAINT = 3, RUN = Math.max(8, Math.round(w * 0.05));
    const mask = new Uint8Array(w * h), rowN = new Uint32Array(h), colN = new Uint32Array(w);
    for (let y = 0; y < h; y++) {
      let rs = -1;
      for (let x = 0; x <= w; x++) {
        let d = 0;
        if (x < w) {
          const o = (y * w + x) * 4;
          d = Math.max(Math.abs(px[o] - bg.r), Math.abs(px[o + 1] - bg.g), Math.abs(px[o + 2] - bg.b));
          if (d > STRONG) mask[y * w + x] = 1;
        }
        if (d > FAINT) { if (rs < 0) rs = x; }
        else if (rs >= 0) { if (x - rs >= RUN) for (let i = rs; i < x; i++) mask[y * w + i] = 1; rs = -1; }
      }
      for (let x = 0; x < w; x++) colN[x] += mask[y * w + x];
    }
    // Columns that are busy almost top to bottom are frame edges / scrollbars, not content.
    for (let x = 0; x < w; x++) if (colN[x] > h * 0.85) for (let y = 0; y < h; y++) mask[y * w + x] = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowN[y] += mask[y * w + x];

    const rowMin = Math.max(1, Math.round(w * 0.003));
    const tall = h / w > 1.3; // looks like a full phone screenshot (has status bar / header / input bar)
    const segs = runs(h, y => rowN[y] >= rowMin, Math.max(1, Math.round(w * 0.004)))
      .filter(([a, b]) => b - a + 1 >= 2)
      .map(([y0, y1]) => measure(y0, y1));

    function measure(y0, y1) {
      const sh = y1 - y0 + 1, col = new Uint32Array(w);
      let busy = 0;
      for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { col[x]++; busy++; }
      const cmin = Math.max(1, Math.round(sh * 0.03));
      const clusters = runs(w, x => col[x] >= cmin, Math.max(2, Math.round(w * 0.015))).map(([x0, x1]) => {
        let cy0 = y1, cy1 = y0, n = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mask[y * w + x]) { n++; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
        return { x0, x1, y0: cy0, y1: cy1, density: n / ((x1 - x0 + 1) * (cy1 - cy0 + 1)) };
      });
      const x0 = clusters.length ? clusters[0].x0 : 0, x1 = clusters.length ? clusters[clusters.length - 1].x1 : w - 1;
      return { y0, y1, h: sh, x0, x1, clusters, density: busy / (sh * (x1 - x0 + 1)) };
    }

    // ---- classify segments ----
    for (const s of segs) {
      const spans = s.x0 < w * 0.08 && s.x1 > w * 0.92;
      const cx = (s.x0 + s.x1) / 2;
      if (tall && spans && s.clusters.length >= 2 && s.y0 < h * 0.13) s.kind = 'chromeTop';
      else if (tall && spans && s.y1 > h * 0.87) s.kind = 'chromeBottom';
      else if (Math.abs(cx - w / 2) < w * 0.08 && s.x1 - s.x0 < w * 0.45 && s.h < w * 0.06) s.kind = 'system';
      else if (s.h < w * 0.02 || (s.h < w * 0.04 && s.x1 - s.x0 < w * 0.05)) s.kind = 'noise';
      else s.kind = 'msg';
    }
    // A short, sparse text line sitting right above a message is a system label ("Replied to your story").
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i], n = segs[i + 1];
      if (s.kind === 'msg' && n.kind === 'msg' && s.density < 0.5 && s.h < w * 0.055 &&
          s.x1 - s.x0 < w * 0.75 && n.y0 - s.y1 < w * 0.05 && n.h > s.h * 1.5) {
        s.kind = 'label'; n.label = s;
      }
    }

    const msgs = segs.filter(s => s.kind === 'msg');
    const redact = { avatar: [], names: [], links: [] };
    const norm = (x0, y0, x1, y1) => ({ x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h });
    const grow = (r, k) => { const dx = r.w * k, dy = r.h * k, x = Math.max(0, r.x - dx), y = Math.max(0, r.y - dy); return { x, y, w: Math.min(1 - x, r.w + 2 * dx), h: Math.min(1 - y, r.h + 2 * dy) }; };
    let ambiguous = false, partial = false;

    msgs.forEach(s => {
      // Avatar: a small, roughly square blob at the far left, separated from the bubble.
      const c0 = s.clusters[0];
      if (s.clusters.length > 1 && c0.x1 < w * 0.17 && c0.x1 - c0.x0 < w * 0.14) {
        const aw = c0.x1 - c0.x0 + 1, ah = c0.y1 - c0.y0 + 1;
        if (ah / aw > 0.7 && ah / aw < 1.4 && aw > w * 0.04) { s.avatar = c0; redact.avatar.push(grow(norm(c0.x0, c0.y0, c0.x1, c0.y1), 0.06)); }
      }
      const bx0 = s.avatar ? s.clusters[1].x0 : s.x0, bx1 = s.x1, left = bx0, right = w - 1 - bx1;
      if (s.avatar || left < right * 0.6) s.side = 'them';
      else if (right < left * 0.6) s.side = 'me';
      else { s.side = 'them'; ambiguous = true; }

      // Text bubbles are a fill plus a text colour (even gradient fills stay in a few coarse
      // colour bins); photos and media spread over many.
      const hist = new Map(); let n = 0;
      for (let y = s.y0; y <= s.y1; y += 2) for (let x = bx0; x <= bx1; x += 2) {
        const o = (y * w + x) * 4, k = ((px[o] >> 4) << 8) | ((px[o + 1] >> 4) << 4) | (px[o + 2] >> 4);
        hist.set(k, (hist.get(k) || 0) + 1); n++;
      }
      const coarse = new Map();
      hist.forEach((v, k) => { const c = ((k >> 9) << 6) | (((k >> 5) & 7) << 3) | ((k >> 1) & 7); coarse.set(c, (coarse.get(c) || 0) + v); });
      s.media = [...coarse.values()].sort((a, b) => b - a).slice(0, 4).reduce((a, b) => a + b, 0) / n < 0.8;

      // Links: rows of saturated blue text inside a bubble that is not itself blue.
      const fill = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const fr = (fill >> 8) * 16, fg = ((fill >> 4) & 15) * 16, fb = (fill & 15) * 16;
      if (!(fb > fr + 40 && fb > fg + 20)) {
        const blueRow = y => { let c = 0; for (let x = bx0; x <= bx1; x++) { const o = (y * w + x) * 4; if (px[o + 2] > px[o] + 60 && px[o + 2] > px[o + 1] + 25) c++; } return c >= 2; };
        runs(s.y1 - s.y0 + 1, i => blueRow(s.y0 + i), Math.round(w * 0.012))
          .filter(([a, b]) => b - a + 1 >= w * 0.015)
          .forEach(([a, b]) => redact.links.push(grow(norm(bx0, s.y0 + a, bx1, s.y0 + b), 0.03)));
      }
    });

    // Header: avatar + name of the person you're chatting with.
    const head = segs.filter(s => s.kind === 'chromeTop').sort((a, b) => b.h - a.h)[0];
    if (head) {
      const cs = head.clusters, ai = cs.findIndex(c => { const aw = c.x1 - c.x0 + 1, ah = c.y1 - c.y0 + 1; return c.x1 < w * 0.4 && aw > w * 0.05 && aw < w * 0.16 && ah / aw > 0.75 && ah / aw < 1.33 && c.density > 0.5; });
      if (ai >= 0) {
        const a = cs[ai]; redact.avatar.push(grow(norm(a.x0, a.y0, a.x1, a.y1), 0.06));
        const nm = cs[ai + 1];
        if (nm && nm.x0 < w * 0.6) redact.names.push(grow(norm(nm.x0, nm.y0, nm.x1, nm.y1), 0.05));
      }
    }

    // ---- build blocks: full-width bands, padded halfway into the neighbouring gaps ----
    const content = segs.filter(s => s.kind !== 'noise');
    const blocks = msgs.map((s, i) => {
      const topSeg = s.label || s, idx = content.indexOf(topSeg), endIdx = content.indexOf(s);
      const prev = content[idx - 1], next = content[endIdx + 1], pad = Math.round(w * 0.02);
      let y0 = Math.max(prev ? Math.ceil((prev.y1 + topSeg.y0) / 2) : 0, topSeg.y0 - pad);
      let y1 = Math.min(next ? Math.floor((s.y1 + next.y0) / 2) : h - 1, s.y1 + pad);
      if (prev && prev.kind === 'chromeTop' && topSeg.y0 - prev.y1 < w * 0.045) { partial = true; y0 = prev.y1 + 1; }
      if (next && next.kind === 'chromeBottom' && next.y0 - s.y1 < w * 0.012) { partial = true; y1 = next.y0 - 1; }
      if (topSeg.y0 <= 1 && tall) partial = true;
      if (s.y1 >= h - 2 && tall) partial = true;
      const b = {
        id: 'm' + (i + 1), side: s.side,
        label: s.label ? 'پیام ریپلای' : s.media ? 'پیام تصویری' : 'پیام متنی',
        r: { x: 0, y: y0 / h, w: 1, h: (y1 - y0 + 1) / h }, _s: s
      };
      if (s.label) b.labelCut = (Math.round((s.label.y1 + s.y0) / 2) - y0) / h;
      // Tight horizontal extent (bubble + avatar + label), used by the "message only" crop width.
      const pad2 = Math.round(w * 0.025);
      const x0 = Math.max(0, Math.min(s.x0, s.label ? s.label.x0 : w) - pad2), x1 = Math.min(w - 1, Math.max(s.x1, s.label ? s.label.x1 : 0) + pad2);
      b.bx = { x: x0 / w, w: (x1 - x0 + 1) / w };
      return b;
    });

    // A reply and the message right after it (same side, nothing in between) form a group.
    const groups = [];
    blocks.forEach((b, i) => {
      const n = blocks[i + 1];
      if (!b.labelCut || !n || n.side !== b.side) return;
      const between = content.slice(content.indexOf(b._s) + 1, content.indexOf(n._s.label || n._s));
      if (!between.length && n._s.y0 - b._s.y1 < w * 0.06) groups.push({ id: 'g' + (groups.length + 1), side: b.side, label: 'پیام با ریپلای', parts: [b.id, n.id] });
    });
    blocks.forEach(b => { delete b._s; });

    let status = 'confident';
    if (!blocks.length) status = 'none';
    else if (bg.frac < 0.25 || blocks.length > 30 || (tall && blocks.some(b => b.r.h > 0.85))) status = 'low';
    else if (partial || ambiguous || bg.frac < 0.45) status = 'review';

    const hex = v => Math.round(v).toString(16).padStart(2, '0');
    return { status, blocks, groups, redact, bg: { r: bg.r, g: bg.g, b: bg.b, frac: bg.frac, hex: '#' + hex(bg.r) + hex(bg.g) + hex(bg.b) }, segments: segs.map(s => ({ kind: s.kind, y0: s.y0, y1: s.y1, x0: s.x0, x1: s.x1, density: +s.density.toFixed(2), clusters: s.clusters.length })) };
  }

  const ANALYSIS_W = 480;
  // Downscaled RGBA copy of an image/bitmap for analysis (works in pages and workers).
  function pixels(source, sw, sh) {
    const k = Math.min(1, ANALYSIS_W / sw), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    c.width = c.height = 0;
    return { data: d, w, h };
  }

  const api = { detect, pixels, ANALYSIS_W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.nsAyarDetect = api;
})(typeof self !== 'undefined' ? self : this);

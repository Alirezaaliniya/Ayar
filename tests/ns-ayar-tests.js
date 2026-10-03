/* Ayar (ns-ayar) — runs the detector on every fixture and compares with the expectations.
 * The final result is also exposed as window.nsAyarTestResult for automated runs. */
(async function () {
  'use strict';
  const D = window.nsAyarDetect, rows = document.getElementById('ns-ayar-test-rows'), sum = document.getElementById('ns-ayar-test-sum');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const load = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('load failed')); im.src = src; });
  const results = [];

  for (const f of window.nsAyarFixtures) {
    const errors = [];
    let r = null, ms = 0;
    try {
      const im = await load('fixtures/' + f.file), t = performance.now();
      const px = D.pixels(im, im.naturalWidth, im.naturalHeight);
      r = D.detect(px.data, px.w, px.h);
      ms = Math.round(performance.now() - t);
      const sides = r.blocks.map(b => b.side);
      if (f.status && r.status !== f.status) errors.push(`status ${r.status} ≠ ${f.status}`);
      if (f.sides && sides.join(',') !== f.sides.join(',')) errors.push(`sides [${sides}] ≠ [${f.sides}]`);
      if (f.groups !== undefined && r.groups.length !== f.groups) errors.push(`groups ${r.groups.length} ≠ ${f.groups}`);
      if (f.avatars !== undefined && r.redact.avatar.length < f.avatars) errors.push(`avatars ${r.redact.avatar.length} < ${f.avatars}`);
      if (f.names !== undefined && r.redact.names.length < f.names) errors.push(`names ${r.redact.names.length} < ${f.names}`);
    } catch (e) { errors.push(e.message); }
    const ok = !errors.length;
    results.push({ file: f.file, ok, errors });
    const got = r ? `status: ${r.status} · sides: [${r.blocks.map(b => b.side)}] · groups: ${r.groups.length} · avatars: ${r.redact.avatar.length} · names: ${r.redact.names.length}` : '—';
    rows.insertAdjacentHTML('beforeend', `<tr><td><code>${esc(f.file)}</code></td><td class="${ok ? 'ns-ayar-test-pass' : 'ns-ayar-test-fail'}">${ok ? 'قبول' : 'رد'}${ok ? '' : `<br><code>${esc(errors.join(' | '))}</code>`}</td><td><code>${esc(JSON.stringify(Object.assign({}, f, { file: undefined })))}</code></td><td><code>${esc(got)}</code></td><td>${ms}ms</td></tr>`);
  }
  const pass = results.filter(x => x.ok).length;
  sum.textContent = `${pass} از ${results.length} تست قبول شد`;
  sum.className = 'ns-ayar-test-sum ' + (pass === results.length ? 'ns-ayar-test-pass' : 'ns-ayar-test-fail');
  window.nsAyarTestResult = { pass, total: results.length, results };
})();

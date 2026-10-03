/* Ayar (ns-ayar) — runs detection off the main thread so large screenshots don't freeze the page. */
importScripts('ns-ayar-detect.js');
self.onmessage = e => {
  const { id, data, w, h } = e.data;
  try { self.postMessage({ id, res: self.nsAyarDetect.detect(new Uint8ClampedArray(data), w, h) }); }
  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};

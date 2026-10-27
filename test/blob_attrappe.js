// Nachbau von @vercel/blob (put/head/list/del) im Arbeitsspeicher – nur für Tests.
// Zählt die Vorgänge so, wie Vercel sie abrechnet: aufwendig = put/list, einfach = head + erstes Lesen einer Datei.
const BASIS = "http://blob.attrappe.test/";
const dateien = new Map();     // pathname → {text, uploadedAt}
const zaehler = { aufwendig: 0, einfach: 0, gelesen: new Set() };
const stoerung = { gesperrt: false };

class BlobError extends Error {}
class BlobNotFoundError extends BlobError { constructor() { super("The requested blob does not exist"); } }
class BlobStoreSuspendedError extends BlobError { constructor() { super("This store has been suspended"); } }
class BlobServiceRateLimited extends BlobError {}

function pruefeSperre() { if (stoerung.gesperrt) throw new BlobStoreSuspendedError(); }
const pn = (x) => String(x).replace(BASIS, "");

async function put(pathname, text, opt = {}) {
  pruefeSperre(); zaehler.aufwendig++;
  let p = pathname;
  if (opt.addRandomSuffix !== false) p = pathname.replace(/(\.[a-z]+)$/, "-" + Math.random().toString(36).slice(2, 12) + "$1");
  await new Promise((r) => setTimeout(r, 2));
  if (dateien.has(p) && !opt.allowOverwrite) throw new BlobError("This blob already exists, use `allowOverwrite: true` if you want to overwrite it.");
  dateien.set(p, { text: String(text), uploadedAt: new Date(Date.now() + dateien.size) });
  return { pathname: p, url: BASIS + p };
}
async function head(x) {
  pruefeSperre(); zaehler.einfach++;
  const d = dateien.get(pn(x));
  if (!d) throw new BlobNotFoundError();
  return { pathname: pn(x), url: BASIS + pn(x), uploadedAt: d.uploadedAt, size: d.text.length };
}
async function list(opt = {}) {
  pruefeSperre(); zaehler.aufwendig++;
  const blobs = [...dateien.entries()].filter(([p]) => p.startsWith(opt.prefix || ""))
    .map(([p, d]) => ({ pathname: p, url: BASIS + p, uploadedAt: d.uploadedAt }));
  return { blobs, hasMore: false };
}
async function del(x) {
  pruefeSperre();
  (Array.isArray(x) ? x : [x]).forEach((u) => dateien.delete(pn(u)));
}

// fetch auf Dateien der Attrappe umbiegen
const echtesFetch = global.fetch;
global.fetch = async (url, o) => {
  if (!String(url).startsWith(BASIS)) return echtesFetch(url, o);
  const p = pn(String(url).split("?")[0]);
  const d = dateien.get(p);
  if (!zaehler.gelesen.has(p)) { zaehler.gelesen.add(p); zaehler.einfach++; }   // erster Abruf = Cache-MISS
  return d ? new Response(d.text, { status: 200 }) : new Response("<html>not found</html>", { status: 404 });
};

module.exports = { put, head, list, del, BlobError, BlobNotFoundError, BlobStoreSuspendedError, BlobServiceRateLimited,
  _dateien: dateien, _zaehler: zaehler, _stoerung: stoerung };

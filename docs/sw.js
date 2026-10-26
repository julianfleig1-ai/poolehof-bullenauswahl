// Poolehof-App: Offline-Helfer (Service Worker)
//
// Damit die App auch ohne Netz startet (Funkloch auf dem Feld):
//  - App-Dateien (Seite, Bilder, Bullendaten): erst das Netz fragen, damit immer
//    die neueste Version kommt – antwortet es nicht innerhalb von 4 Sekunden,
//    wird die zuletzt gespeicherte Version genommen.
//  - Bibliotheken und Schriften (cdnjs, Google Fonts): einmal laden, dann aus dem Speicher.
//  - Der Hof-Speicher (Kuhliste/Feldbuch) läuft NICHT hierüber – das macht die App selbst.
const STAND = "poolehof-v1";
const KERN = [
  "./", "index.html", "manifest.webmanifest",
  "img/logo.png", "img/favicon.png", "img/icon-192.png", "img/icon-512.png", "img/apple-touch-icon.png",
  "data/status.json", "data/wws_bulls.json", "data/rbw_bulls.json", "data/prismagen_bulls.json", "data/semex_bulls.json", "data/cri_bulls.json",
];
const BIBLIOTHEKEN = [
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
];
// cdn.jsdelivr.net + tessdata: Texterkennung für Lely-Screenshots (nach dem ersten Mal auch ohne Netz)
const FREMD_CACHEN = /^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net\/npm\/tesseract[^/]*|tessdata\.projectnaptha\.com)\//;

self.addEventListener("install", ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(STAND);
    await c.addAll(KERN);
    await Promise.all(BIBLIOTHEKEN.map(u => c.add(u).catch(() => {})));   // fehlt eine, nicht schlimm
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", ev => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== STAND) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function netzZuerst(req){
  const c = await caches.open(STAND);
  const netz = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; });
  const zeit = new Promise(res => setTimeout(() => res(null), 4000));
  try {
    const r = await Promise.race([netz, zeit]);
    if (r) return r;
  } catch (e) { /* kein Netz */ }
  const gespeichert = await c.match(req, {ignoreSearch: true}) || (req.mode === "navigate" ? await c.match("index.html") : null);
  if (gespeichert) return gespeichert;
  return netz;   // nichts gespeichert: doch auf das Netz warten
}

async function speicherZuerst(req){
  const c = await caches.open(STAND);
  const gespeichert = await c.match(req);
  if (gespeichert) return gespeichert;
  const r = await fetch(req);
  if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone());
  return r;
}

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) ev.respondWith(netzZuerst(req));
  else if (FREMD_CACHEN.test(req.url)) ev.respondWith(speicherZuerst(req));
});

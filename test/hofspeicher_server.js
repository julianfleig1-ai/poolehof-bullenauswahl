// Lässt den ECHTEN Server-Code (hofspeicher/api/herde.js) lokal laufen – mit nachgebautem Speicher
// (blob_attrappe.js) statt Vercel. Port 8779 wie die alte Attrappe. Test-Passwort NUR hier: "test-4711".
//   GET ?stoerung=N  → die nächsten N Anfragen "haken" (503)
//   GET ?zaehler=1   → verbrauchte Vorgänge (aufwendig/einfach) und Anzahl Dateien
//   GET ?sperre=1|0  → Speicher "gesperrt" wie bei aufgebrauchtem Kontingent
//   GET ?alt=1       → alten Speicher (Zufallsnamen) mit Testdaten befüllen, um die Übernahme zu prüfen
const Module = require("module");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const ATTRAPPE = path.join(__dirname, "blob_attrappe.js");
const echtAufloesen = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "@vercel/blob" ? ATTRAPPE : echtAufloesen.call(this, req, ...rest); };

const SALZ = "poolehof-hofspeicher-v1";
const auth = crypto.createHash("sha256").update(`${SALZ}:auth:test-4711`).digest("hex");
process.env.HOF_KEY_HASH = crypto.createHash("sha256").update(auth).digest("hex");
process.env.PFAD_GEHEIM = process.env.PFAD_GEHEIM || "testgeheim0123456789abcd";
const blob = require(ATTRAPPE);
const handler = require(path.join(__dirname, "..", "hofspeicher", "api", "herde.js"));
const stoerung = { n: 0 };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8779");
  const query = Object.fromEntries(url.searchParams);
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": req.headers.origin || "*" }); res.end(JSON.stringify(obj)); };
  if (query.stoerung !== undefined) { stoerung.n = Number(query.stoerung); return json(200, { ok: true }); }
  if (query.zaehler) return json(200, { aufwendig: blob._zaehler.aufwendig, einfach: blob._zaehler.einfach, dateien: blob._dateien.size,
    pfade: [...blob._dateien.keys()].sort() });
  if (query.sperre !== undefined) { blob._stoerung.gesperrt = query.sperre === "1"; return json(200, { ok: true }); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    if (req.method !== "OPTIONS" && (req.method === "POST" || query.verfahren) && stoerung.n > 0) {
      stoerung.n--;
      return json(503, { ok: false, vorlaeufig: true, fehler: "Gespeicherte Daten gerade nicht abrufbar – bitte gleich nochmal versuchen" });
    }
    const r = {
      _status: 200, _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      status(c) { this._status = c; return this; },
      json(o) { res.writeHead(this._status, { ...this._headers, "Content-Type": "application/json" }); res.end(JSON.stringify(o)); },
      end() { res.writeHead(this._status, this._headers); res.end(); },
    };
    try { await handler({ method: req.method, headers: req.headers, query, body }, r); }
    catch (e) { json(500, { ok: false, fehler: String(e) }); }
  });
}).listen(8779, "127.0.0.1");

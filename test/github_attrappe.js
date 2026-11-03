// Nachbau der GitHub-Schnittstelle (nur was die App braucht) für Tests – Port 8781.
// Test-Passwort NUR hier: "test-4711". Der Test-Schlüssel ("test-schluessel") ist erfunden.
//   GET  /zugang.json                         → verschlüsselter Test-Schlüssel (wie docs/github-zugang.json)
//   GET  /repos/test/daten/contents/<f>.json  → {sha, content (base64), encoding, size} oder 404
//   PUT  /repos/test/daten/contents/<f>.json  → {message, content, sha?}: 409 bei veraltetem sha, 422 ohne sha bei vorhandener Datei
//   GET  /repos/test/daten/git/blobs/<sha>    → große Dateien
//   GET  /?stoerung=N  → die nächsten N Anfragen antworten 503
//   GET  /?sperre=1|0  → 403 "rate limit" für alle Anfragen
//   GET  /?schluesselweg=1|0 → 401 (Schlüssel ungültig/abgelaufen)
//   GET  /?zaehler=1   → Anzahl Anfragen (lesen/schreiben), Commits je Datei
const http = require("http");
const crypto = require("crypto");
const SALZ = "poolehof-hofspeicher-v1", TOKEN = "test-schluessel", REPO = "test/daten";
const GROSS = 1_000_000;   // wie GitHub: größere Dateien nur über git/blobs

function zugangDatei() {
  const key = crypto.pbkdf2Sync("test-4711", SALZ + ":aes", 600000, 32, "sha256");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ token: TOKEN, repo: REPO })), c.final(), c.getAuthTag()]);
  return { art: "poolehof-github-zugang", v: 1, repo: REPO, verfahren: "v2", ablauf: "2027-11-03", iv: iv.toString("base64"), daten: ct.toString("base64") };
}
const ZUGANG = zugangDatei();
const dateien = new Map();     // name → {text, sha}
const blobs = new Map();       // sha → text
const zustand = { stoerung: 0, sperre: false, weg: false, lesen: 0, schreiben: 0, commits: {} };
const sha1 = (t) => crypto.createHash("sha1").update("blob " + Buffer.byteLength(t) + "\0" + t).digest("hex");
const b64Zeilen = (t) => Buffer.from(t).toString("base64").replace(/(.{60})/g, "$1\n");   // GitHub bricht base64 um

http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8781");
  const kopf = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-GitHub-Api-Version",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "github-authentication-token-expiration": "2027-11-03 22:25:53 +0100", "Content-Type": "application/json" };   // wie GitHub: Kopf NICHT für den Browser freigegeben
  const json = (code, o) => { res.writeHead(code, kopf); res.end(JSON.stringify(o)); };
  if (req.method === "OPTIONS") { res.writeHead(204, kopf); return res.end(); }
  const q = Object.fromEntries(url.searchParams);
  if (url.pathname === "/" && q.stoerung !== undefined) { zustand.stoerung = Number(q.stoerung); return json(200, { ok: true }); }
  if (url.pathname === "/" && q.sperre !== undefined) { zustand.sperre = q.sperre === "1"; return json(200, { ok: true }); }
  if (url.pathname === "/" && q.schluesselweg !== undefined) { zustand.weg = q.schluesselweg === "1"; return json(200, { ok: true }); }
  if (url.pathname === "/" && q.leeren) { dateien.clear(); return json(200, { ok: true }); }
  if (url.pathname === "/" && q.zaehler) return json(200, { lesen: zustand.lesen, schreiben: zustand.schreiben, commits: zustand.commits, dateien: [...dateien.keys()] });
  if (url.pathname === "/zugang.json") return json(200, ZUGANG);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (zustand.stoerung > 0) { zustand.stoerung--; return json(503, { message: "Service Unavailable" }); }
    if (zustand.weg || req.headers.authorization !== "Bearer " + TOKEN) return json(401, { message: "Bad credentials" });
    if (zustand.sperre) return json(403, { message: "API rate limit exceeded" });
    const m = /^\/repos\/test\/daten\/contents\/([a-z]+\.json)$/.exec(url.pathname);
    const b = /^\/repos\/test\/daten\/git\/blobs\/([0-9a-f]{40})$/.exec(url.pathname);
    if (b && req.method === "GET") {
      zustand.lesen++;
      const t = blobs.get(b[1]);
      return t === undefined ? json(404, { message: "Not Found" }) : json(200, { sha: b[1], content: b64Zeilen(t), encoding: "base64", size: Buffer.byteLength(t) });
    }
    if (!m) return json(404, { message: "Not Found" });
    const name = m[1], d = dateien.get(name);
    if (req.method === "GET") {
      zustand.lesen++;
      if (!d) return json(404, { message: "Not Found" });
      const gross = Buffer.byteLength(d.text) > GROSS;
      return json(200, { name, sha: d.sha, size: Buffer.byteLength(d.text), encoding: gross ? "none" : "base64", content: gross ? "" : b64Zeilen(d.text) });
    }
    if (req.method === "PUT") {
      zustand.schreiben++;
      let j; try { j = JSON.parse(body); } catch (e) { return json(400, { message: "Problems parsing JSON" }); }
      if (!j.message || typeof j.content !== "string") return json(422, { message: "Invalid request" });
      if (d && !j.sha) return json(422, { message: "Invalid request.\n\n\"sha\" wasn't supplied." });
      if (d && j.sha !== d.sha) return json(409, { message: `${name} does not match ${j.sha}` });
      if (!d && j.sha) return json(409, { message: "sha does not match" });
      const text = Buffer.from(j.content, "base64").toString("utf8");
      const neu = { text, sha: sha1(text) };
      dateien.set(name, neu); blobs.set(neu.sha, text);
      zustand.commits[name] = (zustand.commits[name] || 0) + 1;
      return json(d ? 200 : 201, { content: { name, sha: neu.sha }, commit: { message: j.message } });
    }
    json(405, { message: "Method not allowed" });
  });
}).listen(8781, "127.0.0.1");

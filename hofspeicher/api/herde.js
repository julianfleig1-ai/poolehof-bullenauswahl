// Hof-Speicher für die Netrind-Herdenliste der Poolehof-Zuchtplanung.
//
// Speichert die Liste so, dass sie auf allen Geräten gleich ist (Handy,
// Stall-PC …). Die Liste kommt hier schon VERSCHLÜSSELT an – verschlüsselt
// wird im Browser mit dem Hof-Passwort. Dieser Server sieht die Kuhdaten also
// nie im Klartext, er bewahrt nur den verschlüsselten Block auf.
//
// Zugriff nur mit dem richtigen Schlüssel (aus dem Hof-Passwort abgeleitet).
// Gespeichert ist hier nur dessen SHA-256-Prüfwert (Umgebungsvariable
// HOF_KEY_HASH), nicht das Passwort selbst.
//
// Protokoll: POST mit Text-Body (JSON), damit der Browser ohne CORS-Vorabfrage
// auskommt:
//   {"aktion":"laden",     "schluessel":"…"}              → {"ok":true,"daten":{…}|null}
//   {"aktion":"speichern", "schluessel":"…","daten":{…}}  → {"ok":true}
//   GET ?selbsttest=1   → prüft nur, ob der Speicher erreichbar ist (keine Daten)
const { put, list, del } = require("@vercel/blob");
const crypto = require("crypto");

const ERLAUBTE_SEITEN = new Set([
  "https://julianfleig1-ai.github.io",
  "http://127.0.0.1:8777",
  "http://localhost:8777",
]);
const ORDNER = "herde/";
const MAX_GROESSE = 3_000_000;          // ~3 MB – die Liste hat ~200 KB

function pruefwert(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function schluesselRichtig(schluessel) {
  const soll = process.env.HOF_KEY_HASH || "";
  const ist = pruefwert(schluessel || "");
  if (soll.length !== 64) return false;
  return crypto.timingSafeEqual(Buffer.from(ist), Buffer.from(soll));
}

async function aktuellerBlob() {
  const { blobs } = await list({ prefix: ORDNER });
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  return { neuester: blobs[0] || null, alle: blobs };
}

module.exports = async (req, res) => {
  const herkunft = req.headers.origin || "";
  if (ERLAUBTE_SEITEN.has(herkunft)) {
    res.setHeader("Access-Control-Allow-Origin", herkunft);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // Erreichbarkeits-Test ohne Passwort: schreibt und löscht einen Dummy-Eintrag
    if (req.method === "GET" && req.query && req.query.selbsttest) {
      const probe = await put("selbsttest/probe.txt", "ok", { access: "public", addRandomSuffix: true, contentType: "text/plain" });
      await del(probe.url);
      return res.status(200).json({ ok: true, speicher: "erreichbar", schluesselGesetzt: (process.env.HOF_KEY_HASH || "").length === 64 });
    }
    if (req.method !== "POST") return res.status(405).json({ ok: false, fehler: "Nur POST erlaubt" });

    let body = req.body;
    if (typeof body === "string") {
      if (body.length > MAX_GROESSE) return res.status(413).json({ ok: false, fehler: "Liste zu groß" });
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    if (!schluesselRichtig(body.schluessel)) {
      // Bremse gegen Durchprobieren von Passwörtern
      await new Promise((r) => setTimeout(r, 2000));
      return res.status(401).json({ ok: false, fehler: "Passwort falsch" });
    }

    if (body.aktion === "laden") {
      const { neuester } = await aktuellerBlob();
      if (!neuester) return res.status(200).json({ ok: true, daten: null });
      const antwort = await fetch(neuester.url, { cache: "no-store" });
      return res.status(200).json({ ok: true, daten: await antwort.json() });
    }

    if (body.aktion === "speichern") {
      const daten = body.daten;
      if (!daten || daten.v !== 1 || typeof daten.daten !== "string" || typeof daten.iv !== "string") {
        return res.status(400).json({ ok: false, fehler: "Ungültige Daten" });
      }
      const text = JSON.stringify(daten);
      if (text.length > MAX_GROESSE) return res.status(413).json({ ok: false, fehler: "Liste zu groß" });
      // Zufälliger Dateiname, damit die (verschlüsselte) Datei nicht erraten werden kann
      const neu = await put(ORDNER + "liste.json", text, { access: "public", addRandomSuffix: true, contentType: "application/json" });
      // ältere Versionen löschen – es gibt immer nur EINE gültige Liste
      const { alle } = await aktuellerBlob();
      const alt = alle.filter((b) => b.url !== neu.url).map((b) => b.url);
      if (alt.length) await del(alt);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, fehler: "Unbekannte Aktion" });
  } catch (e) {
    return res.status(500).json({ ok: false, fehler: "Speicherfehler: " + (e && e.message ? e.message : String(e)) });
  }
};

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
//
// Optional "fach": "herde" (Standard, die Kuhliste) oder "feldbuch" (Feldarbeiten,
// Mandanten, Rechnungen – ebenfalls im Browser verschlüsselt).
// "laden" liefert zusätzlich "version". Wer beim Speichern "erwarteteVersion"
// mitschickt, bekommt {"konflikt":true}, falls inzwischen ein anderes Gerät
// gespeichert hat – dann neu laden, Änderungen darauf anwenden, nochmal speichern.
// Beim Feldbuch bleiben die letzten 30 Stände als Sicherung liegen.
//
// Passwort ändern: {"aktion":"passwortAendern","schluessel":"<alt>","neu":{"pruefwert":"…","verfahren":"v2"},
//   "daten":{"herde":{…}|null,"feldbuch":{…}|null},"feldbuchVersion":"…"} – die Daten kommen schon mit dem
//   NEUEN Passwort verschlüsselt an. Der neue Prüfwert liegt dann im Speicher (Ordner zugang/) und gilt
//   statt der Umgebungsvariable. GET ?verfahren=1 sagt der App, wie sie den Schlüssel berechnen muss
//   (v1 = alt/schnell, v2 = PBKDF2, langsam und sicher).
const { put, list, del } = require("@vercel/blob");
const crypto = require("crypto");

const ERLAUBTE_SEITEN = new Set([
  "https://julianfleig1-ai.github.io",
  "http://127.0.0.1:8777",
  "http://localhost:8777",
]);
const FAECHER = {
  herde: { ordner: "herde/", behalten: 1 },
  feldbuch: { ordner: "feldbuch/", behalten: 30 },
};
const MAX_GROESSE = 3_000_000;          // ~3 MB – die Liste hat ~200 KB

function pruefwert(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

// Gültiger Prüfwert: der zuletzt per "passwortAendern" gesetzte, sonst die Umgebungsvariable
async function zugangsInfo() {
  const { blobs } = await list({ prefix: "zugang/" });
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  if (blobs[0]) {
    // Gibt es einen neuen Prüfwert, gilt NUR er – nie stillschweigend zurück aufs alte Passwort
    const j = await (await fetch(blobs[0].url, { cache: "no-store" })).json();
    if (!j || !/^[0-9a-f]{64}$/.test(j.pruefwert)) throw new Error("Zugangsdaten im Speicher beschädigt");
    return { pruefwert: j.pruefwert, verfahren: j.verfahren || "v1", alle: blobs };
  }
  return { pruefwert: process.env.HOF_KEY_HASH || "", verfahren: "v1", alle: blobs };
}

function schluesselRichtig(schluessel, soll) {
  const ist = pruefwert(schluessel || "");
  if (!soll || soll.length !== 64) return false;
  return crypto.timingSafeEqual(Buffer.from(ist), Buffer.from(soll));
}

function umschlagGueltig(d) {
  return d && d.v === 1 && typeof d.daten === "string" && typeof d.iv === "string";
}

async function aktuellerBlob(ordner) {
  const { blobs } = await list({ prefix: ordner });
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
      const info = await zugangsInfo();
      return res.status(200).json({ ok: true, speicher: "erreichbar", schluesselGesetzt: info.pruefwert.length === 64, verfahren: info.verfahren });
    }
    if (req.method === "GET" && req.query && req.query.verfahren) {
      const info = await zugangsInfo();
      return res.status(200).json({ ok: true, verfahren: info.verfahren });
    }
    if (req.method !== "POST") return res.status(405).json({ ok: false, fehler: "Nur POST erlaubt" });

    let body = req.body;
    if (typeof body === "string") {
      if (body.length > MAX_GROESSE) return res.status(413).json({ ok: false, fehler: "Liste zu groß" });
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const zugang = await zugangsInfo();
    if (!schluesselRichtig(body.schluessel, zugang.pruefwert)) {
      // Bremse gegen Durchprobieren von Passwörtern
      await new Promise((r) => setTimeout(r, 2000));
      return res.status(401).json({ ok: false, fehler: "Passwort falsch" });
    }

    if (body.aktion === "passwortAendern") {
      const neu = body.neu || {};
      if (!/^[0-9a-f]{64}$/.test(neu.pruefwert || "") || neu.verfahren !== "v2") return res.status(400).json({ ok: false, fehler: "Ungültiger neuer Schlüssel" });
      const daten = body.daten || {};
      for (const f of ["herde", "feldbuch"]) {
        if (daten[f] !== null && daten[f] !== undefined && !umschlagGueltig(daten[f])) return res.status(400).json({ ok: false, fehler: "Ungültige Daten (" + f + ")" });
      }
      // Feldbuch inzwischen von einem anderen Gerät geändert? Dann erst neu laden.
      const { neuester: fbNeu } = await aktuellerBlob(FAECHER.feldbuch.ordner);
      if ((fbNeu ? fbNeu.pathname : null) !== (body.feldbuchVersion || null)) {
        return res.status(409).json({ ok: false, konflikt: true, fehler: "Feldbuch wurde inzwischen geändert – bitte nochmal" });
      }
      const versionen = {};
      for (const f of ["herde", "feldbuch"]) {
        if (!daten[f]) continue;
        const neuBlob = await put(FAECHER[f].ordner + "liste.json", JSON.stringify(daten[f]), { access: "public", addRandomSuffix: true, contentType: "application/json" });
        versionen[f] = neuBlob.pathname;
        if (f === "herde") {
          const { alle } = await aktuellerBlob(FAECHER.herde.ordner);
          const alt = alle.filter((b) => b.url !== neuBlob.url).map((b) => b.url);
          if (alt.length) await del(alt);
        }
      }
      // Zum Schluss den neuen Prüfwert setzen – ab jetzt gilt nur noch das neue Passwort
      const z = await put("zugang/pruefwert.json", JSON.stringify({ pruefwert: neu.pruefwert, verfahren: "v2", geaendert: new Date().toISOString() }),
        { access: "public", addRandomSuffix: true, contentType: "application/json" });
      const altZ = zugang.alle.map((b) => b.url).filter((u) => u !== z.url);
      if (altZ.length) await del(altZ);
      return res.status(200).json({ ok: true, versionen });
    }

    const fach = body.fach || "herde";
    const fachInfo = Object.prototype.hasOwnProperty.call(FAECHER, fach) ? FAECHER[fach] : null;
    if (!fachInfo) return res.status(400).json({ ok: false, fehler: "Unbekanntes Fach" });
    const ordner = fachInfo.ordner;

    if (body.aktion === "laden") {
      const { neuester } = await aktuellerBlob(ordner);
      if (!neuester) return res.status(200).json({ ok: true, daten: null, version: null });
      const antwort = await fetch(neuester.url, { cache: "no-store" });
      return res.status(200).json({ ok: true, daten: await antwort.json(), version: neuester.pathname });
    }

    if (body.aktion === "speichern") {
      const daten = body.daten;
      if (!umschlagGueltig(daten)) {
        return res.status(400).json({ ok: false, fehler: "Ungültige Daten" });
      }
      const text = JSON.stringify(daten);
      if (text.length > MAX_GROESSE) return res.status(413).json({ ok: false, fehler: "Liste zu groß" });
      // Hat inzwischen ein anderes Gerät gespeichert? Dann nicht überschreiben.
      if (Object.prototype.hasOwnProperty.call(body, "erwarteteVersion")) {
        const { neuester } = await aktuellerBlob(ordner);
        const aktuell = neuester ? neuester.pathname : null;
        if (aktuell !== (body.erwarteteVersion || null)) {
          return res.status(409).json({ ok: false, konflikt: true, fehler: "Inzwischen von einem anderen Gerät geändert" });
        }
      }
      // Zufälliger Dateiname, damit die (verschlüsselte) Datei nicht erraten werden kann
      const neu = await put(ordner + "liste.json", text, { access: "public", addRandomSuffix: true, contentType: "application/json" });
      // ältere Stände löschen – bei der Herde gibt es nur EINE gültige Liste,
      // beim Feldbuch bleiben die letzten Stände als Sicherung
      const { alle } = await aktuellerBlob(ordner);
      const alt = alle.filter((b) => b.url !== neu.url).slice(fachInfo.behalten - 1).map((b) => b.url);
      if (alt.length) await del(alt);
      return res.status(200).json({ ok: true, version: neu.pathname });
    }

    return res.status(400).json({ ok: false, fehler: "Unbekannte Aktion" });
  } catch (e) {
    return res.status(500).json({ ok: false, fehler: "Speicherfehler: " + (e && e.message ? e.message : String(e)) });
  }
};

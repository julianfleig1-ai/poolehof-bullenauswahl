// Hof-Speicher der Poolehof-App (Kuhliste "herde" und Feldbuch "feldbuch").
//
// Die Daten kommen schon VERSCHLÜSSELT an – verschlüsselt wird im Browser mit dem
// Hof-Passwort. Dieser Server sieht nie Klartext, er bewahrt nur verschlüsselte Blöcke auf.
// Zugriff nur mit dem richtigen Schlüssel (aus dem Hof-Passwort abgeleitet); gespeichert ist
// nur dessen SHA-256-Prüfwert.
//
// Protokoll: POST mit Text-Body (JSON), damit der Browser ohne CORS-Vorabfrage auskommt:
//   {"aktion":"laden", "fach":"herde"|"feldbuch", "schluessel":"…", "bekannt":"<Version>"?, "nurWennNeu":true?}
//        → {"ok":true,"daten":{…}|null,"version":"…"}   (bei nurWennNeu und gleichem Stand: {"ok":true,"unveraendert":true,"version"})
//   {"aktion":"speichern", "fach":…, "schluessel":"…", "daten":{…}, "erwarteteVersion":"…"|null?}
//        → {"ok":true,"version":"…"} oder {"konflikt":true} (409), wenn inzwischen ein anderes Gerät gespeichert hat
//   {"aktion":"passwortAendern", …} – siehe unten
//   GET ?verfahren=1  → welches Schlüssel-Verfahren gilt (v1/v2)
//   GET ?selbsttest=1 → ist der Speicher erreichbar? (keine Daten, keine Schreibvorgänge)
//
// SPARSAM (Version 2, 27.10.2026): Vercel Blob im Gratis-Tarif erlaubt nur 2.000 "aufwendige
// Vorgänge" (Hochladen, Auflisten) im Monat – sonst ist der Speicher 30 Tage gesperrt.
// Deshalb wird NICHT mehr bei jeder Anfrage aufgelistet. Jeder Stand ist eine eigene,
// nie überschriebene Datei mit fortlaufender Nummer:   d/<geheim>/<fach>/00000042.json
//   - Neuesten Stand finden: mit "head" (günstiger Vorgang) ab der bekannten Nummer vorwärts prüfen.
//   - Speichern: Datei Nummer n+1 anlegen; existiert sie schon, war ein anderes Gerät schneller
//     (der Speicher lehnt das Überschreiben ab) → Konflikt. Das ist sicherer als vorher.
//   - Pro Speichern genau 1 aufwendiger Vorgang; Laden normalerweise keiner.
// <geheim> (Umgebungsvariable PFAD_GEHEIM) macht die Dateinamen unerratbar.
// Beim ersten Start wird der alte Stand (Ordner herde/, feldbuch/, zugang/) einmalig übernommen.
const blob = require("@vercel/blob");
const crypto = require("crypto");

const ERLAUBTE_SEITEN = new Set([
  "https://julianfleig1-ai.github.io",
  "http://127.0.0.1:8777",
  "http://localhost:8777",
]);
const FAECHER = {
  herde: { behalten: 3 },
  feldbuch: { behalten: 30 },
};
const MAX_GROESSE = 3_000_000;          // ~3 MB – die Liste hat ~200 KB
const GEHEIM = String(process.env.PFAD_GEHEIM || "").replace(/[^A-Za-z0-9_-]/g, "");
const ALT_UEBERNEHMEN = process.env.ALT_UEBERNEHMEN !== "nein";
const ZUGANG_MERKEN_MS = 5 * 60 * 1000;   // neuer Prüfwert (Passwortwechsel) gilt spätestens nach 5 Minuten überall

const pfad = (fach, n) => `d/${GEHEIM}/${fach}/${String(n).padStart(8, "0")}.json`;
const zugangPfad = (n) => `d/${GEHEIM}/zugang/${String(n).padStart(4, "0")}.json`;
const versionText = (fach, n) => `v2:${fach}:${n}`;
function versionNummer(fach, text) {
  const m = /^v2:([a-z]+):(\d+)$/.exec(String(text || ""));
  return m && m[1] === fach ? Number(m[2]) : 0;
}

// Merkzettel dieser Server-Instanz (spart Abfragen, solange sie läuft)
const merk = { herde: null, feldbuch: null, zugang: null };

function pruefwert(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}
function istFehler(e, name, muster) {
  return !!e && ((blob[name] && e instanceof blob[name]) || (e.constructor && e.constructor.name === name) || (muster && muster.test(String(e.message || ""))));
}
const OPT = { access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" };

// Gibt es die Datei? (günstiger Vorgang, immer aktuell – geht nicht über den Zwischenspeicher)
async function gibt(pathname) {
  try { return await blob.head(pathname); }
  catch (e) { if (istFehler(e, "BlobNotFoundError", /not.?found|does not exist/i)) return null; throw e; }
}

// Gespeicherte Datei lesen. Direkt nach dem Speichern ist eine neue Datei manchmal für einen
// Moment noch nicht überall abrufbar – deshalb mehrmals mit kurzer Pause versuchen.
// Die nummerierten Dateien ändern sich nie, deshalb darf der Zwischenspeicher sie liefern.
async function blobLesen(url) {
  let letzter = null;
  for (const [i, pause] of [0, 300, 800, 1600].entries()) {
    if (pause) await new Promise((r) => setTimeout(r, pause));
    try {
      const antwort = await fetch(i === 0 ? url : url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
      const text = await antwort.text();
      if (antwort.ok && /^\s*[{\[]/.test(text)) return JSON.parse(text);
      letzter = new Error("Datei gerade nicht lesbar (HTTP " + antwort.status + ")");
    } catch (e) { letzter = e; }
  }
  const f = new Error("Gespeicherte Daten gerade nicht abrufbar – bitte gleich nochmal versuchen");
  f.vorlaeufig = true; f.ursache = letzter;
  throw f;
}

// Neuesten Stand eines Fachs finden → {n, url} oder null (leer)
async function neuester(fach, hinweis) {
  const m = merk[fach];
  const start = Math.max(Number(hinweis) || 0, (m && m.n) || 0);
  if (start > 0) {
    const b = await gibt(pfad(fach, start));
    if (b) {
      // Vorwärts suchen: erst in wachsenden Schritten, dann genau (die Stände sind lückenlos)
      let n = start, url = b.url, schritt = 1, fehlt = null;
      for (;;) {
        const t = await gibt(pfad(fach, n + schritt));
        if (!t) { fehlt = n + schritt; break; }
        n += schritt; url = t.url; schritt *= 2;
      }
      while (fehlt - n > 1) {
        const mitte = Math.floor((n + fehlt) / 2);
        const t = await gibt(pfad(fach, mitte));
        if (t) { n = mitte; url = t.url; } else fehlt = mitte;
      }
      merk[fach] = { n, url, zeit: Date.now() };
      return merk[fach];
    }
  }
  return neuesterUeberListe(fach);
}

// Nur wenn nichts bekannt ist (neues Gerät, neue Server-Instanz ohne Hinweis): einmal auflisten
async function neuesterUeberListe(fach) {
  const { blobs } = await blob.list({ prefix: `d/${GEHEIM}/${fach}/`, limit: 1000 });
  let best = null;
  for (const b of blobs) {
    const mm = /(\d{8})\.json$/.exec(b.pathname);
    if (mm && (!best || Number(mm[1]) > best.n)) best = { n: Number(mm[1]), url: b.url };
  }
  if (best) { merk[fach] = { ...best, zeit: Date.now() }; return merk[fach]; }
  if (!ALT_UEBERNEHMEN) return null;
  // Einmalige Übernahme aus dem alten Speicher (Dateien mit Zufallsnamen in herde/ bzw. feldbuch/)
  const alt = (await blob.list({ prefix: fach + "/", limit: 1000 })).blobs
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  if (!alt) return null;
  const inhalt = await blobLesen(alt.url);
  try {
    const neu = await blob.put(pfad(fach, 1), JSON.stringify(inhalt), OPT);
    merk[fach] = { n: 1, url: neu.url, zeit: Date.now() };
    return merk[fach];
  } catch (e) {
    const da = await gibt(pfad(fach, 1));   // gleichzeitig von einer anderen Instanz übernommen
    if (da) return neuester(fach, 1);
    throw e;
  }
}

// Gültiger Prüfwert. Die Zugangs-Dateien werden nie gelöscht (lückenlos ab 1).
async function zugangsInfo(frisch) {
  const m = merk.zugang;
  if (m && !frisch && Date.now() - m.zeit < ZUGANG_MERKEN_MS) return m;
  let n = m ? m.n : 0, url = m ? m.url : null;
  for (;;) {
    const t = await gibt(zugangPfad(n + 1));
    if (!t) break;
    n++; url = t.url;
  }
  let info;
  if (n === 0) {
    // Erster Start: alten Prüfwert (Ordner zugang/, nach einem Passwortwechsel) oder die Umgebungsvariable übernehmen
    let quelle = { pruefwert: process.env.HOF_KEY_HASH || "", verfahren: "v1", aus: "umgebung" };
    if (ALT_UEBERNEHMEN) {
      const alt = (await blob.list({ prefix: "zugang/", limit: 1000 })).blobs
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
      if (alt) {
        const j = await blobLesen(alt.url);
        if (!j || !/^[0-9a-f]{64}$/.test(j.pruefwert)) throw new Error("Zugangsdaten im Speicher beschädigt");
        quelle = { pruefwert: j.pruefwert, verfahren: j.verfahren || "v1", aus: "alt" };
      }
    }
    if (!/^[0-9a-f]{64}$/.test(quelle.pruefwert)) return { pruefwert: "", verfahren: "v1", n: 0, zeit: 0 };   // noch kein Passwort eingerichtet
    try {
      const neu = await blob.put(zugangPfad(1), JSON.stringify(quelle), OPT);
      info = { n: 1, url: neu.url, pruefwert: quelle.pruefwert, verfahren: quelle.verfahren };
    } catch (e) {
      if (await gibt(zugangPfad(1))) return zugangsInfo(true);
      throw e;
    }
  } else if (m && m.n === n) {
    info = m;
  } else {
    const j = await blobLesen(url);
    if (!j || !/^[0-9a-f]{64}$/.test(j.pruefwert)) throw new Error("Zugangsdaten im Speicher beschädigt");
    info = { n, url, pruefwert: j.pruefwert, verfahren: j.verfahren || "v1" };
  }
  merk.zugang = { ...info, zeit: Date.now() };
  return merk.zugang;
}

function schluesselRichtig(schluessel, soll) {
  const ist = pruefwert(schluessel || "");
  if (!soll || soll.length !== 64) return false;
  return crypto.timingSafeEqual(Buffer.from(ist), Buffer.from(soll));
}

function umschlagGueltig(d) {
  return d && d.v === 1 && typeof d.daten === "string" && typeof d.iv === "string";
}

// Neuen Stand n+1 anlegen. false = Nummer schon vergeben (anderes Gerät war schneller)
async function anlegen(fach, n, text) {
  try {
    const neu = await blob.put(pfad(fach, n + 1), text, OPT);
    merk[fach] = { n: n + 1, url: neu.url, zeit: Date.now() };
  } catch (e) {
    if (istFehler(e, "BlobStoreSuspendedError") || istFehler(e, "BlobServiceRateLimited")) throw e;
    if (await gibt(pfad(fach, n + 1))) return false;
    throw e;
  }
  // Alte Stände löschen (Löschen kostet nichts). Ein paar ältere mit, falls ein Löschen mal nicht klappte.
  const bis = n + 1 - FAECHER[fach].behalten;
  if (bis >= 1) {
    const weg = [];
    for (let k = Math.max(1, bis - 4); k <= bis; k++) weg.push(pfad(fach, k));
    try { await blob.del(weg); } catch (e) { /* nicht schlimm – beim nächsten Mal wieder */ }
  }
  return true;
}

// Steht "erwartet" wirklich für den neuesten Stand? Gibt die Nummer zurück oder null (= Konflikt)
async function erwarteteNummer(fach, erwartet) {
  if (erwartet === null || erwartet === undefined || erwartet === "") {
    return (await neuester(fach, 0)) ? null : 0;   // Gerät glaubt "leer" – stimmt das?
  }
  const n = versionNummer(fach, erwartet);
  if (!n) return null;                                // alte Versionsangabe → neu laden lassen
  const m = merk[fach];
  if (m && m.n > n) return null;
  // Der erwartete Stand muss noch existieren – sonst ist das Gerät zu weit zurück
  if (!(m && m.n === n && Date.now() - m.zeit < 10 * 60 * 1000) && !(await gibt(pfad(fach, n)))) return null;
  return n;
}

function fehlerText(e) {
  if (istFehler(e, "BlobStoreSuspendedError", /suspend/i)) return "Der Speicher ist bei Vercel gesperrt (monatliches Kontingent aufgebraucht?)";
  if (istFehler(e, "BlobServiceRateLimited", /rate.?limit/i)) return "Zu viele Anfragen – bitte gleich nochmal";
  return "Speicherfehler: " + (e && e.message ? e.message : String(e));
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
    if (!GEHEIM || GEHEIM.length < 16) return res.status(500).json({ ok: false, fehler: "Server nicht eingerichtet (PFAD_GEHEIM fehlt)" });
    if (req.method === "GET" && req.query && req.query.selbsttest) {
      const info = await zugangsInfo(true);
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

    // Beim Laden darf der gemerkte Prüfwert gelten; Schreiben prüft immer frisch (nach einem Passwortwechsel
    // darf kein Gerät mehr mit dem alten Schlüssel speichern – sonst könnten die anderen es nicht mehr lesen)
    let zugang = await zugangsInfo(body.aktion !== "laden");
    if (!schluesselRichtig(body.schluessel, zugang.pruefwert)) {
      // Vielleicht wurde das Passwort gerade auf einem anderen Gerät geändert → einmal frisch nachsehen
      zugang = await zugangsInfo(true);
      if (!schluesselRichtig(body.schluessel, zugang.pruefwert)) {
        await new Promise((r) => setTimeout(r, 2000));   // Bremse gegen Durchprobieren von Passwörtern
        return res.status(401).json({ ok: false, fehler: "Passwort falsch" });
      }
    }

    if (body.aktion === "passwortAendern") {
      const neu = body.neu || {};
      if (!/^[0-9a-f]{64}$/.test(neu.pruefwert || "") || neu.verfahren !== "v2") return res.status(400).json({ ok: false, fehler: "Ungültiger neuer Schlüssel" });
      const daten = body.daten || {};
      for (const f of ["herde", "feldbuch"]) {
        if (daten[f] !== null && daten[f] !== undefined && !umschlagGueltig(daten[f])) return res.status(400).json({ ok: false, fehler: "Ungültige Daten (" + f + ")" });
      }
      // Feldbuch inzwischen von einem anderen Gerät geändert? Dann erst neu laden.
      const nFb = await erwarteteNummer("feldbuch", body.feldbuchVersion || null);
      if (nFb === null) return res.status(409).json({ ok: false, konflikt: true, fehler: "Feldbuch wurde inzwischen geändert – bitte nochmal" });
      const versionen = {};
      for (const f of ["herde", "feldbuch"]) {
        if (!daten[f]) continue;
        let n = f === "feldbuch" ? nFb : ((await neuester("herde", 0)) || { n: 0 }).n;
        if (!(await anlegen(f, n, JSON.stringify(daten[f])))) return res.status(409).json({ ok: false, konflikt: true, fehler: "Inzwischen geändert – bitte nochmal" });
        versionen[f] = versionText(f, n + 1);
      }
      // Zum Schluss den neuen Prüfwert setzen – ab jetzt gilt nur noch das neue Passwort
      const aktuell = await zugangsInfo(true);
      await blob.put(zugangPfad(aktuell.n + 1), JSON.stringify({ pruefwert: neu.pruefwert, verfahren: "v2", geaendert: new Date().toISOString() }), OPT);
      merk.zugang = null;
      return res.status(200).json({ ok: true, versionen });
    }

    const fach = body.fach || "herde";
    if (!Object.prototype.hasOwnProperty.call(FAECHER, fach)) return res.status(400).json({ ok: false, fehler: "Unbekanntes Fach" });

    if (body.aktion === "laden") {
      let fehler = null;
      for (let runde = 0; runde < 2; runde++) {
        const ns = await neuester(fach, versionNummer(fach, body.bekannt));
        if (!ns) return res.status(200).json({ ok: true, daten: null, version: null });
        const version = versionText(fach, ns.n);
        if (body.nurWennNeu && body.bekannt === version) return res.status(200).json({ ok: true, unveraendert: true, version });
        try {
          return res.status(200).json({ ok: true, daten: await blobLesen(ns.url), version });
        } catch (e) {
          if (!e.vorlaeufig) throw e;
          fehler = e;
          merk[fach] = null;
        }
      }
      throw fehler;
    }

    if (body.aktion === "speichern") {
      const daten = body.daten;
      if (!umschlagGueltig(daten)) return res.status(400).json({ ok: false, fehler: "Ungültige Daten" });
      const text = JSON.stringify(daten);
      if (text.length > MAX_GROESSE) return res.status(413).json({ ok: false, fehler: "Liste zu groß" });
      const konflikt = () => res.status(409).json({ ok: false, konflikt: true, fehler: "Inzwischen von einem anderen Gerät geändert" });
      if (Object.prototype.hasOwnProperty.call(body, "erwarteteVersion")) {
        // Feldbuch: nur speichern, wenn das Gerät den neuesten Stand kannte
        const n = await erwarteteNummer(fach, body.erwarteteVersion);
        if (n === null) return konflikt();
        if (!(await anlegen(fach, n, text))) return konflikt();
        return res.status(200).json({ ok: true, version: versionText(fach, n + 1) });
      }
      // Kuhliste: das Gerät hat schon selbst verglichen, welche Liste neuer ist → einfach als neuesten Stand ablegen
      for (let versuch = 0; versuch < 3; versuch++) {
        const ns = await neuester(fach, versionNummer(fach, body.bekannt));
        const n = ns ? ns.n : 0;
        if (await anlegen(fach, n, text)) return res.status(200).json({ ok: true, version: versionText(fach, n + 1) });
      }
      return konflikt();
    }

    return res.status(400).json({ ok: false, fehler: "Unbekannte Aktion" });
  } catch (e) {
    if (e && e.vorlaeufig) return res.status(503).json({ ok: false, vorlaeufig: true, fehler: e.message });
    const gesperrt = istFehler(e, "BlobStoreSuspendedError", /suspend/i);
    return res.status(gesperrt ? 503 : 500).json({ ok: false, gesperrt, fehler: fehlerText(e) });
  }
};

/**
 * Poolehof Feldbuch – Schnittstelle zwischen der Poolehof-App und dem Google Sheet.
 *
 * Gehört an das Google Sheet "Poolehof Feldbuch" (Erweiterungen → Apps Script).
 * Die Feldarbeiten bleiben im Sheet in Julians Google Drive – nichts davon liegt
 * auf GitHub. Die App liest und schreibt nur über dieses Skript, und nur mit
 * dem Hof-Passwort (geprüft über einen SHA-256-Prüfwert, nicht das Passwort selbst).
 *
 * Bereitstellen: "Bereitstellen → Neue Bereitstellung → Web-App",
 *   Ausführen als: Ich · Zugriff: Jeder. Die angezeigte URL in der App eintragen.
 *
 * Das Sheet darf ganz normal von Hand weiterbearbeitet werden. Das Skript
 * findet die Spalten über ihre Überschrift – Spalten umsortieren oder neue
 * Spalten anfügen ist also kein Problem, nur die Überschriften nicht umbenennen.
 */

// Prüfwert des Hof-Passworts. In der öffentlichen Kopie auf GitHub steht hier
// absichtlich nichts – die echte Kopie im Google Drive hat den Wert.
const HOF_KEY_HASH = "HIER_PRUEFWERT_EINTRAGEN";

const ZEITZONE = "Europe/Berlin";
const BLATT = {
  arbeiten: "Feldarbeiten",
  mandanten: "Mandanten",
  firmen: "Firmen",
  preise: "Preise",
  rechnungen: "Rechnungen",
  listen: "Listen",
};
const DATUMS_SPALTEN = ["Datum"];
const ZAHL_SPALTEN = ["Menge", "Stunden", "Preis (€)", "Netto", "MwSt-Satz", "MwSt", "Brutto"];
// Immer als Text speichern – sonst macht Google Sheets aus "2026-001" womöglich ein Datum
const TEXT_SPALTEN = ["ID", "Rechnung", "Rechnungs-Nr.", "Letzte Rechnungs-Nr.", "Kurzname", "Mandant"];

function doGet() {
  // Nur ein Lebenszeichen – ohne Passwort gibt es keine Daten
  return antwort_({ ok: true, dienst: "Poolehof Feldbuch" });
}

function doPost(e) {
  let anfrage = {};
  try { anfrage = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) {}

  if (!schluesselRichtig_(anfrage.schluessel)) {
    Utilities.sleep(1500);   // Bremse gegen Durchprobieren
    return antwort_({ ok: false, fehler: "Passwort falsch" });
  }

  const sperre = LockService.getScriptLock();
  sperre.waitLock(20000);
  try {
    switch (anfrage.aktion) {
      case "laden":      return antwort_({ ok: true, daten: alles_() });
      case "eintragen":  return antwort_({ ok: true, ergebnis: eintragen_(anfrage.eintraege || [anfrage.eintrag]) });
      case "aendern":    return antwort_({ ok: true, ergebnis: aendern_(anfrage.id, anfrage.felder || {}) });
      case "mandant":    return antwort_({ ok: true, ergebnis: mandantSpeichern_(anfrage.mandant || {}) });
      case "rechnung":   return antwort_({ ok: true, rechnung: rechnungAnlegen_(anfrage) });
      default:           return antwort_({ ok: false, fehler: "Unbekannte Aktion" });
    }
  } catch (err) {
    return antwort_({ ok: false, fehler: String(err && err.message ? err.message : err) });
  } finally {
    sperre.releaseLock();
  }
}

// ---------------------------------------------------------------------------
function antwort_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sha256hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, "0"); }).join("");
}

function schluesselRichtig_(schluessel) {
  if (!schluessel || HOF_KEY_HASH.length !== 64) return false;
  return sha256hex_(schluessel) === HOF_KEY_HASH;
}

function blatt_(name) {
  const b = SpreadsheetApp.getActive().getSheetByName(name);
  if (!b) throw new Error("Blatt '" + name + "' fehlt im Sheet");
  return b;
}

function kopf_(b) {
  return b.getRange(1, 1, 1, b.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
}

function zelleLesen_(name, wert) {
  if (wert instanceof Date) return Utilities.formatDate(wert, ZEITZONE, "yyyy-MM-dd");
  return wert === null || wert === undefined ? "" : wert;
}

function zelleSchreiben_(name, wert) {
  if (wert === undefined || wert === null) return "";
  if (TEXT_SPALTEN.indexOf(name) >= 0) return wert === "" ? "" : "'" + String(wert);
  if (DATUMS_SPALTEN.indexOf(name) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(wert))) {
    const t = String(wert).split("-").map(Number);
    return new Date(t[0], t[1] - 1, t[2]);
  }
  if (ZAHL_SPALTEN.indexOf(name) >= 0) {
    if (wert === "") return "";
    const n = Number(String(wert).replace(",", "."));
    return isNaN(n) ? wert : n;
  }
  return wert;
}

function zeilen_(name) {
  const b = blatt_(name);
  const werte = b.getDataRange().getValues();
  if (werte.length < 2) return [];
  const k = werte[0].map(function (h) { return String(h).trim(); });
  return werte.slice(1)
    .filter(function (z) { return z.some(function (v) { return v !== "" && v !== null; }); })
    .map(function (z) {
      const o = {};
      k.forEach(function (h, i) { if (h) o[h] = zelleLesen_(h, z[i]); });
      return o;
    });
}

function listen_() {
  const b = blatt_(BLATT.listen);
  const werte = b.getDataRange().getValues();
  const k = werte[0];
  const out = {};
  k.forEach(function (h, i) {
    out[String(h).trim()] = werte.slice(1).map(function (z) { return String(z[i]).trim(); }).filter(String);
  });
  return out;
}

function alles_() {
  return {
    feldarbeiten: zeilen_(BLATT.arbeiten),
    mandanten: zeilen_(BLATT.mandanten),
    firmen: zeilen_(BLATT.firmen),
    preise: zeilen_(BLATT.preise),
    rechnungen: zeilen_(BLATT.rechnungen),
    listen: listen_(),
    stand: new Date().toISOString(),
  };
}

function zeileAnhaengen_(name, obj) {
  const b = blatt_(name);
  const k = kopf_(b);
  b.appendRow(k.map(function (h) { return zelleSchreiben_(h, obj[h]); }));
  if (name === BLATT.arbeiten) {
    const sp = k.indexOf("Datum") + 1;
    if (sp > 0) b.getRange(b.getLastRow(), sp).setNumberFormat("dd.MM.yyyy");
  }
}

function zeileFinden_(name, spalte, wert) {
  const b = blatt_(name);
  const k = kopf_(b);
  const sp = k.indexOf(spalte);
  if (sp < 0) throw new Error("Spalte '" + spalte + "' fehlt in '" + name + "'");
  const werte = b.getRange(1, sp + 1, b.getLastRow(), 1).getValues();
  for (let i = 1; i < werte.length; i++) if (String(werte[i][0]).trim() === String(wert).trim()) return { blatt: b, kopf: k, zeile: i + 1 };
  return null;
}

function felderSetzen_(treffer, felder) {
  Object.keys(felder).forEach(function (h) {
    const sp = treffer.kopf.indexOf(h);
    if (sp >= 0) treffer.blatt.getRange(treffer.zeile, sp + 1).setValue(zelleSchreiben_(h, felder[h]));
  });
}

// --- Feldarbeiten ----------------------------------------------------------
function eintragen_(eintraege) {
  const neu = [], schonDa = [];
  eintraege.filter(Boolean).forEach(function (e) {
    if (!e.ID) e.ID = "F" + Utilities.getUuid().slice(0, 8);
    // Doppelt gesendet (z.B. nach Funkloch)? Dann nicht nochmal anlegen.
    if (zeileFinden_(BLATT.arbeiten, "ID", e.ID)) { schonDa.push(e.ID); return; }
    if (!e.Erfasst) e.Erfasst = Utilities.formatDate(new Date(), ZEITZONE, "dd.MM.yyyy HH:mm") + " · App";
    zeileAnhaengen_(BLATT.arbeiten, e);
    neu.push(e.ID);
  });
  return { neu: neu, schonDa: schonDa };
}

function aendern_(id, felder) {
  const t = zeileFinden_(BLATT.arbeiten, "ID", id);
  if (!t) throw new Error("Eintrag " + id + " nicht gefunden – evtl. im Sheet gelöscht");
  delete felder.ID;
  felderSetzen_(t, felder);
  return { id: id };
}

// --- Mandanten -------------------------------------------------------------
function mandantSpeichern_(m) {
  if (!m.Kurzname) throw new Error("Kurzname fehlt");
  const t = zeileFinden_(BLATT.mandanten, "Kurzname", m.Kurzname);
  if (t) felderSetzen_(t, m); else zeileAnhaengen_(BLATT.mandanten, m);
  return { kurzname: m.Kurzname };
}

// --- Rechnungen ------------------------------------------------------------
function naechsteNummer_(letzte, jahr) {
  const m = String(letzte || "").match(/^(\d{4})-(\d+)$/);
  const n = m && Number(m[1]) === jahr ? Number(m[2]) + 1 : 1;
  return jahr + "-" + String(n).padStart(3, "0");
}

function rechnungAnlegen_(a) {
  if (!a.firma) throw new Error("Firma fehlt");
  if (!a.mandant) throw new Error("Mandant fehlt");
  if (String(a.mandant).toLowerCase() === "eigen") throw new Error("Eigene Arbeiten werden nicht abgerechnet");
  const pos = (a.positionen || []).filter(function (p) { return p && p.id; });
  if (!pos.length) throw new Error("Keine Positionen ausgewählt");

  // Alle Positionen müssen existieren und dürfen noch nicht abgerechnet sein
  const arbeiten = zeilen_(BLATT.arbeiten);
  pos.forEach(function (p) {
    const z = arbeiten.filter(function (x) { return String(x.ID) === String(p.id); })[0];
    if (!z) throw new Error("Eintrag " + p.id + " nicht gefunden");
    if (z.Rechnung) throw new Error("Eintrag " + p.id + " ist schon abgerechnet (" + z.Rechnung + ")");
  });

  const firma = zeileFinden_(BLATT.firmen, "Firma", a.firma);
  if (!firma) throw new Error("Firma '" + a.firma + "' nicht im Blatt Firmen");
  const firmaDaten = zeilen_(BLATT.firmen).filter(function (f) { return f.Firma === a.firma; })[0];
  const mandantDaten = zeilen_(BLATT.mandanten).filter(function (m) { return m.Kurzname === a.mandant; })[0] || { Kurzname: a.mandant };

  const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(a.datum)) ? String(a.datum) : Utilities.formatDate(new Date(), ZEITZONE, "yyyy-MM-dd");
  const nr = naechsteNummer_(firmaDaten["Letzte Rechnungs-Nr."], Number(datum.slice(0, 4)));
  const satz = a.mwst === undefined || a.mwst === "" ? 0.19 : Number(a.mwst);

  let netto = 0;
  pos.forEach(function (p) {
    p.menge = Number(String(p.menge).replace(",", ".")) || 0;
    p.preis = Number(String(p.preis).replace(",", ".")) || 0;
    p.betrag = Math.round(p.menge * p.preis * 100) / 100;
    netto += p.betrag;
  });
  netto = Math.round(netto * 100) / 100;
  const mwst = Math.round(netto * satz * 100) / 100;
  const brutto = Math.round((netto + mwst) * 100) / 100;

  // 1) Nummer hochzählen  2) Rechnung ablegen  3) Arbeiten als abgerechnet markieren  4) Preise merken
  felderSetzen_(firma, { "Letzte Rechnungs-Nr.": nr });
  zeileAnhaengen_(BLATT.rechnungen, {
    "Rechnungs-Nr.": nr, "Firma": a.firma, "Datum": datum, "Mandant": a.mandant,
    "Netto": netto, "MwSt-Satz": satz, "MwSt": mwst, "Brutto": brutto,
    "Positionen": JSON.stringify(pos),
    "Erstellt": Utilities.formatDate(new Date(), ZEITZONE, "dd.MM.yyyy HH:mm") + " · App",
  });
  const sp = blatt_(BLATT.rechnungen);
  sp.getRange(sp.getLastRow(), kopf_(sp).indexOf("Datum") + 1).setNumberFormat("dd.MM.yyyy");
  pos.forEach(function (p) { felderSetzen_(zeileFinden_(BLATT.arbeiten, "ID", p.id), { "Rechnung": nr }); });
  pos.forEach(function (p) {
    if (!p.taetigkeit || !p.einheit) return;
    const preise = blatt_(BLATT.preise);
    const k = kopf_(preise);
    const werte = preise.getDataRange().getValues();
    let gefunden = 0;
    for (let i = 1; i < werte.length; i++) {
      if (werte[i][k.indexOf("Tätigkeit")] === p.taetigkeit && werte[i][k.indexOf("Einheit")] === p.einheit &&
          String(werte[i][k.indexOf("Mandant")]) === String(a.mandant)) { gefunden = i + 1; break; }
    }
    const stand = Utilities.formatDate(new Date(), ZEITZONE, "dd.MM.yyyy");
    if (gefunden) felderSetzen_({ blatt: preise, kopf: k, zeile: gefunden }, { "Preis (€)": p.preis, "Stand": stand });
    else zeileAnhaengen_(BLATT.preise, { "Tätigkeit": p.taetigkeit, "Einheit": p.einheit, "Mandant": a.mandant, "Preis (€)": p.preis, "Stand": stand });
  });

  return { nr: nr, datum: datum, firma: firmaDaten, mandant: mandantDaten, positionen: pos,
           netto: netto, mwstSatz: satz, mwst: mwst, brutto: brutto };
}

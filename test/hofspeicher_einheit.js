// Prüft den Server-Code (hofspeicher/api/herde.js) direkt: Übernahme alter Daten, Konflikte,
// Passwortwechsel, Aufräumen und vor allem: wie viele (begrenzte) Vorgänge jede Aktion verbraucht.
// Aufruf: test/.werkzeuge/node/bin/node test/hofspeicher_einheit.js
const Module = require("module");
const path = require("path");
const crypto = require("crypto");
const ATTRAPPE = path.join(__dirname, "blob_attrappe.js");
const echt = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "@vercel/blob" ? ATTRAPPE : echt.call(this, req, ...rest); };
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const KEY = "schluessel-test", KEY2 = "schluessel-neu";
process.env.HOF_KEY_HASH = sha(KEY);
process.env.PFAD_GEHEIM = "geheimgeheim1234567890";
const blob = require(ATTRAPPE);
const HANDLER = path.join(__dirname, "..", "hofspeicher", "api", "herde.js");
let handler = require(HANDLER);
// Neue Server-Instanz (kalter Start, nichts gemerkt)
const neuStart = () => { delete require.cache[require.resolve(HANDLER)]; handler = require(HANDLER); };

const erg = []; const pruef = (name, ok, info = "") => erg.push({ name, ok: !!ok, info: ok ? "" : String(info) });
async function rufe(body, query) {
  let status = 200, out = null;
  const res = { setHeader() {}, status(c) { status = c; return this; }, json(o) { out = o; }, end() {} };
  await handler({ method: query ? "GET" : "POST", headers: {}, query: query || {}, body: query ? undefined : JSON.stringify(body) }, res);
  return { status, ...out };
}
const umschlag = (x) => ({ v: 1, iv: "iv", daten: "verschluesselt-" + x, hochgeladen: "2026-10-27" });
const kosten = async (fn) => { const a = blob._zaehler.aufwendig, e = blob._zaehler.einfach; const r = await fn(); return { r, aufwendig: blob._zaehler.aufwendig - a, einfach: blob._zaehler.einfach - e }; };

(async () => {
  // Alter Speicher wie bisher: Zufallsnamen, Feldbuch mit Verlauf, Kuhliste, Zugang nach Passwortwechsel
  await blob.put("feldbuch/liste.json", JSON.stringify(umschlag("fb-alt-1")), { access: "public" });
  await blob.put("feldbuch/liste.json", JSON.stringify(umschlag("fb-alt-2")), { access: "public" });
  await blob.put("herde/liste.json", JSON.stringify(umschlag("herde-alt")), { access: "public" });
  await blob.put("zugang/pruefwert.json", JSON.stringify({ pruefwert: sha(KEY), verfahren: "v2" }), { access: "public" });

  const v = await rufe(null, { verfahren: "1" });
  pruef("Verfahren aus altem Zugang übernommen (v2)", v.ok && v.verfahren === "v2", JSON.stringify(v));
  let l = await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY });
  pruef("Übernahme: neuester alter Feldbuch-Stand", l.ok && l.daten && l.daten.daten === "verschluesselt-fb-alt-2" && l.version === "v2:feldbuch:1", JSON.stringify(l));
  const h = await rufe({ aktion: "laden", fach: "herde", schluessel: KEY });
  pruef("Übernahme: Kuhliste", h.ok && h.daten.daten === "verschluesselt-herde-alt" && h.version === "v2:herde:1", JSON.stringify(h));
  pruef("Falsches Passwort abgelehnt", (await rufe({ aktion: "laden", fach: "feldbuch", schluessel: "falsch" })).status === 401);

  // Verbrauch im Alltag (warme Instanz)
  let k = await kosten(() => rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY, bekannt: "v2:feldbuch:1" }));
  pruef("Laden (warm): 0 aufwendige Vorgänge", k.r.ok && k.aufwendig === 0, JSON.stringify(k));
  k = await kosten(() => rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY, daten: umschlag("fb-2"), erwarteteVersion: "v2:feldbuch:1" }));
  pruef("Speichern: genau 1 aufwendiger Vorgang", k.r.ok && k.r.version === "v2:feldbuch:2" && k.aufwendig === 1 && k.einfach <= 3, JSON.stringify(k));
  k = await kosten(() => rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY, bekannt: "v2:feldbuch:2", nurWennNeu: true }));
  pruef("Laden ohne Änderung: „unverändert“, 0 aufwendig", k.r.unveraendert && k.r.version === "v2:feldbuch:2" && !k.r.daten && k.aufwendig === 0, JSON.stringify(k));

  // Kalter Start (neue Instanz): mit Hinweis vom Gerät kein Auflisten nötig
  neuStart();
  k = await kosten(() => rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY, bekannt: "v2:feldbuch:2" }));
  pruef("Kalter Start + Hinweis: 0 aufwendige Vorgänge", k.r.ok && k.r.daten.daten === "verschluesselt-fb-2" && k.aufwendig === 0, JSON.stringify(k));
  neuStart();
  k = await kosten(() => rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY }));
  pruef("Kalter Start ohne Hinweis (neues Gerät): 1× Auflisten", k.r.ok && k.r.version === "v2:feldbuch:2" && k.aufwendig === 1, JSON.stringify(k));

  // Konflikte
  let s = await rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY, daten: umschlag("x"), erwarteteVersion: "v2:feldbuch:1" });
  pruef("Veralteter Stand → Konflikt", s.status === 409 && s.konflikt, JSON.stringify(s));
  s = await rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY, daten: umschlag("x"), erwarteteVersion: "feldbuch/liste-abc.json" });
  pruef("Alte Versionsangabe (vor dem Umbau) → Konflikt, Gerät lädt neu", s.status === 409);
  s = await rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY, daten: umschlag("x"), erwarteteVersion: null });
  pruef("„Leer“ erwartet, aber Daten da → Konflikt", s.status === 409);
  // Zwei Geräte gleichzeitig auf demselben Stand: genau eins gewinnt
  const [a, b] = await Promise.all([
    rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY, daten: umschlag("A"), erwarteteVersion: "v2:feldbuch:2" }),
    rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY, daten: umschlag("B"), erwarteteVersion: "v2:feldbuch:2" })]);
  pruef("Gleichzeitig speichern: genau eins gewinnt", [a, b].filter((x) => x.ok).length === 1 && [a, b].filter((x) => x.konflikt).length === 1, JSON.stringify([a, b]));
  // Andere Instanz hat inzwischen gespeichert (diese Instanz weiß es nicht)
  const fremd = blob._dateien.size;
  await blob.put(`d/${process.env.PFAD_GEHEIM}/feldbuch/00000004.json`, JSON.stringify(umschlag("fremd")), { addRandomSuffix: false });
  l = await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY, bekannt: "v2:feldbuch:3" });
  pruef("Neuerer Stand einer anderen Instanz wird gefunden", l.version === "v2:feldbuch:4" && l.daten.daten === "verschluesselt-fremd" && blob._dateien.size === fremd + 1, JSON.stringify(l));
  s = await rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY, daten: umschlag("y"), erwarteteVersion: "v2:feldbuch:3" });
  pruef("… und Speichern auf dem alten Stand gibt Konflikt", s.status === 409);

  // Aufräumen: nur die letzten 30 Feldbuch-Stände bleiben, Suche funktioniert weiter
  let ver = "v2:feldbuch:4";
  for (let i = 0; i < 40; i++) { const r = await rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY, daten: umschlag("s" + i), erwarteteVersion: ver }); ver = r.version; }
  const fbDateien = [...blob._dateien.keys()].filter((p) => p.includes("/feldbuch/") && p.startsWith("d/"));
  pruef("Nur die letzten 30 Stände bleiben", fbDateien.length === 30 && ver === "v2:feldbuch:44", fbDateien.length + " " + ver);
  neuStart();
  l = await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY, bekannt: "v2:feldbuch:5" });
  pruef("Gerät war lange weg (Stand gelöscht) → findet trotzdem den neuesten", l.version === "v2:feldbuch:44" && l.daten.daten === "verschluesselt-s39", JSON.stringify(l).slice(0, 200));
  neuStart();
  k = await kosten(() => rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY, bekannt: "v2:feldbuch:30" }));
  pruef("14 Stände zurück: findet den neuesten mit wenigen Abfragen", k.r.version === "v2:feldbuch:44" && k.aufwendig === 0 && k.einfach <= 12, JSON.stringify({ a: k.aufwendig, e: k.einfach, v: k.r.version }));

  // Kuhliste ohne erwartete Version (wie die App sie speichert)
  s = await rufe({ aktion: "speichern", fach: "herde", schluessel: KEY, daten: umschlag("herde-2"), bekannt: "v2:herde:1" });
  pruef("Kuhliste speichern", s.ok && s.version === "v2:herde:2", JSON.stringify(s));

  // Passwortwechsel
  l = await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY });
  s = await rufe({ aktion: "passwortAendern", schluessel: KEY, neu: { pruefwert: sha(KEY2), verfahren: "v2" },
    daten: { herde: umschlag("herde-neu"), feldbuch: umschlag("fb-neu") }, feldbuchVersion: l.version });
  pruef("Passwort ändern", s.ok && s.versionen.feldbuch === "v2:feldbuch:45", JSON.stringify(s));
  pruef("Altes Passwort sofort gesperrt (gleiche Instanz)", (await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY })).status === 401);
  l = await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY2 });
  pruef("Neues Passwort geht", l.ok && l.daten.daten === "verschluesselt-fb-neu");
  neuStart();
  pruef("Neues Passwort auch nach Neustart", (await rufe({ aktion: "laden", fach: "herde", schluessel: KEY2 })).ok && (await rufe({ aktion: "laden", fach: "herde", schluessel: KEY })).status === 401);
  // Andere (warme) Instanz kannte noch das alte Passwort: Schreiben mit altem Schlüssel muss trotzdem scheitern
  const altInst = handler; neuStart();
  await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY2 });
  await blob.put(`d/${process.env.PFAD_GEHEIM}/zugang/0003.json`, JSON.stringify({ pruefwert: sha("drittes"), verfahren: "v2" }), { addRandomSuffix: false });
  s = await rufe({ aktion: "speichern", fach: "feldbuch", schluessel: KEY2, daten: umschlag("z"), erwarteteVersion: "v2:feldbuch:45" });
  pruef("Nach Passwortwechsel woanders: Speichern mit altem Schlüssel abgelehnt", s.status === 401, JSON.stringify(s));
  handler = altInst;

  // Gesperrter Speicher (Kontingent aufgebraucht): klare Meldung
  neuStart(); blob._stoerung.gesperrt = true;
  s = await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY2 });
  pruef("Gesperrt: verständliche Meldung", s.status === 503 && s.gesperrt && /gesperrt/.test(s.fehler), JSON.stringify(s));
  blob._stoerung.gesperrt = false;

  // Ohne PFAD_GEHEIM startet der Server nicht (sonst wären die Dateinamen erratbar)
  const g = process.env.PFAD_GEHEIM; process.env.PFAD_GEHEIM = ""; neuStart();
  s = await rufe({ aktion: "laden", fach: "feldbuch", schluessel: KEY2 });
  pruef("Ohne PFAD_GEHEIM: Fehler statt erratbarer Namen", s.status === 500 && /PFAD_GEHEIM/.test(s.fehler));
  process.env.PFAD_GEHEIM = g;

  const fehl = erg.filter((x) => !x.ok);
  erg.forEach((x) => console.log((x.ok ? "✓ " : "✗ ") + x.name + (x.ok ? "" : " → " + x.info)));
  console.log(`ERGEBNIS: ${erg.length - fehl.length}/${erg.length} Server-Prüfungen bestanden`);
  process.exit(fehl.length ? 1 : 0);
})().catch((e) => { console.log("ABSTURZ", e.stack); process.exit(1); });

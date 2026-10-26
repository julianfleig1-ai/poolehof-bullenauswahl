// Komplett-Test Feldbuch (läuft in der Seite, gegen die lokale Attrappe, nur Testdaten)
(async () => {
  const erg = [];
  const pruef = (name, ok, info = "") => erg.push({name, ok: !!ok, info: ok ? "" : String(info).slice(0, 300)});
  const warte = ms => new Promise(r => setTimeout(r, ms));
  window.confirm = () => true; window.__alerts = []; window.alert = m => window.__alerts.push(m);
  const schritt = async (name, fn) => { try { await fn(); } catch(e) { pruef(name + " (Absturz)", false, e.stack || e.message); } };
  localStorage.clear();

  await schritt("Anmelden", async () => {
    fbRenderVerbindung();
    $fb("fbPasswort").value = "test-4711";
    $fb("fbPwForm").requestSubmit();
    for (let i = 0; i < 40 && !(hsZugang && fbStatus.zustand === "ok"); i++) await warte(200);
    pruef("Anmelden mit Hof-Passwort", hsZugang && fbStatus.zustand === "ok", fbStatus.text);
    pruef("Leeres Feldbuch zeigt Startdaten-Hinweis", /noch leer/.test($fb("fbVerbindung").innerText));
  });
  await schritt("Startdaten", async () => {
    const t = await (await fetch("http://127.0.0.1:8778/test_start.json")).text();
    await fbStartdatenDatei(new File([t], "x.json"));
    pruef("Startdaten übernommen", fbArbeiten().length === 4 && fbOps.length === 0, fbArbeiten().length);
    await fbStartdatenDatei(new File([t], "x.json"));
    pruef("Zweiter Import wird abgelehnt", fbArbeiten().length === 4 && window.__alerts.some(a => /schon Einträge/.test(a)), JSON.stringify(window.__alerts));
    await fbAendern({typ: "mandant", mandant: {Kurzname: "Nagel", Name: "Klaus Nagel", "Andere Namen": "Ebersteinhof", "Straße": "Weg 1", "PLZ Ort": "11111 Ort", Notiz: ""}});
  });
  await schritt("Spracheingabe", async () => {
    const F = [
      ["heute bei Nagel acht komma sechs Hektar Getreide gespritzt mit null komma vier Liter Vulcanus", {Mandant: "Nagel", "Tätigkeit": "Pflanzenschutz", Menge: "8,6", Einheit: "ha", Kultur: "Getreide"}],
      ["beim Ebersteinhof 3 Stunden gemäht", {Mandant: "Nagel", "Tätigkeit": "Mähen", Stunden: "3"}],
      ["vorgestern 20 Kubik Gülle auf 8 Hektar", {"Tätigkeit": "Gülle fahren", Menge: "8", "Mittel / Dünger": "Gülle 20 m³/ha"}],
      ["acht Hektar Mais gesät nein neun", {"Tätigkeit": "Säen", Menge: "9", Kultur: "Mais"}],
      ["heute 12 ha Mais gesät", {Kultur: "Mais", "Tätigkeit": "Säen", Menge: "12"}],
      ["Montage am Pflug repariert", {}],
      ["letzten Samstag gekreiselt 2 Hektar", {"Tätigkeit": "Eggen"}],
      ["heute um 7 Uhr BBCH 32 Weizen gespritzt", {BBCH: "32", Uhrzeit: "07:00", Kultur: "Winterweizen"}],
    ];
    F.forEach(([text, soll]) => {
      const f = fbVerstehen(text).felder;
      const falsch = Object.entries(soll).filter(([k, v]) => String(f[k] || "") !== v);
      pruef("Versteht: " + text, !falsch.length, JSON.stringify(falsch.map(([k, v]) => `${k}: ${f[k]} statt ${v}`)));
    });
    const mais = fbVerstehen("heute 12 ha Mais gesät").felder.Datum;
    pruef("„Mais“ wird nicht als Monat Mai gelesen", mais === fbHeuteIso(), mais);
    pruef("„Montage“ ist kein Wochentag", !fbVerstehen("Montage am Pflug repariert").felder.Datum);
  });
  await schritt("Eintragen", async () => {
    fbZeigeTab("eintragen");
    $fb("fbText").value = "heute für Nagel 2 Stunden gemulcht"; fbTextAuswerten();
    pruef("Vorschau erscheint", !$fb("fbErkannt").hidden && /für Nagel/.test($fb("fbErkannt").innerText));
    const vorher = fbArbeiten().length;
    $fb("fbVorschauOk").click(); await warte(1200);
    pruef("Eintrag gespeichert und übertragen", fbArbeiten().length === vorher + 1 && !fbOps.length, `${fbArbeiten().length} / ops ${fbOps.length}`);
    const rueck = document.querySelector("#fbGespeichert .fb-meldung button");
    rueck.click(); await warte(1000);
    pruef("Rückgängig löscht den Eintrag", fbArbeiten().length === vorher);
    $fb("fbText").value = "heute 3 Stunden gemulcht"; fbTextAuswerten();
    pruef("Ohne Mandant: Hinweis + Schnellknöpfe", !!document.querySelector(".fb-vorschau-mandant"));
    fbFormularLeeren();
    $fb("fbForm").elements["Tätigkeit"].value = "Walzen"; $fb("fbForm").elements["Menge"].value = "5";
    fbHatErgebnis = false; fbMikroStopp();
    pruef("Mikrofon aus ohne Ergebnis leert keine Felder", $fb("fbForm").elements["Tätigkeit"].value === "Walzen");
    fbFormularLeeren();
  });
  await schritt("Bearbeiten/Löschen", async () => {
    const id = fbArbeiten().find(a => a.ID === "T-001").ID;
    fbBearbeiten(id);
    const form = $fb("fbDialogForm"); form.elements["Menge"].value = "30"; form.requestSubmit(); await warte(1000);
    pruef("Bearbeiten speichert", String(fbArbeiten().find(a => a.ID === id).Menge) === "30");
    await fbAendern({typ: "neu", eintrag: {ID: "WEG-1", Datum: fbHeuteIso(), Mandant: "Eigen", "Tätigkeit": "Walzen"}});
    fbBearbeiten("WEG-1"); $fb("fbEintragLoeschen").click(); await warte(1000);
    pruef("Löschen entfernt den Eintrag", !fbArbeiten().some(a => a.ID === "WEG-1"));
  });
  await schritt("Funkloch", async () => {
    const echt = window.fetch;
    window.fetch = (u, o) => String(u).includes("8779") ? Promise.reject(new TypeError("offline")) : echt(u, o);
    const ok = await fbAendern({typ: "neu", eintrag: {ID: "OFF-1", Datum: fbHeuteIso(), Mandant: "Eigen", "Tätigkeit": "Walzen", Menge: 4, Einheit: "ha"}});
    pruef("Ohne Netz: Eintrag bleibt auf dem Gerät", !ok && fbOps.length === 1 && fbArbeiten().some(a => a.ID === "OFF-1" && a.__wartet));
    pruef("Ohne Netz: verständlicher Hinweis", /nicht erreichbar/i.test($fb("fbVerbindung").innerText), $fb("fbVerbindung").innerText);
    window.fetch = echt;
    await fbSync();
    pruef("Mit Netz: wird nachgereicht", !fbOps.length && fbArbeiten().some(a => a.ID === "OFF-1" && !a.__wartet));
  });
  await schritt("Zwei Geräte", async () => {
    const j = await hsAnfrage({aktion: "laden", fach: "feldbuch", schluessel: hsZugang.auth});
    const d = await hsEntschluesseln(j.daten);
    d.feldarbeiten.push({ID: "B-1", Datum: fbHeuteIso(), Mandant: "Muster", "Tätigkeit": "Mähen", Stunden: 3});
    await hsAnfrage({aktion: "speichern", fach: "feldbuch", schluessel: hsZugang.auth, daten: await hsVerschluesseln({...d, hochgeladen: new Date().toISOString()}), erwarteteVersion: j.version});
    await fbAendern({typ: "neu", eintrag: {ID: "A-1", Datum: fbHeuteIso(), Mandant: "Beispiel", "Tätigkeit": "Mulchen", Stunden: 2}});
    pruef("Gleichzeitig gespeichert: beide Einträge erhalten", fbArbeiten().some(a => a.ID === "B-1") && fbArbeiten().some(a => a.ID === "A-1"));
  });
  await schritt("Sicherheitsbremse", async () => {
    const echt = hsAnfrage;
    hsAnfrage = async n => n.aktion === "laden" && n.fach === "feldbuch" ? {ok: true, daten: null, version: null} : echt(n);
    const vorher = fbArbeiten().length;
    await fbAendern({typ: "neu", eintrag: {ID: "BR-1", Datum: fbHeuteIso(), Mandant: "Eigen", "Tätigkeit": "Walzen"}});
    hsAnfrage = echt;
    const server = await hsEntschluesseln((await hsAnfrage({aktion: "laden", fach: "feldbuch", schluessel: hsZugang.auth})).daten);
    pruef("„Leer“-Meldung überschreibt nichts", server.feldarbeiten.length >= vorher && fbStatus.zustand === "fehler", `${server.feldarbeiten.length} / ${fbStatus.zustand}`);
    await fbSync();
    pruef("Danach normal weiter", !fbOps.length && fbArbeiten().some(a => a.ID === "BR-1"));
  });
  await schritt("Rechnung", async () => {
    fbZeigeTab("liste"); $fb("fbFilterJahr").value = ""; $fb("fbAuswahlKnopf").click();
    ["T-002", "T-003", "A-1"].forEach(fbAuswahlUmschalten);
    $fb("fbAuswahlUebernehmen").click(); await warte(200);
    const knopf = document.querySelector('#fbDialog button[data-m="Muster"]');
    pruef("Mehrere Namen: Empfänger-Auswahl", !!knopf);
    knopf.click(); await warte(200);
    Object.values(fbRe.positionen).forEach(p => { p.preis = "40"; if (!p.menge) p.menge = "1"; });
    fbRenderRePositionen();
    await fbRechnungErstellen(); await warte(300);
    const re = fbDaten.rechnungen[fbDaten.rechnungen.length - 1];
    pruef("Rechnung erstellt", re && re.Mandant === "Muster" && re.Positionen.length === 3, $fb("fbReInfo").innerText);
    pruef("„Beispiel“-Arbeit auf Muster umgeschrieben", fbArbeiten().find(a => a.ID === "A-1").Mandant === "Muster");
    pruef("Arbeiten als abgerechnet markiert", ["T-002", "T-003", "A-1"].every(id => fbArbeiten().find(a => a.ID === id).Rechnung === re["Rechnungs-Nr."]));
    pruef("Nummer fortlaufend (2026-005)", re["Rechnungs-Nr."] === new Date().getFullYear() + "-005", re["Rechnungs-Nr."]);
    const pdf = await fbRechnungPdf(document.querySelector("#rechnungDruck .re-blatt"), "t.pdf");
    pruef("Rechnungs-PDF entsteht", pdf.size > 20000, pdf.size);
    $fb("reZu").click();
    await fbAendern({typ: "bezahlt", nr: re["Rechnungs-Nr."], firma: re.Firma, datum: fbHeuteIso()});
    pruef("Als bezahlt markiert", fbZahlStatus(fbDaten.rechnungen.find(r => r["Rechnungs-Nr."] === re["Rechnungs-Nr."])).art === "bezahlt");
    await fbSofort({typ: "storno", nr: re["Rechnungs-Nr."], firma: re.Firma});
    pruef("Storno: Arbeiten wieder offen", ["T-002", "T-003"].every(id => !fbArbeiten().find(a => a.ID === id).Rechnung));
    let fehler = "";
    try { await fbSofort({typ: "rechnung", firma: "Testhof", mandant: "Eigen", datum: fbHeuteIso(), positionen: [{id: "T-001", menge: 1, preis: 1}]}); } catch(e) { fehler = e.message; }
    pruef("Eigene Arbeiten nicht abrechenbar", /nicht abgerechnet/.test(fehler), fehler);
  });
  await schritt("Preise/Stammdaten", async () => {
    await fbAendern({typ: "standardpreise", liste: [{"Tätigkeit": "Mähen", Einheit: "h", "Preis (€)": 70}]});
    pruef("Standardpreis wird vorgeschlagen", fbPreisVorschlag("Mähen", "h", "Beispiel") === 70);
    await fbAendern({typ: "firma", alt: "Testhof", felder: {...fbDaten.firmen[0], "Letzte Rechnungs-Nr.": new Date().getFullYear() + "-041"}});
    pruef("Letzte Rechnungsnummer übernommen", fbNaechsteNr("Testhof", fbHeuteIso()) === new Date().getFullYear() + "-042");
    await fbAendern({typ: "mandant", mandant: {Kurzname: "Doppelt", Name: "", "Andere Namen": "", "Straße": "", "PLZ Ort": "", Notiz: ""}});
    await fbAendern({typ: "neu", eintrag: {ID: "DP-1", Datum: fbHeuteIso(), Mandant: "Doppelt", "Tätigkeit": "Mähen", Stunden: 1}});
    await fbAendern({typ: "mandantZusammen", von: "Doppelt", nach: "Nagel"});
    pruef("Zusammenführen", fbArbeiten().find(a => a.ID === "DP-1").Mandant === "Nagel" && !fbDaten.mandanten.some(m => m.Kurzname === "Doppelt"));
    fbZeigeTab("stamm");
    const inp = document.querySelector("#fbStPreise input[data-k='Preis (€)']");
    inp.value = "99"; inp.dispatchEvent(new Event("input", {bubbles: true}));
    fbRenderAlles();
    pruef("Ungespeicherte Eingabe überlebt Abgleich", document.querySelector("#fbStPreise input[data-k='Preis (€)']").value === "99");
    fbZeigeTab("eintragen");
  });
  await schritt("Doku", async () => {
    await fbAendern({typ: "neu", eintrag: {ID: "PS-1", Datum: fbHeuteIso(), Mandant: "Eigen", "Tätigkeit": "Pflanzenschutz", Kultur: "Mais", "Ort / Schlag": "Testacker", Menge: 10, Einheit: "ha", "Mittel / Dünger": "Laudis 1,4 + Spectrum 0,9", BBCH: "14"}});
    await fbAendern({typ: "neu", eintrag: {ID: "DU-1", Datum: fbHeuteIso(), Mandant: "Eigen", "Tätigkeit": "Düngen", Kultur: "Mais", "Ort / Schlag": "Testacker", Menge: 10, Einheit: "ha", "Mittel / Dünger": "KAS 2 dt/ha"}});
    await fbAendern({typ: "mittel", liste: [{Name: "KAS", Art: "Mineraldünger", "Zulassungs-Nr.": "", N: "27", "N verfügbar": "", P2O5: "", Bezug: "%"}]});
    fbZeigeTab("doku");
    const ps = fbPsZeilen(String(new Date().getFullYear()), "Eigen"), du = fbDuengeZeilen(String(new Date().getFullYear()), "Eigen");
    pruef("PS-Doku: eine Zeile je Mittel", ps.filter(z => z.a.ID === "PS-1").length === 2);
    pruef("Dünge-Doku: KAS 2 dt/ha = 54 kg N/ha", du.find(z => z.a.ID === "DU-1").n === "54");
    for (const [art, fmt] of [["ps", "pdf"], ["ps", "csv"], ["duenger", "pdf"], ["duenger", "csv"]]){
      const d = await fbDokuDatei(art, fmt);
      pruef(`Doku ${art} ${fmt} entsteht`, d.datei.size > 100, d.datei.size);
    }
    pruef("„Was fehlt noch?“ wird angezeigt", $fb("fbDokuCheck").innerText.length > 20);
    fbZeigeTab("eintragen");
  });
  await schritt("Sicherung", async () => {
    let gesichert = [];
    const echt = fbSichern; fbSichern = async (name, inhalt) => { gesichert.push([name, (inhalt.size || inhalt.length)]); return "gespeichert"; };
    fbExportCsv(); fbExportJson();
    fbSichern = echt;
    pruef("Excel-CSV und Sicherung entstehen", gesichert.length === 2 && gesichert.every(g => g[1] > 100), JSON.stringify(gesichert));
  });
  await schritt("Alle Reiter", async () => {
    for (const t of FB_TABS){ fbZeigeTab(t); await warte(150); }
    pruef("Alle Reiter zeichnen ohne Fehler", true);
    fbZeigeTab("eintragen");
  });
  await schritt("Liste", async () => {
    fbZeigeTab("liste"); $fb("fbFilterJahr").value = ""; fbListeFilter = "alle"; fbRenderListe();
    const L = () => $fb("fbListeBody");
    pruef("Liste: alte Häkchen weg, Filter-Knöpfe da", !$fb("fbNurOffen") && !$fb("fbNurPruefen") && $fb("fbChips").querySelectorAll(".fb-chip").length === 5);
    pruef("Liste: nach Monaten gruppiert", L().querySelectorAll(".fb-monat").length >= 2, L().querySelectorAll(".fb-monat").length);
    await fbAendern({typ: "neu", eintrag: {ID: "L-1", Datum: fbHeuteIso(), Mandant: "Muster", "Tätigkeit": "Mähen", Kultur: "Grünland", "Ort / Schlag": "Hinterwiese", Menge: "", Einheit: "", Stunden: "2,5", "Mittel / Dünger": "", Bemerkung: "Zaun am Bach kaputt", Rechnung: "", "Prüfen": ""}});
    const zeile = L().querySelector('[data-id="L-1"]');
    pruef("Liste zeigt alle Angaben inkl. Bemerkung", zeile && /Mähen Grünland/.test(zeile.innerText) && /2,5 Std/.test(zeile.innerText) && /Hinterwiese/.test(zeile.innerText) && /Zaun am Bach/.test(zeile.innerText), zeile && zeile.innerText);
    await fbAendern({typ: "neu", eintrag: {ID: "L-LANG", Datum: fbHeuteIso(), Mandant: "Beispiel", "Tätigkeit": "Pflanzenschutz", Kultur: "Winterweizen", "Ort / Schlag": "Oberfeld hinter dem Wald", Menge: "9,6", Einheit: "ha", Stunden: "", "Mittel / Dünger": "Herbizid: Vulcanus 0,4 + Trinity 2,0 + Netzmittel 0,1", Bemerkung: "2.10.–7.10.; WW Optimist 190 kg/ha, Bicross 180 kg/ha; Getreide gesamt 91,44 ha (Display 101,49), 2,8 ha/h, 10,1 l/ha, 1022 l, 36 Motorstunden, Arbeitszeit 20,2, 8,2 km/h, sehrlangeswortohneleerzeichenzumtestenderbreite", Rechnung: "", "Prüfen": ""}});
    const breite = () => { const t = L().querySelector(".fb-tab"); return [t.scrollWidth, $fb("fbListe").clientWidth]; };
    pruef("Lange Texte: Tabelle bleibt im Kasten (PC)", breite()[0] <= breite()[1] + 1, JSON.stringify(breite()));
    pruef("Spalte Ort/Schlag entfernt, Schlag steht bei der Arbeit", !/Ort \/ Schlag/.test(L().querySelector("thead").innerText) && /Oberfeld hinter dem Wald/.test(L().querySelector('[data-id="L-LANG"] .c-arbeit').innerText));
    // neue Notiz
    $fb("fbAuswahlKnopf").click(); $fb("fbNotizNeu").click(); await warte(50);
    const f = $fb("fbNotizForm");
    f.elements.Bemerkung.value = "Drainage am Oberfeld prüfen"; f.elements.Mandant.value = "Muster"; f.requestSubmit(); await warte(400);
    const notiz = fbArbeiten().find(a => fbIstNotiz(a) && /Drainage/.test(a.Bemerkung));
    pruef("Notiz gespeichert", notiz && notiz.Datum === fbHeuteIso());
    if (fbAuswahl) $fb("fbAuswahlKnopf").click();
    pruef("Notiz nicht abzurechnen", notiz && !fbOffeneFuer("Muster").includes(notiz) && !fbAbzurechnen(notiz));
    $fb("fbChips").querySelector('[data-filter="notiz"]').click();
    pruef("Knopf „Notizen“ zeigt nur Notizen", [...L().querySelectorAll(".fb-e")].length >= 1 && [...L().querySelectorAll(".fb-e")].every(e => e.classList.contains("notiz")));
    // alte Notiz übernehmen
    pruef("Alte Notizen werden angeboten", /Testnotiz/.test($fb("fbAltNotizen").innerText));
    $fb("fbAltNotizen").querySelector("[data-alt-ueber]").click(); await warte(50);
    $fb("fbNotizForm").requestSubmit(); await warte(400);
    pruef("Alte Notiz übernommen", !(fbDaten.notizen || []).length && fbArbeiten().some(a => fbIstNotiz(a) && /Testnotiz/.test(a.Bemerkung)) && !$fb("fbAltNotizen").innerText.trim());
    // Rechnung aus der Liste öffnen
    await fbSofort({typ: "rechnung", firma: "Testhof", mandant: "Muster", datum: fbHeuteIso(), positionen: [{id: "L-1", menge: 2.5, preis: 50}]});
    $fb("fbChips").querySelector('[data-filter="abgerechnet"]').click();
    const link = L().querySelector('[data-id="L-1"] .fb-re-link');
    pruef("Abgerechnet zeigt Rechnungs-Knopf", !!link && [...L().querySelectorAll(".fb-e")].every(e => e.querySelector(".fb-re-link")));
    link.click(); await warte(300);
    pruef("Tipp auf Rechnung öffnet die Rechnung", new RegExp(link.dataset.re).test($fb("rechnungDruck").innerText) && !document.querySelector("#fbDialog[open]"));
    $fb("reZu").click();
    $fb("fbChips").querySelector('[data-filter="offen"]').click();
    pruef("„Noch abzurechnen“ ohne Eigene/Notizen/Abgerechnete", [...L().querySelectorAll(".fb-e")].every(e => { const a = fbArbeiten().find(x => x.ID === e.dataset.id); return fbAbzurechnen(a); }));
    $fb("fbAuswahlKnopf").click();
    pruef("Auswahl: Notizen nicht wählbar", (() => { const n = fbArbeiten().find(fbIstNotiz); fbAuswahlUmschalten(n.ID); return !fbAuswahl.has(n.ID); })());
    $fb("fbAuswahlKnopf").click();
    pruef("Auswahl beenden", !fbAuswahl && $fb("fbAuswahlLeiste").hidden && /Auswählen/.test($fb("fbAuswahlKnopf").textContent));
    // Auswählen → Notiz zu mehreren Arbeiten (auch zu einer abgerechneten)
    $fb("fbChips").querySelector('[data-filter="alle"]').click();
    $fb("fbAuswahlKnopf").click();
    ["T-001", "T-003"].forEach(fbAuswahlUmschalten);
    pruef("Auswahl: Leiste mit Notiz + Rechnung", $fb("fbAuswahlNotiz") && $fb("fbAuswahlUebernehmen") && !$fb("fbAuswahlUebernehmen").disabled && /2 Arbeiten ausgewählt/.test($fb("fbAuswahlLeiste").innerText), $fb("fbAuswahlLeiste").innerText);
    $fb("fbAuswahlNotiz").click(); await warte(50);
    $fb("fbNotizZuForm").elements.text.value = "Steine abgelesen"; $fb("fbNotizZuForm").requestSubmit(); await warte(500);
    const t3 = fbArbeiten().find(a => a.ID === "T-003"), t1 = fbArbeiten().find(a => a.ID === "T-001");
    pruef("Notiz an beide Arbeiten angehängt", t3.Bemerkung === "Steine abgelesen" && t1.Bemerkung === "Steine abgelesen", JSON.stringify([t3.Bemerkung, t1.Bemerkung]));
    pruef("Notiz ist in der Liste sichtbar", /Steine abgelesen/.test(L().querySelector('[data-id="T-001"]').innerText) && !fbAuswahl);
    // Auswählen → Rechnung: alles Ausgewählte kommt drauf, auch eine eigene Arbeit (wird umgeschrieben)
    $fb("fbAuswahlKnopf").click();
    ["T-003", "T-001"].forEach(fbAuswahlUmschalten);
    $fb("fbAuswahlUebernehmen").click(); await warte(200);
    const empf = document.querySelector('#fbDialog[open] button[data-m="Muster"]');
    pruef("Eigene + fremde Arbeit: fragt nach Empfänger", !!empf);
    if (empf) empf.click(); await warte(200);
    pruef("Rechnung erstellen nimmt alle ausgewählten", fbTab === "rechnung" && fbRe.mandant === "Muster" && [...fbRe.vorauswahl].sort().join() === "T-001,T-003" && fbRePosListe().length >= 2, JSON.stringify([fbTab, fbRe.mandant, [...(fbRe.vorauswahl || [])]]));
    pruef("Rechnungsseite zeigt „Zurück zur Liste“", !$fb("fbReZurueck").hidden);
    fbZeigeTab("liste");
    pruef("Zurück zur Liste: Auswahl bleibt erhalten", fbAuswahl && fbAuswahl.has("T-001") && fbAuswahl.has("T-003"));
    $fb("fbAuswahlKnopf").click();   // Auswahl beenden
    pruef("Auswahl beenden vergisst die gemerkte Auswahl", !fbAuswahl && !fbAuswahlMerken);
    $fb("fbAuswahlKnopf").click();
    $fb("fbAuswahlLeiste").querySelector("[data-auswahl-ende]").click();
    pruef("„✕ Beenden“ in der Auswahl-Leiste beendet die Auswahl", !fbAuswahl && $fb("fbAuswahlLeiste").hidden);
    // Schon abgerechnete Arbeit nochmal abrechnen: auswählbar, deutlich markiert, mit Rückfrage
    $fb("fbAuswahlKnopf").click();
    fbAuswahlUmschalten("L-1");
    const alteNr = fbArbeiten().find(a => a.ID === "L-1").Rechnung;
    pruef("Abgerechnete auswählbar + Warnung in der Leiste", fbAuswahl.has("L-1") && new RegExp("schon abgerechnet \\(" + alteNr).test($fb("fbAuswahlLeiste").innerText), $fb("fbAuswahlLeiste").innerText);
    $fb("fbAuswahlUebernehmen").click(); await warte(300);
    pruef("Rechnungsseite zeigt „schon in Rechnung“", fbTab === "rechnung" && /schon in Rechnung/.test($fb("fbRePositionen").innerText) && fbReAuswahl().some(p => p.id === "L-1"), $fb("fbRePositionen").innerText.slice(0, 200));
    let frage = "";
    const echtConfirm = window.confirm; window.confirm = m => { frage = m; return true; };
    fbRe.positionen["L-1"].preis = "";
    await fbRechnungErstellen();
    pruef("Fehlender Preis: große Meldung + rot markiert", !$fb("fbReMeldung").hidden && /fehlt noch Menge oder Preis/.test($fb("fbReMeldung").innerText) && $fb("fbRePositionen").querySelector('tr[data-id="L-1"] [data-k="preis"].fehlt'));
    fbRe.positionen["L-1"].preis = "50";
    await fbRechnungErstellen(); await warte(300);
    window.confirm = echtConfirm;
    const l1neu = fbArbeiten().find(a => a.ID === "L-1");
    pruef("Rückfrage warnt vor doppelter Abrechnung", /ACHTUNG/.test(frage) && frage.includes(alteNr), frage.slice(0, 200));
    pruef("Nochmal abgerechnet: neue Nummer, alte vermerkt", l1neu.Rechnung && l1neu.Rechnung !== alteNr && String(l1neu["Rechnung vorher"]).includes(alteNr) && /erstellt/.test($fb("fbReMeldung").innerText), JSON.stringify([l1neu.Rechnung, l1neu["Rechnung vorher"], $fb("fbReMeldung").innerText]));
    $fb("reZu").click();
    fbZeigeTab("liste"); fbListeFilter = "alle"; fbRenderListe();
    pruef("Liste zeigt 2× abgerechnet", /\(2×\)/.test(L().querySelector('[data-id="L-1"]').innerText));
    // Rechnung aus Auswahl: oben nur die ausgewählte, die übrigen offenen zugeklappt
    fbZeigeTab("liste"); $fb("fbAuswahlKnopf").click();
    const offeneMuster = fbOffeneFuer("Muster").map(a => a.ID);
    fbAuswahlUmschalten(offeneMuster[0]);
    $fb("fbAuswahlUebernehmen").click(); await warte(300);
    const obenIds = () => [...$fb("fbRePositionen").querySelectorAll(":scope > .table-scroll tr[data-id]")].map(t => t.dataset.id);
    const weitBox = $fb("fbReWeitere");
    pruef("Rechnung: oben nur die ausgewählte Arbeit", obenIds().join() === offeneMuster[0], JSON.stringify(obenIds()));
    pruef("Rechnung: übrige offene zugeklappt mit Anzahl", offeneMuster.length < 2 || (weitBox && !weitBox.open && weitBox.querySelector("summary").innerText.includes("(" + (offeneMuster.length - 1) + ")")), weitBox && weitBox.querySelector("summary").innerText);
    if (weitBox && offeneMuster.length > 1){
      const cb = weitBox.querySelector(`tr[data-id="${offeneMuster[1]}"] input[data-k="an"]`);
      cb.checked = true; cb.dispatchEvent(new Event("input", {bubbles: true})); await warte(100);
      pruef("Aufgeklappt anhaken holt die Arbeit nach oben", obenIds().includes(offeneMuster[1]) && fbReAuswahl().length === 2, JSON.stringify(obenIds()));
    }
    fbZeigeTab("liste");
    // zwei Änderungen direkt hintereinander: beide müssen ankommen
    const p1 = fbAendern({typ: "aendern", id: "T-001", felder: {"Ort / Schlag": "Testacker Nord"}});
    const p2 = fbAendern({typ: "aendern", id: "T-003", felder: {"Ort / Schlag": "Bachwiese"}});
    const [u1, u2] = await Promise.all([p1, p2]);
    pruef("Zwei schnelle Änderungen: beide sofort übertragen", u1 && u2 && !fbOps.length, JSON.stringify([u1, u2, fbOps.length]));
  });
  await schritt("Einstellungen", async () => {
    const M = "http://127.0.0.1:8779/";
    navigiere("einstellungen"); await warte(200);
    pruef("Einstellungen-Seite öffnet", !document.getElementById("viewEinstellungen").hidden && /Einstellungen/.test(document.title));
    pruef("Einstellungen zeigt angemeldet", /Angemeldet/.test(document.getElementById("einstZugang").innerText) && !$fb("fbPwAendernForm").closest(".einst-karte").hidden);
    pruef("Kuhliste hat kein „Gerät trennen“ mehr", !/trennen/i.test(document.getElementById("hofSpeicher").innerText));
    // Server hakt kurz: angemeldet bleiben, von selbst nochmal versuchen
    await fetch(M + "?stoerung=1");
    await fbSync();
    pruef("Server-Störung meldet nicht ab", hsZugang && fbStatus.zustand === "fehler" && /automatisch/.test($fb("fbVerbindung").innerText), fbStatus.text);
    for (let i = 0; i < 125 && fbStatus.zustand !== "ok"; i++) await warte(200);
    pruef("Nach Störung von selbst wieder verbunden", hsZugang && fbStatus.zustand === "ok", fbStatus.text);
    // Abmelden nur über Einstellungen
    document.getElementById("einstAbmelden").click(); await warte(100);
    pruef("Abmelden entfernt Zugang und Feldbuch-Kopie", !hsZugang && !fbGeladen && !localStorage.getItem("poolehof-hofspeicher-v1") && !document.getElementById("navPunktEinst").hidden);
    // Störung beim Anmelden darf nicht "Passwort falsch" sagen
    await fetch(M + "?stoerung=1");
    let fehler = ""; try { await hsAnmelden("test-4711"); } catch(e) { fehler = e.message; }
    pruef("Störung beim Anmelden ≠ „Passwort falsch“", !hsZugang && fehler && !/falsch/i.test(fehler), fehler);
    fehler = ""; try { await hsAnmelden("falsch-123"); } catch(e) { fehler = e.message; }
    pruef("Falsches Passwort wird erkannt", !hsZugang && /falsch/i.test(fehler), fehler);
    renderEinstellungen();
    document.getElementById("einstPasswort").value = "test-4711";
    document.getElementById("einstForm").requestSubmit();
    for (let i = 0; i < 60 && !(hsZugang && fbStatus.zustand === "ok" && fbArbeiten().length); i++) await warte(200);
    pruef("Anmelden in Einstellungen lädt Feldbuch wieder", hsZugang && fbStatus.zustand === "ok" && fbArbeiten().length >= 4, fbStatus.text);
    // "Als App installieren" (Chrome/Android bieten das per beforeinstallprompt an)
    navigiere("einstellungen");
    pruef("Installieren: Anleitung sichtbar", /App installieren|Startbildschirm|Home-Bildschirm/.test(document.getElementById("einstInstall").innerText));
    let gefragt = false;
    const ev = new Event("beforeinstallprompt"); ev.prompt = async () => { gefragt = true; }; ev.userChoice = Promise.resolve({outcome: "accepted"});
    window.dispatchEvent(ev); await warte(50);
    const ik = document.getElementById("einstInstallKnopf");
    pruef("Installieren: Knopf erscheint, wenn der Browser es anbietet", !!ik);
    if (ik){ ik.click(); await warte(100); }
    pruef("Installieren: Knopf fragt den Browser, danach „Installiert“", gefragt && /Installiert/.test(document.getElementById("einstInstall").innerText));
    renderEinstellungen();
    pruef("Installiert bleibt nach Neuzeichnen", /Installiert/.test(document.getElementById("einstInstall").innerText));
    navigiere("feld");
  });
  await schritt("Lely-Import", async () => {
    // nur erfundene Test-Ohrmarken
    const zeilen = [["Kuhnummer", "Halsband", "Lebensnummer", "Laktation", "Tage"], ["12", "305", "DE 08 123 45678", "2", "61"], ["13", "306", "DE0812345679", "3", "75"], ["14", "307", "DE 0812345680", "1", "58"]];
    const anzahl = () => (document.getElementById("erkanntInfo").textContent.match(/(\d+) Ohrmarke/) || [])[1];
    pruef("Lely: Einfügefeld entfernt, Datei-Feld da", !document.getElementById("lelyInput") && document.getElementById("lelyFile"));
    await lelyDatei(new File([zeilen.map(r => r.join(";")).join("\r\n")], "Offene Kühe.csv", {type: "text/csv"}));
    pruef("Lely CSV: 3 Ohrmarken", anzahl() === "3", document.getElementById("erkanntInfo").textContent);
    pruef("Lely CSV: Kuhnummer je Kuh", lely.tiere.map(t => t.nr).join() === "12,13,14", JSON.stringify(lely.tiere));
    await lelyDatei(new File([`<?xml version="1.0"?><Liste>${zeilen.slice(1).map(r => `<Kuh Nummer="${r[0]}"><Lebensnummer>${r[2]}</Lebensnummer></Kuh>`).join("")}</Liste>`], "Offene Kühe.xml", {type: "text/xml"}));
    pruef("Lely XML: 3 Ohrmarken", anzahl() === "3", document.getElementById("erkanntInfo").textContent);
    pruef("Lely XML: Kuhnummer je Kuh", lely.tiere.map(t => t.nr).join() === "12,13,14", JSON.stringify(lely.tiere));
    const XLSX = await ladeSheetJS();
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zeilen), "Offene Kühe");
    await lelyDatei(new File([XLSX.write(wb, {type: "array", bookType: "xlsx"})], "Offene Kühe.xlsx"));
    pruef("Lely Excel: 3 Ohrmarken", anzahl() === "3", document.getElementById("erkanntInfo").textContent);
    await fbSkriptLaden("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", () => window.jspdf);
    const pdf = new jspdf.jsPDF(); zeilen.forEach((r, i) => pdf.text(r.join("   "), 10, 20 + i * 8));
    await lelyDatei(new File([pdf.output("arraybuffer")], "Offene Kühe.pdf", {type: "application/pdf"}));
    pruef("Lely PDF: 3 Ohrmarken", anzahl() === "3", document.getElementById("erkanntInfo").textContent);
    await lelyDatei(new File(["Kuhnummer;Name\n12;Berta"], "falsch.csv"));
    pruef("Lely ohne Ohrmarken: klare Meldung", /keine Ohrmarken/.test(document.getElementById("erkanntInfo").textContent));
    // Netrind-Liste als Datei (erfundene Tiere), dann Lely-Datei → Empfehlung Holstein/British Blue
    pruef("Netrind: Einfügefeld entfernt", !document.getElementById("herdePaste"));
    const netrind = ["Ohrmarke;Name;RZG;M-kg;RZS;stl;RZD;RZR;stä",
      ...Array.from({length: 20}, (_, i) => `DE 08 123 456${String(70 + i).padStart(2, "0")};Kuh${i};${100 + i * 2};${200 + i * 40};${95 + i};${100 + (i % 5)};${98 + (i % 7)};${97 + (i % 4)};${96 + (i % 6)}`)].join("\r\n");
    await uebernehmeDatei(new File([netrind], "Zuchtwerte wbl.csv", {type: "text/csv"}));
    pruef("Netrind-Datei übernommen (20 Tiere)", herde && herdenTiere().length === 20, herde && herdenTiere().length);
    pruef("Kriterien: kein RZG mehr, Stärke erkannt", !KUH_KRITERIEN.some(k => k.id === "rzg") && herde.mapping.sta >= 0 && herde.header[herde.mapping.sta] === "stä", JSON.stringify(herde.mapping));
    await lelyDatei(new File([zeilen.map(r => r.join(";")).join("\r\n")], "Offene Kühe.csv"));
    const empf = [...document.querySelectorAll("#bsBody tr")].map(tr => tr.innerText);
    pruef("Auswertung: 3 Kühe mit Empfehlung", empf.length === 3 && empf.every(t => /Holstein|British Blue|Grenzfall/.test(t)), JSON.stringify(empf).slice(0, 300));
    pruef("Ergebnis zeigt Kuh-Nr. statt Name", /Kuh-Nr/.test(document.getElementById("bsKopf").innerText) && !/Name/.test(document.getElementById("bsKopf").innerText) && empf.some(t => /\b12\b/.test(t)), document.getElementById("bsKopf").innerText);
    // Gewichtung bleibt gespeichert – im Browser und im Hof-Speicher
    const feld = document.querySelector('#gewichtListe [data-gewicht="sta"]');
    feld.value = "25"; feld.dispatchEvent(new Event("input", {bubbles: true}));
    const q = document.getElementById("quoteInput"); q.value = "30"; q.dispatchEvent(new Event("change"));
    pruef("Gewicht + Holstein-Anteil im Browser gespeichert", ladeBsSettings().gewichte.sta === 25 && ladeBsSettings().quote === 30);
    await warte(1800);   // Sicherung im Hof-Speicher läuft kurz verzögert
    const fern = await hsAnfrage({aktion: "laden", schluessel: hsZugang.auth});
    const fernKlar = await hsEntschluesseln(fern.daten);
    pruef("Gewichtung verschlüsselt im Hof-Speicher (für alle Geräte)", fernKlar.einstellungen && fernKlar.einstellungen.gewichte.sta === 25 && fernKlar.einstellungen.quote === 30, JSON.stringify(fernKlar.einstellungen));
    // anderes Gerät: kennt die Einstellungen nicht, holt sie aus dem Hof-Speicher
    localStorage.removeItem(BS_SETTINGS_KEY); bsSettings = ladeBsSettings();
    pruef("Ohne eigene Einstellungen: Standard ohne RZG", bsSettings.gewichte.sta === 10 && !("rzg" in bsSettings.gewichte));
    herde.hochgeladen = new Date(Date.now() - 60000).toISOString(); herde.einstellungen = {stand: new Date(0).toISOString()}; speichereHerde();
    await hsAbgleichen();
    pruef("Anderes Gerät übernimmt Gewichtung aus dem Hof-Speicher", bsSettings.gewichte.sta === 25 && bsSettings.quote === 30 && document.querySelector('#gewichtListe [data-gewicht="sta"]').value === "25", JSON.stringify(bsSettings));
    // neue Netrind-Liste hochladen: Einstellungen bleiben
    await uebernehmeDatei(new File([netrind], "Zuchtwerte wbl neu.csv", {type: "text/csv"}));
    pruef("Neue Netrind-Liste: Gewichtung bleibt", bsSettings.gewichte.sta === 25 && herde.einstellungen.gewichte.sta === 25);
    // alte Einstellungen mit RZG werden auf die neuen Kriterien umgestellt
    pruef("Alte Einstellungen mit RZG → neue Standardwerte", (() => { const b = bsSettingsBereinigen({quote: 20, gewichte: {rzg: 20, milch: 40}}); return !("rzg" in b.gewichte) && b.gewichte.sta === 10 && b.quote === 20; })());
    // Lely-Screenshot (erfundene Kühe) per Texterkennung lesen
    const soll = await (await fetch("http://127.0.0.1:8778/lely_tabelle_soll.json")).json();
    const png = await (await fetch("http://127.0.0.1:8778/lely_screenshot.png")).blob();
    // Gedächtnis: für eine Kuh ist schon eine ANDERE Kuhnummer bekannt → muss auffallen
    herde.kuhnummern = {"0812345678": "12"};
    const t0 = Date.now();
    await lelyDatei(new File([png], "image.png", {type: "image/png"}));
    const ist = new Map(lely.tiere.map(t => [t.key, t.nr]));
    const falsch = soll.filter(z => ist.get(z.ohr.replace(/\D/g, "")) !== z.nr).map(z => `${z.ohr}/${z.nr}→${ist.get(z.ohr.replace(/\D/g, ""))}`);
    pruef("Screenshot: alle 22 Ohrmarken + Kuhnummern richtig gelesen", lely.ocr && lely.tiere.length === 22 && !falsch.length, `${lely.tiere.length} gelesen, falsch: ${falsch.join(" ")} (${Math.round((Date.now() - t0) / 1000)} s)`);
    pruef("Screenshot: „Gesamt: 22 Datensätze“ erkannt und bestätigt", lely.gesamt === 22 && /Lely zeigt 22 Datensätze ✓/.test(document.getElementById("erkanntInfo").innerText), document.getElementById("erkanntInfo").innerText);
    const nf = [...document.querySelectorAll("#bsBody tr.nf")];
    pruef("Screenshot: 2 erfundene Ohrmarken als „nicht in Liste“ markiert", nf.length === 2 && nf.every(tr => /falsch gelesen/.test(tr.innerText)), nf.map(tr => tr.innerText).join(" | "));
    const konflikt = lely.tiere.find(t => t.key === "0812345678");
    pruef("Gedächtnis: neue Kuhnummer (z. B. neues Halsband) wird übernommen, nur Hinweis", konflikt && konflikt.sicher && konflikt.nr === "189" && /geändert \(bisher 12\)/.test(konflikt.hinweis), JSON.stringify(konflikt));
    pruef("Screenshot: alle Kuhnummern sicher (keine orange)", lely.tiere.every(t => t.sicher), JSON.stringify(lely.tiere.filter(t => !t.sicher)));
    pruef("Sicher gelesene Paare werden gemerkt (auch die geänderte)", herde.kuhnummern["0812345670"] === "167" && herde.kuhnummern["0812345678"] === "189", JSON.stringify(herde.kuhnummern).slice(0, 200));
    // nicht lesbare Zeile: Bildausschnitt + von Hand nachtragen
    lely.unlesbar = [{y: 1, bild: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="}]; werteAus();
    const ub = document.querySelector("#lelyUnlesbar .bs-unlesbar");
    pruef("Unlesbare Zeile wird mit Bild angezeigt", ub && ub.querySelector("img") && !document.getElementById("lelyUnlesbar").hidden);
    ub.querySelector('[data-k="nr"]').value = "999"; ub.querySelector('[data-k="ohr"]').value = "DE 08 123 45670";
    ub.querySelector("[data-ok]").click();
    pruef("Von Hand nachgetragen übernommen", document.getElementById("lelyUnlesbar").hidden && lely.tiere.some(t => t.key === "0812345670"), JSON.stringify(lely.tiere.find(t => t.key === "0812345670")));
    await lelyDatei(new File([png], "image.png", {type: "image/png"}));
    await Promise.all([lelyDatei(new File([png], "a.png", {type: "image/png"})), lelyDatei(new File([png], "b.png", {type: "image/png"}))]);
    pruef("Zwei Screenshots gleichzeitig: sauber nacheinander gelesen", lely.tiere.length === 22 && lely.tiere.filter(t => t.key !== "0812345678").every(t => t.sicher), JSON.stringify(lely.tiere.filter(t => !t.sicher)).slice(0, 200));
    lely = {tiere: [], quellen: [], ocr: false, gesamt: null, unlesbar: []};
    await lelyDatei(new File([png], "image.png", {type: "image/png"}));
    await lelyDatei(new File([png], "image.png", {type: "image/png"}));
    pruef("Zweiter Screenshot ergänzt ohne Doppelte", lely.quellen.length === 2 && lely.tiere.length === 22 && /2 Bilder/.test(document.getElementById("erkanntInfo").innerText));
    document.getElementById("lelyLeeren").click();
    pruef("Lely-Liste leeren", document.getElementById("erkanntInfo").textContent === "" && document.getElementById("bsResult").hidden);
  });
  await schritt("MwSt, Nummern, Zurück", async () => {
    const jahr = new Date().getFullYear();
    // Standardpreis mit 7 % für Säen
    await fbAendern({typ: "standardpreise", liste: [{"Tätigkeit": "Säen", Einheit: "ha", "Preis (€)": 60, "MwSt (%)": 7}, {"Tätigkeit": "Mähen", Einheit: "h", "Preis (€)": 70, "MwSt (%)": 19}]});
    pruef("MwSt-Vorschlag aus den Standardpreisen", fbMwstVorschlag("Säen", "ha", "Muster") === 7 && fbMwstVorschlag("Mähen", "h", "Muster") === 19 && fbMwstVorschlag("Unbekannt", "h", "Muster") === 19);
    pruef("Kein MwSt-Feld mehr oben, Spalte je Position", !$fb("fbReMwst"));
    await fbAendern({typ: "neu", eintrag: {ID: "M-1", Datum: fbHeuteIso(), Mandant: "Muster", "Tätigkeit": "Säen", Kultur: "Mais", Menge: "10", Einheit: "ha", Stunden: "", Rechnung: "", "Prüfen": ""}});
    await fbAendern({typ: "neu", eintrag: {ID: "M-2", Datum: fbHeuteIso(), Mandant: "Muster", "Tätigkeit": "Mähen", Kultur: "Grünland", Menge: "", Einheit: "", Stunden: "3", Rechnung: "", "Prüfen": ""}});
    fbRe = {mandant: "Muster", positionen: {}, vorauswahl: new Set(["M-1", "M-2"])};
    fbZeigeTab("rechnung"); await warte(100);
    const mw = id => $fb("fbRePositionen").querySelector(`tr[data-id="${id}"] [data-k="mwst"]`);
    pruef("Positionen bekommen die MwSt aus den Standardpreisen", mw("M-1") && mw("M-1").value === "7" && mw("M-2").value === "19", [mw("M-1") && mw("M-1").value, mw("M-2") && mw("M-2").value].join());
    fbRe.positionen["M-1"].preis = "60"; fbRe.positionen["M-2"].preis = "70"; fbRenderRePositionen();
    pruef("Summe zeigt MwSt je Satz", /MwSt 7 % auf 600,00/.test($fb("fbReSumme").innerText) && /MwSt 19 % auf 210,00/.test($fb("fbReSumme").innerText) && /Gesamt: 891,90/.test($fb("fbReSumme").innerText.replace(/\s/g, " ")), $fb("fbReSumme").innerText);
    const echtConfirm = window.confirm; window.confirm = () => true;
    // Rechnungsnummer nie doppelt: in den Stammdaten eine kleinere "letzte Nummer" eintragen
    const testhof = fbDaten.firmen.find(f => f.Firma === "Testhof");
    const vorher = fbDaten.rechnungen.filter(r => r.Firma === "Testhof").map(r => r["Rechnungs-Nr."]);
    await fbAendern({typ: "firma", alt: "Testhof", felder: {...testhof, "Letzte Rechnungs-Nr.": jahr + "-001"}});
    $fb("fbReFirma").value = "Testhof"; $fb("fbReDatum").value = fbHeuteIso();
    await fbRechnungErstellen(); await warte(300);
    window.confirm = echtConfirm;
    const re = fbDaten.rechnungen[fbDaten.rechnungen.length - 1];
    const alleNr = fbDaten.rechnungen.filter(r => r.Firma === "Testhof").map(r => r["Rechnungs-Nr."]);
    pruef("Rechnungsnummer nie doppelt (trotz kleinerer „letzter Nr.“)", re && !vorher.includes(re["Rechnungs-Nr."]) && new Set(alleNr).size === alleNr.length, JSON.stringify([re && re["Rechnungs-Nr."], vorher]));
    pruef("Rechnung speichert MwSt je Satz", re && re["MwSt je Satz"].length === 2 && re.MwSt === 81.9 && re.Brutto === 891.9 && re.Positionen.find(p => p.id === "M-1").mwst === 7, JSON.stringify(re && [re["MwSt je Satz"], re.MwSt, re.Brutto]));
    pruef("Rechnungsansicht zeigt beide MwSt-Sätze", /MwSt 7 % auf/.test($fb("rechnungDruck").innerText) && /MwSt 19 % auf/.test($fb("rechnungDruck").innerText));
    pruef("Preise merken den MwSt-Satz", fbDaten.preise.some(p => p["Tätigkeit"] === "Säen" && p["MwSt (%)"] === 7));
    // Zurück: Rechnungsansicht schließt mit "Zurück", Seite bleibt
    const tiefeVor = verlaufTiefe();
    history.back(); await warte(400);
    pruef("Zurück schließt zuerst die Rechnungsansicht", $fb("rechnungDruck").hidden && fbTab === "rechnung", JSON.stringify([$fb("rechnungDruck").hidden, fbTab, tiefeVor, verlaufTiefe()]));
    // Zurück: Liste → Auswahl → Rechnung → Zurück → Liste mit Auswahl
    geheZu("feld-liste"); await warte(50);
    if (fbAuswahl) $fb("fbAuswahlKnopf").click();
    $fb("fbAuswahlKnopf").click();
    const offen = fbOffeneFuer("Muster").map(a => a.ID).slice(0, 1);
    offen.forEach(fbAuswahlUmschalten);
    $fb("fbAuswahlUebernehmen").click(); await warte(300);
    pruef("Zurück-Knopf oben sichtbar", fbTab === "rechnung" && !document.getElementById("appZurueckLeiste").hidden, JSON.stringify([fbTab, verlaufTiefe()]));
    document.getElementById("appZurueck").click(); await warte(400);
    pruef("„← Zurück“ führt von der Rechnung zur Liste, Auswahl bleibt", fbTab === "liste" && location.hash === "#feld-liste" && fbAuswahl && offen.every(id => fbAuswahl.has(id)), JSON.stringify([fbTab, location.hash, fbAuswahl && [...fbAuswahl]]));
    $fb("fbAuswahlKnopf").click();
    // Zurück zwischen Ansichten: Feldbuch → Start → Zurück → Feldbuch
    document.querySelector('.appnav-item[data-view="start"]').click(); await warte(200);
    pruef("Menü-Link öffnet Start", !document.getElementById("viewStart").hidden);
    history.back(); await warte(400);
    pruef("Zurück-Taste führt wieder ins Feldbuch (Liste)", !document.getElementById("viewFeld").hidden && fbTab === "liste", location.hash);
  });
  await schritt("E-Rechnung", async () => {
    const echtSichern = fbSichern; let gesichert = null;
    fbSichern = async (name, inhalt, typ) => { gesichert = {name, inhalt: String(inhalt), typ}; return "heruntergeladen"; };
    try {
      // Firma ohne E-Mail/Telefon → klare Liste, was fehlt
      const alt = fbDaten.rechnungen.find(r => r.Firma === "Testhof" && r.Status !== "storniert");
      fbGespeicherteRechnungZeigen(alt["Rechnungs-Nr."], "Testhof"); await warte(200);
      pruef("Knöpfe PDF + E-Rechnung oben und am Ende", document.querySelectorAll("#rechnungDruck [data-re-pdf]").length === 2 && document.querySelectorAll("#rechnungDruck [data-re-xml]").length === 2);
      document.querySelector("#rechnungDruck .re-unten [data-re-xml]").click(); await warte(100);
      pruef("Fehlende Angaben werden genannt statt ungültiger Datei", !gesichert && /fehlt noch/.test($fb("reXmlHinweis").innerText) && /E-Mail/.test($fb("reXmlHinweis").innerText), $fb("reXmlHinweis").innerText);
      $fb("reZu").click(); await warte(300);
      const altNr = alt["Rechnungs-Nr."];
      // Angaben ergänzen, neue Rechnung, E-Rechnung herunterladen
      const th = fbDaten.firmen.find(f => f.Firma === "Testhof");
      await fbAendern({typ: "firma", alt: "Testhof", felder: {...th, "PLZ Ort": "12345 Testdorf", IBAN: "DE02120300000000202051", Telefon: "+49 7000 1", "E-Mail": "hof@example.com", Steuernummer: "00000/00000", "Hinweis auf Rechnung": "Testhinweis"}});
      const mu = fbDaten.mandanten.find(m => m.Kurzname === "Muster");
      await fbAendern({typ: "mandant", mandant: {...mu, "E-Mail": "muster@example.com"}});
      await fbAendern({typ: "neu", eintrag: {ID: "X-1", Datum: fbHeuteIso(), Mandant: "Muster", "Tätigkeit": "Säen", Kultur: "Mais", Menge: "2", Einheit: "ha", Stunden: "", Rechnung: "", "Prüfen": ""}});
      const r = await fbSofort({typ: "rechnung", firma: "Testhof", mandant: "Muster", datum: fbHeuteIso(), positionen: [{id: "X-1", datum: fbHeuteIso(), text: "Säen Mais", menge: 2, einheit: "ha", preis: 60, mwst: 7}]});
      fbRechnungZeigen(r); await warte(200);
      pruef("Hinweis der Firma steht auf der Rechnung", /Testhinweis/.test($fb("rechnungDruck").innerText));
      document.querySelector("#rechnungDruck [data-re-xml]").click(); await warte(100);
      pruef("E-Rechnung (XRechnung) wird erzeugt", gesichert && /\(E-Rechnung\)\.xml$/.test(gesichert.name) && gesichert.inhalt.includes("urn:xeinkauf.de:kosit:xrechnung_3.0") && gesichert.inhalt.includes(`<ram:ID>${r.nr}</ram:ID>`) && gesichert.inhalt.includes('unitCode="H18"'), gesichert && gesichert.name);
      $fb("reZu").click(); await warte(300);
      // spätere Adressänderung ändert eine erstellte Rechnung nicht
      await fbAendern({typ: "mandant", mandant: {...fbDaten.mandanten.find(m => m.Kurzname === "Muster"), "Straße": "Neue Straße 99"}});
      gesichert = null;
      fbGespeicherteRechnungZeigen(r.nr, "Testhof"); await warte(200);
      document.querySelector("#rechnungDruck [data-re-xml]").click(); await warte(100);
      // ältere Rechnung (damals ohne E-Mail): nach dem Ergänzen in den Stammdaten geht die E-Rechnung
      gesichert = null;
      fbGespeicherteRechnungZeigen(altNr, "Testhof"); await warte(200);
      document.querySelector("#rechnungDruck [data-re-xml]").click(); await warte(100);
      pruef("Alte Rechnung: nachgetragene E-Mail/Telefon werden ergänzt", gesichert && gesichert.inhalt.includes("muster@example.com") && gesichert.inhalt.includes("hof@example.com"), $fb("reXmlHinweis").innerText);
      $fb("reZu").click(); await warte(300);
      gesichert = null;
      fbGespeicherteRechnungZeigen(r.nr, "Testhof"); await warte(200);
      document.querySelector("#rechnungDruck [data-re-xml]").click(); await warte(100);
      pruef("Rechnung bleibt wie erstellt (alte Adresse)", gesichert && gesichert.inhalt.includes("Musterweg 1") && !gesichert.inhalt.includes("Neue Straße 99") && /Musterweg 1/.test($fb("rechnungDruck").innerText), gesichert && gesichert.inhalt.slice(0, 50));
      $fb("reZu").click(); await warte(300);
    } finally { fbSichern = echtSichern; }
  });
  await schritt("Passwort", async () => {
    await fbPasswortAendern("Test-Traktor-Wiese-17");
    pruef("Passwort ändern", hsZugang.verfahren === "v2" && fbStatus.zustand === "ok");
    const alt = await hsAnfrage({aktion: "laden", fach: "feldbuch", schluessel: (await hsZugangAusPasswort("test-4711", "v1")).auth});
    pruef("Altes Passwort gesperrt", !alt.ok);
  });
  return erg;
})()

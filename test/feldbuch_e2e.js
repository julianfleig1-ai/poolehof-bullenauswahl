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
  await schritt("Passwort", async () => {
    await fbPasswortAendern("Test-Traktor-Wiese-17");
    pruef("Passwort ändern", hsZugang.verfahren === "v2" && fbStatus.zustand === "ok");
    const alt = await hsAnfrage({aktion: "laden", fach: "feldbuch", schluessel: (await hsZugangAusPasswort("test-4711", "v1")).auth});
    pruef("Altes Passwort gesperrt", !alt.ok);
  });
  return erg;
})()

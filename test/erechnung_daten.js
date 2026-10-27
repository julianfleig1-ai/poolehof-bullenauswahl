// Erzeugt erfundene Rechnungen über die App (lokale Attrappe) und gibt die E-Rechnungen (XML) zurück
(async () => {
  const warte = ms => new Promise(r => setTimeout(r, ms));
  localStorage.clear();
  await hsAnmelden("test-4711");
  for (let i = 0; i < 40 && fbStatus.zustand !== "ok"; i++) await warte(200);
  await fbSofort({typ: "import", daten: fbLeer()});
  const firma = {Firma: "Testhof Muster GbR", Inhaber: "Max Mustermann", "Straße": "Hofweg 2", "PLZ Ort": "12345 Testdorf", Steuernummer: "12345/67890", "USt-IdNr.": "",
                 Bank: "Testbank", IBAN: "DE02120300000000202051", BIC: "BYLADEM1001", Telefon: "+49 7000 12345", "E-Mail": "hof@example.com", "Hinweis auf Rechnung": "", "Grund Steuerbefreiung": "Steuerfreie Leistung (Testgrund)", "Letzte Rechnungs-Nr.": ""};
  await fbAendern({typ: "firma", felder: firma});
  await fbAendern({typ: "firma", felder: {...firma, Firma: "Pauschal Hof", "USt-IdNr.": "DE123456789", "Hinweis auf Rechnung": "Durchschnittssatz für land- und forstwirtschaftliche Betriebe nach § 24 UStG"}});
  await fbAendern({typ: "mandant", mandant: {Kurzname: "Nagel", Name: "Klaus Nagel & Söhne <Test>", "Andere Namen": "", "Straße": "Weg 1", "PLZ Ort": "11111 Ort", "E-Mail": "nagel@example.com", Notiz: ""}});
  const neu = (ID, Datum, T, Kultur, Menge, Einheit) => fbAendern({typ: "neu", eintrag: {ID, Datum, Mandant: "Nagel", "Tätigkeit": T, Kultur, Menge, Einheit, Stunden: "", Rechnung: "", "Prüfen": ""}});
  await neu("E1", "2026-05-02", "Säen", "Mais", "10", "ha"); await neu("E2", "2026-05-09", "Düngen", "Mais", "10", "ha");
  await neu("E3", "2026-06-01", "Mähen", "Grünland", "3,5", "h"); await neu("E4", "2026-06-01", "Gülle fahren", "", "60", "m³");
  await neu("E5", "2026-07-01", "Pressen", "Stroh", "44", "Ballen"); await neu("E6", "2026-07-02", "Beratung", "", "1", "pauschal");
  const xmls = [];
  const re = async (firmaName, positionen, name) => {
    const r = await fbSofort({typ: "rechnung", firma: firmaName, mandant: "Nagel", datum: "2026-10-26", positionen});
    xmls.push({name, fehlt: fbERechnungFehlt(r.firma, r.mandant, r.positionen), xml: fbXRechnungXml(r), brutto: r.brutto});
  };
  await re("Testhof Muster GbR", [{id: "E1", datum: "2026-05-02", text: "Säen Mais", menge: 10, einheit: "ha", preis: 60, mwst: 7},
                                  {id: "E2", datum: "2026-05-09", text: "Düngen Mais (KAS 2 dt/ha)", menge: 10, einheit: "ha", preis: 25.5, mwst: 19}], "1-gemischt-7-19");
  await re("Pauschal Hof", [{id: "E3", datum: "2026-06-01", text: "Mähen Grünland", menge: 3.5, einheit: "h", preis: 70, mwst: 7.8},
                            {id: "E4", datum: "2026-06-01", text: "Gülle fahren", menge: 60, einheit: "m³", preis: 2.15, mwst: 7.8}], "2-pauschal-7,8");
  await re("Testhof Muster GbR", [{id: "E5", datum: "2026-07-01", text: "Pressen Stroh <Rundballen> & Netz", menge: 44, einheit: "Ballen", preis: 6.333, mwst: 19},
                                  {id: "E6", datum: "2026-07-02", text: "Beratung", menge: 1, einheit: "pauschal", preis: 50, mwst: 0}], "3-mit-0-prozent");
  // Storno der ersten Rechnung → Stornorechnung (Belegart 381) mit Verweis auf die Originalrechnung
  const st = await fbSofort({typ: "storno", nr: "2026-001", firma: "Testhof Muster GbR", datum: "2026-10-27"});
  const beleg = fbBelegAusSpeicher(fbDaten.rechnungen.find(x => x["Rechnungs-Nr."] === st.nr && x.Firma === st.firma));
  xmls.push({name: "4-stornorechnung", fehlt: fbERechnungFehlt(beleg.firma, beleg.mandant, beleg.positionen), xml: fbXRechnungXml(beleg), brutto: -beleg.brutto});
  return xmls;
})()

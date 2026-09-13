#!/usr/bin/env python3
"""
RBW (Rinderunion Baden-Württemberg) – Start-Datensatz.

RBW liefert die Bullenlisten NICHT als einfaches HTML (kein curl möglich),
sondern lädt sie per JS über eine interne JSON-API nach:
  POST https://www.rind-bw.de/api/EasyCMS@Page@Content@EasyBull@EasyBullRetriever/getBulls/0/0

Diese API ist zusätzlich mit "AltCha" (proof-of-work Anti-Bot, kein Login,
keine Captcha-Interaktion nötig) abgesichert. Für einen echten Automatik-
Scraper braucht es daher einen headless Browser (Playwright), der die
Seite normal lädt und die Netzwerk-Antworten mitliest – ein reines
requests/curl-Skript reicht hier NICHT.

Die API liefert deutlich mehr Merkmale als in der sichtbaren Tabelle
angezeigt werden, u.a. genau die Merkmale aus Julians Kriterienliste:

  spe_ho_rzg        -> RZG (Gesamtzuchtwert)
  spe_ho_rzeuro     -> RZ€
  spe_ho_rzm        -> RZM (Milchwert)
  spe_ho_mw_mm      -> Milchmenge (kg)
  spe_ho_mw_fp/_ep  -> Fett-%/Eiweiß-%
  spe_ho_fit_rzs    -> RZS (Zellzahl)      <- "Zellzahl RZS < 100"
  spe_ho_fit_rzn    -> RZN (Nutzungsdauer)
  spe_ho_fit_mk     -> RZD (Melkbarkeit)   <- "Melkbarkeit > 100"
  spe_ho_fit_fk_m   -> RZR (Töchterfruchtbarkeit) <- "RZR > 100"
  spe_ho_fit_rze    -> RZE (Exterieur)
  spe_ho_fit_rzk_p  -> RZKd (Kalbeverlauf)
  spe_ho_fit_rzrobot-> RZRobot
  spe_ho_fit_ges    -> RZGesund
  spe_ho_exzw_eut   -> Euter gesamt (Strichlänge/Stärke als Einzelmerkmale
                        stecken hier NICHT drin -> nur auf der Bulldetail-
                        seite/im PDF verfügbar, folgt in einem späteren Ausbau)

Dieses Skript enthält:
  1) Die vollständigen RZG/RZ€/RZM-Listen aus "Bullenempfehlung" und
     "erweiterte Spermaliste" (Holstein SB+RB, Stand 11.08.2026),
     abgelesen von https://rind-bw.de – 118 Bullen.
  2) Für 6 Bullen (aus der Bullenempfehlung, per API-Mitschnitt) die
     vollen Zusatzmerkmale, als Beleg dass die reicheren Felder existieren.

TODO nächster Ausbau: Playwright-Skript, das die getBulls-API für alle
Seiten/Rassen automatisch durchpaginiert (Body-Parameter noch zu klären)
und daraus die volle Merkmalstiefe für ALLE Bullen zieht statt nur RZG/RZ€/RZM.
"""
import json
import re
import sys
from datetime import date

STAND = "2026-08-11"
QUELLE = "https://rind-bw.de/bullen/holsteins/bullenempfehlung-12.html"

# (Name, RZG, RZ€, RZM)
SB_EMPFEHLUNG = [
    ("SOTU P", 155, 2588, 142), ("MONAMI", 153, 2699, 133), ("CALLBOX", 151, 2527, 142),
    ("SLIM RDC", 151, 2480, 142), ("CHANELLO", 151, 2557, 140), ("RETURN", 150, 2468, 139),
    ("ROCKABILLY", 150, 2466, 138), ("CONNOR", 149, 2661, 139), ("NEXTLEVEL", 149, 2212, 134),
    ("MAJOR TOM", 148, 2452, 139), ("ENFORCER P", 146, 2126, 127), ("MIDLAND", 145, 2136, 134),
    ("RHAPSODY", 145, 2114, 133), ("RAVELLO P", 145, 2234, 130), ("SUPA P RDC", 144, 2060, 129),
    ("RAX PP RDC", 143, 2171, 138), ("MYLINE", 142, 2022, 128), ("COROS PP RDC", 140, 2123, 132),
    ("TEMPTATION", 139, 2029, 136), ("SUBITO PP", 138, 1754, 131), ("MELVILLE", 135, 1600, 127),
    ("BRANDY PP", 130, 1138, 115), ("CANITZ", 128, 1338, 122), ("GARFIELD EX92", 127, 1285, 120),
]
RB_EMPFEHLUNG = [
    ("HARMONIC P", 161, 2963, 146), ("SHERIDAN", 153, 2839, 146), ("HANDSOME P", 150, 2281, 134),
    ("FASTRUN P", 149, 2214, 129), ("MEX RED PP", 142, 1962, 127), ("KEEGAN PP*", 137, 1745, 133),
]
SB_ERWEITERT = [
    ("AGENT", 160, 2908, 144), ("ALASKA", 152, 2260, 134), ("CONTADOR", 151, 2467, 134),
    ("CAPIO", 150, 2472, 135), ("COSMOS", 150, 2441, 124), ("AMARANT", 149, 2248, 132),
    ("MINDSET", 148, 2579, 140), ("SETLUR RDC", 148, 2428, 133), ("PATCHWORK", 148, 2069, 129),
    ("SMARTIE P", 147, 2261, 136), ("VIVALDI", 146, 2524, 145), ("CROCODILE", 146, 2292, 132),
    ("CAMIRO", 146, 2154, 125), ("SAVERIO", 145, 2363, 138), ("CATALDO", 143, 2232, 139),
    ("NOVALIS", 143, 1945, 132), ("GLENDON", 142, 2258, 134), ("COJACK", 142, 2003, 125),
    ("CASPIAN PP", 142, 2105, 122), ("PUGETBAY", 141, 2155, 132), ("COMEBACK", 141, 1768, 124),
    ("CAPING", 140, 2207, 141), ("MIRCO", 140, 1817, 130), ("MIDWAY PP*", 140, 1840, 126),
    ("GREYTOP", 140, 2055, 125), ("RAITON", 139, 1958, 133), ("SEAPORT", 139, 1800, 124),
    ("GLADIUS", 138, 2168, 144), ("ROCHESTER", 138, 1885, 128), ("MONTAGUE", 138, 1830, 123),
    ("WINSTON", 137, 1985, 135), ("DAY PP RDC", 137, 2102, 133), ("GRAHAM", 137, 1859, 129),
    ("CAMP", 137, 1790, 127), ("ROWLING", 137, 1917, 125), ("NEXO", 137, 1584, 122),
    ("RANGO", 136, 1848, 130), ("ADEO", 135, 2067, 138), ("BALZAC", 135, 1660, 134),
    ("GOAL P RDC", 135, 1870, 133), ("GENIUS", 135, 1386, 120), ("CLAY", 134, 1710, 127),
    ("COHEN RDC", 134, 1702, 125), ("FREEDOM P", 133, 1535, 120), ("GARANTIE", 132, 1785, 129),
    ("RESISTANCE", 132, 1738, 129), ("REVOLUTION", 132, 1647, 129), ("OLDFIELD", 132, 1591, 123),
    ("SMOKEY P", 132, 1397, 115), ("SKYWALK RDC", 131, 1296, 119), ("BOMBASTIC", 129, 1505, 133),
    ("MATTY P RDC", 128, 1532, 130), ("GREYHOUND", 128, 1486, 123), ("KANT RDC", 128, 998, 110),
    ("COLLIN", 127, 1087, 125), ("COMBINO", 127, 1370, 124), ("SARTRE RDC", 125, 1286, 135),
    ("BRISE PP", 125, 1081, 119), ("CAPONE", 124, 1262, 131), ("PUSCHKIN", 123, 1266, 132),
    ("YEARWOOD", 122, 960, 118), ("CORELLI", 121, 1102, 117),
]
RB_ERWEITERT = [
    ("DAKTARI PP", 144, 2312, 136), ("SKILL RED", 144, 2072, 126), ("HANDOUT P", 142, 1975, 131),
    ("MEGA-RED P", 142, 1939, 131), ("SODA PP", 141, 2059, 135), ("MASCARDI Pp*", 141, 2050, 134),
    ("REDFORD VG89", 141, 2082, 134), ("FUN RED PP", 140, 1925, 127), ("HOMAGE PP*", 138, 1458, 115),
    ("FREESOLE", 137, 1647, 120), ("DO IT PP", 136, 1749, 129), ("KEANE PP", 136, 1663, 123),
    ("SINEY PP*", 136, 1545, 121), ("SPREAD P", 134, 1424, 122), ("CARUS P", 134, 1492, 118),
    ("MENLO PP*", 131, 1648, 124), ("MALITO PP", 127, 1123, 120), ("MAYSON P", 126, 1182, 118),
    ("STELLAR P", 126, 1146, 117), ("EYCK", 125, 1330, 134), ("ASTRA RED", 123, 952, 109),
    ("SOLI-RED P", 122, 1075, 128), ("GROOVY P", 118, 1049, 123), ("STANFORD P", 118, 966, 122),
    ("SHARIF", 115, 595, 121), ("STONE", 114, 560, 104),
]

# Aus einem Mitschnitt der internen getBulls-API (vollständige Zusatzmerkmale,
# per Name gematcht). RZG/RZ€/RZM hier zur Kontrolle nochmal mitgeführt.
API_ENRICHED = {
    "SOTU P": dict(rzg=155, rzeuro=2588, rzm=142, milch_kg=2269, fett_pct=-0.07, eiweiss_pct=-0.02,
                   rzgesund=124, rze=132, rzkd=98, rzrobot=None, rzs=126, rzn=126, rzd=102, rzr=102,
                   milchtyp=125, koerper=100, fundament=118, euter=124),
    "MONAMI": dict(rzg=153, rzeuro=2699, rzm=133, milch_kg=956, fett_pct=0.51, eiweiss_pct=0.09,
                   rzgesund=126, rze=116, rzkd=98, rzrobot=117, rzs=132, rzn=128, rzd=96, rzr=131,
                   milchtyp=106, koerper=94, fundament=107, euter=119),
    "CALLBOX": dict(rzg=151, rzeuro=2527, rzm=142, milch_kg=2286, fett_pct=-0.04, eiweiss_pct=-0.05,
                    rzgesund=119, rze=131, rzkd=89, rzrobot=None, rzs=116, rzn=121, rzd=107, rzr=112,
                    milchtyp=122, koerper=104, fundament=109, euter=128),
    "HARMONIC P": dict(rzg=161, rzeuro=2963, rzm=146, milch_kg=1669, fett_pct=0.24, eiweiss_pct=0.18,
                        rzgesund=121, rze=130, rzkd=107, rzrobot=122, rzs=114, rzn=131, rzd=102, rzr=115,
                        milchtyp=116, koerper=86, fundament=132, euter=121),
    "SHERIDAN": dict(rzg=153, rzeuro=2839, rzm=146, milch_kg=1986, fett_pct=0.26, eiweiss_pct=0.03,
                      rzgesund=115, rze=124, rzkd=100, rzrobot=105, rzs=111, rzn=127, rzd=93, rzr=113,
                      milchtyp=134, koerper=118, fundament=111, euter=106),
    "HANDSOME P": dict(rzg=150, rzeuro=2281, rzm=134, milch_kg=1766, fett_pct=-0.07, eiweiss_pct=0.01,
                        rzgesund=120, rze=132, rzkd=105, rzrobot=117, rzs=109, rzn=126, rzd=107, rzr=107,
                        milchtyp=114, koerper=104, fundament=113, euter=130),
}


def make(name, rzg, rzeuro, rzm, farbe, kategorie):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    rec = {
        "id": f"rbw-{slug}",
        "firma": "RBW",
        "rasse": "Holstein",
        "farbe": farbe,
        "kategorie": kategorie,
        "name": name,
        "rzg": rzg,
        "rzeuro": rzeuro,
        "rzm": rzm,
        "quelle_url": QUELLE,
        "stand": STAND,
        "vollstaendig": False,
    }
    extra = API_ENRICHED.get(name)
    if extra:
        rec.update({
            "milch_kg": extra["milch_kg"],
            "fett_pct": extra["fett_pct"],
            "eiweiss_pct": extra["eiweiss_pct"],
            "rzgesund": extra["rzgesund"],
            "rze": extra["rze"],
            "rzkd": extra["rzkd"],
            "rzrobot": extra["rzrobot"],
            "rzs": extra["rzs"],
            "rzn": extra["rzn"],
            "rzd": extra["rzd"],
            "rzr": extra["rzr"],
            "milchtyp": extra["milchtyp"],
            "koerper": extra["koerper"],
            "fundament": extra["fundament"],
            "euter": extra["euter"],
            "vollstaendig": True,
        })
    return rec


def main():
    bulls = []
    for name, rzg, rzeuro, rzm in SB_EMPFEHLUNG:
        bulls.append(make(name, rzg, rzeuro, rzm, "Schwarzbunt", "Bullenempfehlung"))
    for name, rzg, rzeuro, rzm in RB_EMPFEHLUNG:
        bulls.append(make(name, rzg, rzeuro, rzm, "Rotbunt", "Bullenempfehlung"))
    for name, rzg, rzeuro, rzm in SB_ERWEITERT:
        bulls.append(make(name, rzg, rzeuro, rzm, "Schwarzbunt", "Erweiterte Spermaliste"))
    for name, rzg, rzeuro, rzm in RB_ERWEITERT:
        bulls.append(make(name, rzg, rzeuro, rzm, "Rotbunt", "Erweiterte Spermaliste"))
    json.dump(bulls, sys.stdout, ensure_ascii=False, indent=2)
    print(f"\n# {len(bulls)} RBW-Bullen geschrieben", file=sys.stderr)


if __name__ == "__main__":
    main()

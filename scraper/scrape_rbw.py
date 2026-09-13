#!/usr/bin/env python3
"""
RBW (Rinderunion Baden-Württemberg) Bullenkatalog-Scraper – Playwright.

RBW läuft auf dem "EasyBull"-System (siehe easybull_common.py) und
schützt seine Bullen-API mit einem AltCha-Proof-of-Work, der nur im
echten Browser gelöst wird (kein Login, aber kein einfacher curl-
Request). Dieses Skript lädt die öffentlichen Bullenlisten-Seiten in
einem echten (headless) Chromium, lässt die Seite die getBulls-Aufrufe
normal auslösen und fängt die vollständigen JSON-Antworten per
Netzwerk-Interception ab.

Voraussetzung: pip3 install playwright && python3 -m playwright install chromium

Aufruf:
    python3 scrape_rbw.py > ../data/rbw_bulls.json
"""
from __future__ import annotations

import json
import sys
from datetime import date

from easybull_common import enrich_with_exterieur, normalize, scrape_pages

FIRMA = "RBW"
BASE_URL = "https://www.rind-bw.de"
QUELLE_URL = "https://rind-bw.de/bullen/holsteins/bullenempfehlung-12.html"
PAGES = [
    ("https://rind-bw.de/bullen/holsteins/bullenempfehlung-12.html", "Bullenempfehlung"),
    ("https://rind-bw.de/bullen/holsteins/erweiterte-spermaliste-14.html", "Erweiterte Spermaliste"),
    ("https://rind-bw.de/bullen/holsteins/nachkommengeprueft-552.html", "Nachkommengeprüft"),
    ("https://rind-bw.de/bullen/holsteins/gesextes-sperma-15.html", "Gesextes Sperma"),
]


def main():
    today = date.today().isoformat()
    captured = scrape_pages(PAGES)

    bulls = []
    for name, raw in captured.items():
        farbe = "Rotbunt" if str(raw.get("spe_ura_intnr")) == "19" else "Schwarzbunt"
        rec = normalize(raw, FIRMA, QUELLE_URL, "RBW-Katalog", farbe, today)
        if rec:
            bulls.append(rec)

    if "--no-details" not in sys.argv:
        enrich_with_exterieur(bulls, BASE_URL)

    json.dump(bulls, sys.stdout, ensure_ascii=False, indent=2)
    print(f"\n# {len(bulls)} RBW-Bullen per Playwright erfasst", file=sys.stderr)


if __name__ == "__main__":
    main()

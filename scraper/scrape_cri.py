#!/usr/bin/env python3
"""
CRI Genetics (Sauerland) Bullenkatalog-Scraper – Playwright.

CRI Genetics läuft auf demselben "EasyBull"-System wie RBW (siehe
easybull_common.py) und liefert dieselbe Merkmalstiefe – inklusive der
granularen Exterieur-Zuchtwerte Strichlänge und Stärke, die bei WWS,
Prismagen, Semex und der öffentlichen RBW-Ansicht sonst fehlen.

Aufruf:
    python3 scrape_cri.py > ../data/cri_bulls.json
"""
from __future__ import annotations

import json
import sys
from datetime import date

from easybull_common import enrich_with_exterieur, normalize, scrape_pages

FIRMA = "CRI"
BASE_URL = "https://www.cri-genetics.de"
QUELLE_URL = "https://www.cri-genetics.de/bullenangebot/holstein-6.html"
PAGES = [
    ("https://www.cri-genetics.de/bullenangebot/holstein-6.html", "Holstein"),
    ("https://www.cri-genetics.de/bullenangebot/holstein-usa-7.html", "Holstein USA"),
]


def main():
    today = date.today().isoformat()
    captured = scrape_pages(PAGES)

    bulls = []
    for name, raw in captured.items():
        farbe = "Rotbunt" if str(raw.get("spe_ura_intnr")) == "19" else "Schwarzbunt"
        rec = normalize(raw, FIRMA, QUELLE_URL, "CRI-Katalog", farbe, today)
        if rec:
            bulls.append(rec)

    if "--no-details" not in sys.argv:
        enrich_with_exterieur(bulls, BASE_URL)

    json.dump(bulls, sys.stdout, ensure_ascii=False, indent=2)
    print(f"\n# {len(bulls)} CRI-Bullen per Playwright erfasst", file=sys.stderr)


if __name__ == "__main__":
    main()

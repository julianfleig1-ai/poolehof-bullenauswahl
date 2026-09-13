#!/usr/bin/env python3
"""
Semex Bullenkatalog-Scraper (USA/international Sire Directory).

Der deutsche Semex-Katalog (semex-deutschland.de) ist nur als gescanntes
Bilder-Flipbook veröffentlicht (keine Tabelle, keine Automatik möglich).
Semex selbst betreibt aber unter semex.com eine echte, alte aber
öffentliche HTML-Tabellenseite (kein Login, kein Anti-Bot, kein JS
nötig) mit denselben Bullen in US-Skala (TPI, NM$, DPR, SCS, PTAT …):

    https://www.semex.com/di/us/inc/i?lang=en&view=list&breed=<CODE>&data=lpi&print=n

Wichtig: Das sind die international/US vermarkteten Semex-Bullen (USD/TPI-
Skala). Ob genau diese auch über Semex Deutschland bestellt werden können,
ist nicht sicher – als Startdatensatz aber die einzige automatisierbare
Quelle, die wir für Semex gefunden haben.

Breed-Codes: HO = Holstein (töchtergeprüft), GX-H = Genomax Holstein
(genomische Jungvererber).

Aufruf:
    python3 scrape_semex.py > ../data/semex_bulls.json
"""
import json
import re
import sys
import urllib.request
from datetime import date

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Bitte installieren: pip3 install beautifulsoup4")

BASE = "https://www.semex.com/di/us/inc/i"
BREEDS = [("HO", "Holstein Töchtergeprüft"), ("GX-H", "Holstein Genomax (genomisch)")]

# Reihenfolge der Spalten wie auf der Seite (per Tooltip-Label identifiziert,
# '' = Trennspalte ohne Wert, wird übersprungen)
COLUMNS = [
    "semen_code", "name", "tpi", "nm_usd", "dwp_usd", "", "milch_lbs", "cfp",
    "fett_lbs", "fett_pct", "eiweiss_lbs", "eiweiss_pct", "", "ptat", "udc", "flc", "",
    "immunity", "calf_immunity", "pl", "dpr", "sce", "scs", "beta_casein",
    "kappa_casein", "", "vater", "mv",
]
NUMERIC_FIELDS = {
    "tpi", "nm_usd", "dwp_usd", "milch_lbs", "cfp", "fett_lbs", "fett_pct",
    "eiweiss_lbs", "eiweiss_pct", "ptat", "udc", "flc", "immunity",
    "calf_immunity", "pl", "dpr", "sce", "scs",
}


def fetch(breed: str) -> str:
    url = f"{BASE}?lang=en&view=list&breed={breed}&data=lpi&sort=&sortmethod=&print=n"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def find_data_table(soup: BeautifulSoup):
    candidates = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr", recursive=False)
        for row in rows:
            for td in row.find_all("td", recursive=False):
                tip = td.find("span", class_="tooltiptext")
                if tip and tip.get_text(strip=True) == "Semen Code":
                    candidates.append(table)
                    break
            else:
                continue
            break
    if not candidates:
        return None
    # Mehrere verschachtelte Tabellen können matchen (äußere Hülle +
    # die eigentliche Datentabelle) - die mit den meisten direkten
    # Zeilen ist die echte Datentabelle.
    return max(candidates, key=lambda t: len(t.find_all("tr", recursive=False)))


def dedup(text: str) -> str:
    text = text.strip()
    n = len(text)
    if n % 2 == 0 and text[: n // 2] == text[n // 2 :]:
        return text[: n // 2]
    return text


def parse(html: str, kategorie: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    table = find_data_table(soup)
    if table is None:
        return []
    rows = table.find_all("tr", recursive=False)
    bulls = []
    today = date.today().isoformat()
    for row in rows[2:]:  # rows[0]=Sektionstitel, rows[1]=Spaltenkoepfe
        cells = [td.get_text(strip=True) for td in row.find_all("td", recursive=False)]
        if len(cells) < len(COLUMNS) or not cells[0] or not cells[0][0].isdigit():
            continue  # ueberspringt Header-Zeilen, die mitten in der Tabelle wiederholt werden
        rec = {}
        for col, val in zip(COLUMNS, cells):
            if not col or val == "":
                continue
            if col == "name":
                val = dedup(val)
            if col in NUMERIC_FIELDS:
                try:
                    val = float(re.sub(r"[^0-9.\-]", "", val))
                except ValueError:
                    continue
            rec[col] = val
        if not rec.get("name"):
            continue
        rec["kategorie"] = kategorie
        rec["firma"] = "Semex"
        rec["rasse"] = "Holstein"
        rec["quelle_url"] = "https://www.semex.com/us/i?view=list&breed=HO"
        rec["stand"] = today
        rec["vollstaendig"] = "tpi" in rec and "scs" in rec
        slug = re.sub(r"[^a-z0-9]+", "-", rec["name"].lower()).strip("-")
        rec["id"] = f"semex-{slug}"
        bulls.append(rec)
    return bulls


def main():
    all_bulls: dict[str, dict] = {}
    for code, kategorie in BREEDS:
        try:
            html = fetch(code)
        except Exception as e:
            print(f"# Warnung: Breed {code} fehlgeschlagen ({e})", file=sys.stderr)
            continue
        for b in parse(html, kategorie):
            all_bulls[b["id"]] = b

    bulls = list(all_bulls.values())
    json.dump(bulls, sys.stdout, ensure_ascii=False, indent=2)
    print(f"\n# {len(bulls)} Semex-Bullen (US-Skala, semex.com Sire Directory)", file=sys.stderr)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
WWS Deutschland (World Wide Sires) Bullenkatalog-Scraper.

Holt die öffentliche Bullenangebot-Seite (kein Login nötig, serverseitig
gerendert) und wandelt alle Tabellen (Holstein Töchtergeprüft, Holstein
Genomisch, Braunvieh, Jersey, Holstein Zusatzangebot, NxGen) in eine
normalisierte JSON-Liste um.

Aufruf:
    python3 scrape_wws.py > ../data/wws_bulls.json

Quelle: https://www.wws-bullen.de/bullenangebot
"""
import json
import re
import sys
import time
import urllib.request
from datetime import date

URL = "https://www.wws-bullen.de/bullenangebot"

# Label auf der Bull-Detailseite (Linear-Tabelle) -> unser Feldname.
# Enthält u.a. Strichlänge & Stärke (US-Linearskala, ~-3..+3) - die bei
# WWS NICHT in der Übersichtstabelle stehen, nur auf der Detailseite pro Bulle.
DETAIL_FIELD_MAP = {
    "Stärke": "staerke_us",
    "Strichlänge": "strichlaenge_us",
    "Strichplatzierung vorne": "strichplatzierung_vorne_us",
    "Strichplatzierung hinten": "strichplatzierung_hinten_us",
    "Eutertiefe": "eutertiefe_us",
    "Beckenbreite": "beckenbreite_us",
}

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Bitte installieren: pip3 install beautifulsoup4")

# Spaltenname (wie auf der Seite) -> normalisierter Feldname in unserem Schema
COLUMN_MAP = {
    "Name": "name",
    "HB-Nr": "hb_nr",
    "Vater": "vater",
    "aAa": "aaa",
    "M-lbs": "milch_lbs",
    "F-%": "fett_pct",
    "F-lbs": "fett_lbs",
    "E-%": "eiweiss_pct",
    "E-lbs": "eiweiss_lbs",
    "SCS": "scs",
    "PL": "pl",
    "DPR": "dpr",
    "PTAT": "ptat",
    "MBK": "mbk",
    "TPI": "tpi",
    "NM$": "nm_usd",
    "HHP$": "hhp_usd",
    "DWP$": "dwp_usd",
    "€ konv.": "preis_konv_eur",
    "€ gesext": "preis_gesext_eur",
}


def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    tab_labels = {
        t.get("data-w-tab"): t.get_text(strip=True)
        for t in soup.select(".w-tab-menu .tab-item")
    }

    bulls = []
    today = date.today().isoformat()

    for pane in soup.select(".w-tab-pane"):
        tab_id = pane.get("data-w-tab")
        kategorie = tab_labels.get(tab_id, tab_id or "Unbekannt")
        header = pane.select_one(".table-header")
        if not header:
            continue
        columns = [th.get_text(strip=True) for th in header.select("th")]

        for row in pane.select(".table-row"):
            cells = row.find_all("td", recursive=False)
            if len(cells) != len(columns):
                continue
            raw = {}
            for col_name, cell in zip(columns, cells):
                span = cell.select_one("[data-value]")
                if span is not None:
                    raw[col_name] = span["data-value"]
                else:
                    raw[col_name] = cell.get_text(strip=True)

            record = {"kategorie": kategorie}
            text_fields = {"name", "hb_nr", "vater", "aaa"}
            for col_name, value in raw.items():
                field = COLUMN_MAP.get(col_name, col_name)
                if field in text_fields:
                    record[field] = value
                    continue
                # Zuchtwert-/Preisfelder in float wandeln wo möglich
                try:
                    record[field] = float(value)
                except (TypeError, ValueError):
                    record[field] = value

            link = row.select_one("a.button-details")
            if link and link.get("href"):
                record["detail_url"] = "https://www.wws-bullen.de" + link["href"]

            record["firma"] = "WWS"
            record["rasse"] = _rasse_aus_kategorie(kategorie)
            record["quelle_url"] = URL
            record["stand"] = today
            record["id"] = f"wws-{re.sub(r'[^a-z0-9]+', '-', record.get('name','').lower()).strip('-')}"
            bulls.append(record)

    return bulls


def fetch_detail_traits(detail_url: str) -> dict:
    """Holt Strichlänge/Stärke etc. von der Bull-Detailseite (statisches HTML,
    kein Login/JS nötig - die Werte stehen direkt in <span data-bind="text: value">)."""
    try:
        html = fetch_html(detail_url)
    except Exception:
        return {}
    soup = BeautifulSoup(html, "html.parser")
    labels = [t.get_text(strip=True) for t in soup.select('[data-bind="text: title"]')]
    values = [v.get_text(strip=True) for v in soup.select('[data-bind="text: value"]')]
    out = {}
    for label, value in zip(labels, values):
        field = DETAIL_FIELD_MAP.get(label)
        if not field:
            continue
        try:
            out[field] = float(value)
        except ValueError:
            pass
    return out


def enrich_with_details(bulls: list[dict], delay: float = 0.3) -> None:
    """Reichert jeden Bullen mit detail_url um Strichlänge/Stärke an (in-place)."""
    for i, b in enumerate(bulls):
        url = b.get("detail_url")
        if not url:
            continue
        traits = fetch_detail_traits(url)
        b.update(traits)
        if delay:
            time.sleep(delay)


def _rasse_aus_kategorie(kategorie: str) -> str:
    k = kategorie.lower()
    if "holstein" in k:
        return "Holstein"
    if "braunvieh" in k:
        return "Braunvieh"
    if "jersey" in k:
        return "Jersey"
    return kategorie


def main():
    skip_details = "--no-details" in sys.argv
    html = fetch_html(URL)
    bulls = parse(html)
    if not skip_details:
        print(f"# Hole Strichlänge/Stärke von {len(bulls)} Detailseiten …", file=sys.stderr)
        enrich_with_details(bulls)
    json.dump(bulls, sys.stdout, ensure_ascii=False, indent=2)
    print(f"\n# {len(bulls)} Bullen geladen von {URL}", file=sys.stderr)


if __name__ == "__main__":
    main()

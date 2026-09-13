#!/usr/bin/env python3
"""
Prismagen / STG Germany Bullenkatalog-Scraper (Holstein).

STG Germany (frueher "Prismagen") zeigt seine Holstein-Bullenliste als
öffentliche, serverseitig gerenderte HTML-Tabelle (WordPress) — kein
Login, kein Anti-Bot. Die Seite hat zwei Ansichten über den Query-
Parameter ?zuchtwerte=de|us, die dieselben Bullen mit unterschiedlichen
Merkmalen zeigen (deutsche RZ-Skala bzw. US-Skala/TPI). Wir holen beide
und führen sie über die HB-Nr. zusammen.

Aufruf:
    python3 scrape_prismagen.py > ../data/prismagen_bulls.json

Quelle: https://stggermany.de/bullen/holstein/
"""
import json
import re
import sys
import time
import urllib.request
from datetime import date

BASE = "https://stggermany.de/bullen/holstein/"
URL_DE = BASE + "?zuchtwerte=de"
URL_US = BASE + "?zuchtwerte=us"

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Bitte installieren: pip3 install beautifulsoup4")

# DE-Tabelle: Spaltenname -> Feldname
DE_MAP = {
    "Kurzname": "name", "HB-Nr.": "hb_nr", "Vater": "vater", "MV": "mv",
    "RZG": "rzg", "RZ€": "rzeuro", "Milch kg": "milch_kg",
    "Fett%": "fett_pct", "Fett": "fett_kg", "Eiw%": "eiweiss_pct", "Eiw": "eiweiss_kg",
    "RZM": "rzm", "RZE": "rze", "Fun": "fundament", "Eut": "euter",
    "RZS": "rzs", "RZN": "rzn", "RZR": "rzr", "KVd": "rzkd", "RZD": "rzd",
    "EFit": "rzeuterfit", "RZGesund": "rzgesund", "aAa": "aaa", "B-Kn": "bkn",
    "€*": "preis_eur", "€* ♀": "preis_eur_gesext",
}
# US-Tabelle: Spaltenname -> Feldname
US_MAP = {
    "Kurzname": "name", "HB-Nr.": "hb_nr", "Vater": "vater", "MV": "mv",
    "TPI": "tpi", "NM$": "nm_usd", "ECO$": "eco_usd", "Milch": "milch_lbs",
    "Fett%": "fett_pct", "Fett": "fett_lbs", "Eiw%": "eiweiss_pct", "Eiw.": "eiweiss_lbs",
    "CFP": "cfp", "PTAT": "ptat", "Fun": "fundament_us", "Eut": "euter_us",
    "SCS": "scs", "PL": "pl", "LIV": "liv", "CCR": "ccr", "SCE": "sce", "Mbk": "mbk",
    "RCI": "rci", "aAa": "aaa", "B-Kn": "bkn",
    "€*": "preis_eur", "€* ♀": "preis_eur_gesext",
}
TEXT_FIELDS = {"name", "hb_nr", "vater", "mv", "aaa", "bkn", "preis_eur", "preis_eur_gesext"}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_table(html: str, colmap: dict, scale: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return []
    rows = table.find_all("tr")
    if not rows:
        return []
    header = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
    out = []
    for row in rows[1:]:
        cells = row.find_all(["td", "th"])
        if len(cells) != len(header):
            continue
        raw = {}
        detail_url = None
        for col_name, cell in zip(header, cells):
            if col_name == "PDF":
                continue
            if col_name == "Kurzname":
                link = cell.find("a")
                if link and link.get("href"):
                    detail_url = link["href"]
            raw[col_name] = cell.get_text(strip=True)
        record = {}
        if detail_url:
            record[f"detail_url_{scale}"] = detail_url
        for col_name, value in raw.items():
            field = colmap.get(col_name)
            if not field:
                continue
            if field in TEXT_FIELDS:
                record[field] = value
                continue
            try:
                record[field] = float(value.replace("+", "")) if value not in ("", "-") else None
            except ValueError:
                record[field] = value
        if record.get("name"):
            out.append(record)
    return out


# Labels auf der Detailseite bleiben IMMER deutsch (auch bei ?zuchtwerte=us) -
# aber die WERTE wechseln je nach Query-Parameter die Skala (RZ- vs. US-Linear).
# Deshalb: welches Feld (…_de/…_us) befüllt wird, hängt davon ab, welche
# Detailseiten-Variante wir gerade abgerufen haben - nicht vom Label selbst.
DETAIL_FIELD_MAP = {"Strichlänge": "strichlaenge", "Stärke": "staerke"}


def fetch_detail_traits(detail_url: str, scale: str) -> dict:
    """Holt Strichlänge/Stärke von der Bull-Detailseite - statisches HTML,
    <tr><th>Label</th><td>CODE</td><td><span class="w-post-elm-value">WERT</span></td></tr>."""
    try:
        html = fetch(detail_url)
    except Exception:
        return {}
    soup = BeautifulSoup(html, "html.parser")
    out = {}
    for label, base_field in DETAIL_FIELD_MAP.items():
        th = soup.find("th", string=label)
        if not th:
            continue
        row = th.find_parent("tr")
        span = row.select_one(".w-post-elm-value") if row else None
        if span:
            try:
                out[f"{base_field}_{scale}"] = float(span.get_text(strip=True))
            except ValueError:
                pass
    return out


def enrich_with_details(bulls: list[dict], delay: float = 0.3) -> None:
    for b in bulls:
        for scale in ("de", "us"):
            url = b.pop(f"detail_url_{scale}", None)
            if not url:
                continue
            b.setdefault("detail_url", url)  # zum Verlinken auf der Bull-Übersicht
            b.update(fetch_detail_traits(url, scale))
            if delay:
                time.sleep(delay)


def main():
    today = date.today().isoformat()
    de_rows = parse_table(fetch(URL_DE), DE_MAP, "de")
    us_rows = parse_table(fetch(URL_US), US_MAP, "us")

    by_hbnr: dict[str, dict] = {}
    for r in de_rows:
        by_hbnr[r.get("hb_nr") or r["name"]] = {**r}
    for r in us_rows:
        key = r.get("hb_nr") or r["name"]
        if key in by_hbnr:
            merged = by_hbnr[key]
            for k, v in r.items():
                if k not in merged or merged[k] in (None, ""):
                    merged[k] = v
        else:
            by_hbnr[key] = {**r}

    bulls = []
    for key, rec in by_hbnr.items():
        rec["firma"] = "Prismagen"
        rec["rasse"] = "Holstein"
        rec["quelle_url"] = BASE
        rec["stand"] = today
        rec["vollstaendig"] = "rzg" in rec and "tpi" in rec
        slug = re.sub(r"[^a-z0-9]+", "-", str(rec.get("name", key)).lower()).strip("-")
        rec["id"] = f"prismagen-{slug}"
        bulls.append(rec)

    if "--no-details" not in sys.argv:
        print(f"# Hole Strichlänge/Stärke von Detailseiten …", file=sys.stderr)
        enrich_with_details(bulls)

    json.dump(bulls, sys.stdout, ensure_ascii=False, indent=2)
    print(f"\n# {len(bulls)} Prismagen-Bullen ({len(de_rows)} DE-Zeilen, {len(us_rows)} US-Zeilen)", file=sys.stderr)


if __name__ == "__main__":
    main()

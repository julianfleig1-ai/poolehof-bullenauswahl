#!/usr/bin/env python3
"""
Gemeinsamer Code für Besamungsstationen, die auf dem "EasyCMS/EasyBull"-
System laufen (erkennbar an der API
EasyCMS@Page@Content@EasyBull@EasyBullRetriever/getBulls/.../...).
Bekannt: RBW (rind-bw.de) und CRI Genetics (cri-genetics.de).

Diese API ist mit einem AltCha-Proof-of-Work abgesichert, der nur in
einem echten Browser gelöst wird – deshalb Playwright statt curl/requests.
"""
from __future__ import annotations

import re
import time
from datetime import date

from playwright.sync_api import sync_playwright

# spe_* Rohfeld -> unser normalisierter Feldname. Gilt für alle EasyBull-Stationen.
# "ho"-Präfix = deutsche Zuchtwertschätzung (RZ-Skala).
FIELD_MAP = {
    "spe_intnr": "spe_intnr", "spe_name": "name", "spe_hbnr": "hb_nr",
    "spe_abst_e_v_na": "vater", "spe_abst_g_mv_na": "mv",
    "spe_ho_rzg": "rzg", "spe_ho_rzeuro": "rzeuro", "spe_ho_rzoeko": "rzoeko",
    "spe_ho_rzm": "rzm", "spe_ho_tpi": "tpi", "spe_ho_nmdollar": "nm_usd",
    "spe_ho_mw_mm": "milch_kg", "spe_ho_mw_fp": "fett_pct", "spe_ho_mw_ep": "eiweiss_pct",
    "spe_ho_fit_ges": "rzgesund", "spe_ho_fit_rze": "rze", "spe_ho_fit_rzk_p": "rzkd",
    "spe_ho_fit_rzrobot": "rzrobot", "spe_ho_fit_rzs": "rzs", "spe_ho_fit_rzn": "rzn",
    "spe_ho_fit_mk": "rzd", "spe_ho_fit_fk_m": "rzr", "spe_ho_fit_efit": "rzeuterfit",
    "spe_ho_fit_klg": "rzklaue", "spe_ho_fit_ddc": "rzddc",
    "spe_ho_exzw_mtyp": "milchtyp", "spe_ho_exzw_koerper": "koerper",
    "spe_ho_exzw_fun": "fundament", "spe_ho_exzw_eut": "euter",
    "spe_ho_exzw_strichlaenge": "strichlaenge_de", "spe_ho_exzw_staerke": "staerke_de",
    "spe_ho_dat_zw": "zws_datum", "spe_vk_preis_il": "preis_konv_eur",
    "spe_vk_preis_gesext_il": "preis_gesext_eur",
}
# "um"-Präfix = US-Importbullen ohne deutsche ZWS (bei CRI Genetics unter
# "Holstein USA" gelistet) - eigenes Schema, US-Skala (TPI, NM$, DPR, SCS …).
# Ohne dieses Mapping bleiben diese Bullen praktisch leer (nur Name/Preis)!
UM_FIELD_MAP = {
    "spe_um_tpi": "tpi", "spe_um_nmdollar": "nm_usd",
    "spe_um_prod_milk": "milch_lbs", "spe_um_prod_fat": "fett_lbs",
    "spe_um_prod_fatp": "fett_pct", "spe_um_prod_prot": "eiweiss_lbs",
    "spe_um_prod_protp": "eiweiss_pct", "spe_um_ptat": "ptat",
    "spe_um_scs": "scs", "spe_um_dpr": "dpr", "spe_um_pl": "pl", "spe_um_sce": "sce",
    "spe_um_udc": "udc", "spe_um_flc": "flc",
    # Achtung: "_sta" ist Stature (Größe), "_str" ist Strength (Stärke) -
    # per Detailseite gegengeprüft. "_tl" = Teat Length (Strichlänge).
    "spe_um_exzw_sta": "groesse_us", "spe_um_exzw_str": "staerke_us",
    "spe_um_exzw_tl": "strichlaenge_us",
    "spe_um_dat_zw": "zws_datum",
}
NUMERIC_FIELDS = {
    "rzg", "rzeuro", "rzoeko", "rzm", "tpi", "nm_usd", "milch_kg", "fett_pct",
    "eiweiss_pct", "rzgesund", "rze", "rzkd", "rzrobot", "rzs", "rzn", "rzd", "rzr",
    "rzeuterfit", "rzklaue", "rzddc", "milchtyp", "koerper", "fundament", "euter",
    "strichlaenge_de", "staerke_de", "preis_konv_eur", "preis_gesext_eur",
    "milch_lbs", "fett_lbs", "eiweiss_lbs", "ptat", "scs", "dpr", "pl", "sce",
    "udc", "flc", "staerke_us", "strichlaenge_us", "groesse_us",
}

# Einzelmerkmale aus der Exterieur-Tabelle der Bull-DETAILSEITE.
# Die Listen-API liefert diese bei RBW gar nicht und bei CRI nur teilweise -
# die Detailseite hat sie bei beiden (normales HTML, kein Playwright nötig).
EXTERIEUR_LABELS = {"Strichlänge": "strichlaenge", "Stärke": "staerke"}

# Merkmale aus der Kennzahlen-Tabelle der Detailseite (<table class="eb2-table">,
# Zeilen der Form <td>Melkbarkeit (MS)</td><td>103</td>). Die Listen-API liefert
# diese bei den US-Importbullen nicht mit.
INDEX_LABELS = {
    "Melkbarkeit": "melkbarkeit",
    "Töchterfruchtb.": "fruchtbarkeit",
    "Töchterfruchtbarkeit": "fruchtbarkeit",
    "Fruchtbarkeit": "fruchtbarkeit",
    "Zellzahl": "zellzahl",
}
# Welches Feld der Wert am Ende fuellt - haengt an der Skala, nicht am Label:
# RZ-Werte liegen um 100, US-Werte (DPR, Milking Speed 1-9) darunter.
SKALEN_FELD = {
    ("melkbarkeit", "de"): "rzd",  ("melkbarkeit", "us"): "mbk",
    ("fruchtbarkeit", "de"): "rzr", ("fruchtbarkeit", "us"): "dpr",
    ("zellzahl", "de"): "rzs",      ("zellzahl", "us"): "scs",
    ("strichlaenge", "de"): "strichlaenge_de", ("strichlaenge", "us"): "strichlaenge_us",
    ("staerke", "de"): "staerke_de", ("staerke", "us"): "staerke_us",
}


def _skala(basis: str, wert: float) -> str:
    """RZ-Skala (~100) oder US-Skala? Zellzahl ist der Sonderfall: RZS liegt
    um 100, SCS zwischen 2 und 4 - deshalb reicht auch hier die Groesse."""
    return "de" if abs(wert) >= 20 else "us"


def normalize(raw: dict, firma: str, quelle_url: str, kategorie: str, farbe: str, today: str):
    name = (raw.get("spe_name") or "").strip()
    if not name:
        return None
    rec = {"kategorie": kategorie, "farbe": farbe}
    for src, dst in {**FIELD_MAP, **UM_FIELD_MAP}.items():
        val = raw.get(src)
        if val in (None, ""):
            continue
        if dst in NUMERIC_FIELDS:
            try:
                rec[dst] = float(str(val).replace(",", "."))
            except (TypeError, ValueError):
                pass
        else:
            rec[dst] = val
    detail = raw.get("detailUrl")
    if detail:
        rec["detail_url"] = detail  # wird in enrich_with_exterieur absolut gemacht
    rec["firma"] = firma
    rec["rasse"] = "Holstein"
    rec["quelle_url"] = quelle_url
    rec["stand"] = today
    rec["vollstaendig"] = "rzs" in rec and "rzd" in rec and "rzr" in rec
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    rec["id"] = f"{firma.lower()}-{slug}"
    return rec


def _fetch(url: str) -> str:
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_exterieur(detail_url: str) -> dict:
    """Liest Strichlänge/Stärke aus der Exterieur-Tabelle der Bull-Detailseite.

    Struktur (EasyBull, serverseitig gerendert):
      <td class="eb2-exterieur--title">Strichlänge</td>
      <td class="eb2-exterieur--value">92</td>

    Die Skala erkennen wir am Betrag: RZ-Werte liegen um 100 herum,
    US-Linearwerte zwischen etwa -5 und +5. Dadurch landen deutsche und
    amerikanische Bullen automatisch im richtigen Feld (…_de bzw. …_us).
    """
    from bs4 import BeautifulSoup
    try:
        html = _fetch(detail_url)
    except Exception:
        return {}
    soup = BeautifulSoup(html, "html.parser")
    out = {}

    def merke(basis, rohwert):
        try:
            wert = float(str(rohwert).strip().replace(",", "."))
        except ValueError:
            return
        feld = SKALEN_FELD.get((basis, _skala(basis, wert)))
        if feld:
            out[feld] = wert

    # Linearprofil (Strichlänge, Stärke)
    for title in soup.select(".eb2-exterieur--title"):
        base = EXTERIEUR_LABELS.get(title.get_text(strip=True))
        value_el = title.find_next_sibling(class_="eb2-exterieur--value") if base else None
        if value_el:
            merke(base, value_el.get_text(strip=True))

    # Kennzahlen-Tabelle (Melkbarkeit, Töchterfruchtbarkeit, Zellzahl)
    for row in soup.select("table.eb2-table tr"):
        zellen = row.find_all("td")
        if len(zellen) != 2:
            continue
        label = zellen[0].get_text(strip=True)
        label = label.split("(")[0].strip()  # "Melkbarkeit (MS)" -> "Melkbarkeit"
        base = INDEX_LABELS.get(label)
        if base:
            merke(base, zellen[1].get_text(strip=True))
    return out


def enrich_with_exterieur(bulls: list[dict], base_url: str, delay: float = 0.3) -> int:
    """Holt Strichlänge/Stärke für jeden Bullen mit detail_url. Gibt zurück,
    wie viele Bullen tatsächlich angereichert wurden (für die Plausi-Prüfung)."""
    import sys
    enriched = 0
    for bull in bulls:
        url = bull.get("detail_url")
        if not url:
            continue
        if url.startswith("/"):
            url = base_url.rstrip("/") + url
            bull["detail_url"] = url
        traits = fetch_exterieur(url)
        if traits:
            bull.update(traits)
            enriched += 1
        if delay:
            time.sleep(delay)
    print(f"# Exterieur-Merkmale für {enriched}/{len(bulls)} Bullen geholt", file=sys.stderr)
    return enriched


def scrape_pages(pages: list[tuple[str, str]]) -> dict[str, dict]:
    """pages: Liste von (url, kategorie). Liefert {bull_name: raw_entry}."""
    captured: dict[str, dict] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")

        def on_response(response):
            if "getBulls" not in response.url or response.status != 200:
                return
            try:
                body = response.json()
            except Exception:
                return
            row = body.get("row") if isinstance(body, dict) else None
            if not isinstance(row, dict):
                return
            for _, entry in row.items():
                if not isinstance(entry, dict):
                    continue
                spe_name = (entry.get("spe_name") or "").strip()
                if spe_name:
                    captured.setdefault(spe_name, entry)

        page.on("response", on_response)
        for url, _kategorie in pages:
            try:
                page.goto(url, wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(1500)
            except Exception as e:
                import sys
                print(f"# Warnung: {url} konnte nicht geladen werden ({e})", file=sys.stderr)
        browser.close()

    return captured

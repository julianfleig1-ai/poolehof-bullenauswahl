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
from datetime import date

from playwright.sync_api import sync_playwright

# spe_* Rohfeld -> unser normalisierter Feldname. Gilt für alle EasyBull-Stationen.
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
NUMERIC_FIELDS = {
    "rzg", "rzeuro", "rzoeko", "rzm", "tpi", "nm_usd", "milch_kg", "fett_pct",
    "eiweiss_pct", "rzgesund", "rze", "rzkd", "rzrobot", "rzs", "rzn", "rzd", "rzr",
    "rzeuterfit", "rzklaue", "rzddc", "milchtyp", "koerper", "fundament", "euter",
    "strichlaenge_de", "staerke_de", "preis_konv_eur", "preis_gesext_eur",
}


def normalize(raw: dict, firma: str, quelle_url: str, kategorie: str, farbe: str, today: str):
    name = (raw.get("spe_name") or "").strip()
    if not name:
        return None
    rec = {"kategorie": kategorie, "farbe": farbe}
    for src, dst in FIELD_MAP.items():
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
    rec["firma"] = firma
    rec["rasse"] = "Holstein"
    rec["quelle_url"] = quelle_url
    rec["stand"] = today
    rec["vollstaendig"] = "rzs" in rec and "rzd" in rec and "rzr" in rec
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    rec["id"] = f"{firma.lower()}-{slug}"
    return rec


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

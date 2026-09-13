#!/usr/bin/env python3
"""
Zentraler Abruf aller Bullenkataloge - mit Plausibilitätsprüfung.

Das ist der einzige Befehl, der für eine Aktualisierung nötig ist:

    python3 scraper/refresh.py

Was passiert:
  1. Jeder Firmen-Scraper wird einzeln gestartet.
  2. Das Ergebnis wird geprüft (gültiges JSON? genug Bullen? haben die
     Bullen überhaupt Zuchtwerte? nicht plötzlich die Hälfte weniger als
     beim letzten Mal?).
  3. Nur geprüfte Daten ersetzen die alten Dateien. Ist eine Quelle
     kaputt (Website umgebaut, Server weg), bleiben die alten Daten
     stehen - lieber leicht veraltet als leer oder falsch.
  4. docs/data/status.json bekommt für jede Quelle den Status. Die
     Web-App zeigt das oben an, damit ein stiller Ausfall auffällt.
  5. Ist mindestens eine Quelle kaputt, endet das Skript mit Exit-Code 1.
     In der GitHub Action färbt sich der Lauf dadurch rot und GitHub
     schickt automatisch eine Mail an den Repo-Besitzer.

Damit fällt auch der Fall auf, den man sonst übersieht: Die Website
antwortet noch, liefert aber plötzlich Bullen ohne Zuchtwerte.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRAPER_DIR = ROOT / "scraper"
DATA_DIR = ROOT / "data"
WEB_DATA_DIR = ROOT / "docs" / "data"

# Pro Quelle: Skript, Zieldatei, Mindestanzahl Bullen, Mindestanteil Bullen
# mit Gesamtzuchtwert. Die Mindestwerte liegen deutlich unter dem heutigen
# Stand - sie sollen "Website kaputt" erkennen, nicht normale Schwankung.
# Zeitlimits grosszuegig: seit die Einzelmerkmale (Strichlänge, Stärke,
# Melkbarkeit, Fruchtbarkeit) von den Bull-Detailseiten geholt werden, macht
# jeder Scraper ein bis zwei HTTP-Abrufe PRO BULLE - Prismagen z.B. rund 240.
# Lieber langsam durchlaufen als wegen Zeitüberschreitung fälschlich "kaputt".
SOURCES = [
    {"name": "WWS",       "script": "scrape_wws.py",       "file": "wws_bulls.json",       "min_bulls": 50, "min_scored": 0.8, "timeout": 1800},
    {"name": "Prismagen", "script": "scrape_prismagen.py", "file": "prismagen_bulls.json", "min_bulls": 50, "min_scored": 0.8, "timeout": 2400},
    {"name": "Semex",     "script": "scrape_semex.py",     "file": "semex_bulls.json",     "min_bulls": 20, "min_scored": 0.8, "timeout": 1800},
    {"name": "RBW",       "script": "scrape_rbw.py",       "file": "rbw_bulls.json",       "min_bulls": 50, "min_scored": 0.8, "timeout": 2400},
    {"name": "CRI",       "script": "scrape_cri.py",       "file": "cri_bulls.json",       "min_bulls": 40, "min_scored": 0.8, "timeout": 2400},
]

# Ein Bulle "hat Zuchtwerte", wenn eines dieser Gesamtzuchtwert-Felder da ist.
# Jersey rechnet mit JPI, Braunvieh mit PPR statt TPI - sonst würde eine
# gesunde WWS-Liste fälschlich als kaputt gelten.
SCORE_FIELDS = ("rzg", "tpi", "JPI", "PPR", "nm_usd")


def pruefe(bulls, quelle) -> tuple[bool, str]:
    """Plausibilitätsprüfung. Gibt (ok, Meldung) zurück."""
    if not isinstance(bulls, list):
        return False, "Antwort ist keine Liste"
    if len(bulls) < quelle["min_bulls"]:
        return False, f"nur {len(bulls)} Bullen (erwartet mindestens {quelle['min_bulls']}) - Website vermutlich umgebaut"

    ohne_namen = [b for b in bulls if not b.get("name")]
    if ohne_namen:
        return False, f"{len(ohne_namen)} Bullen ohne Namen"

    mit_zw = [b for b in bulls if any(b.get(f) is not None for f in SCORE_FIELDS)]
    anteil = len(mit_zw) / len(bulls)
    if anteil < quelle["min_scored"]:
        return False, (f"nur {len(mit_zw)} von {len(bulls)} Bullen haben einen Gesamtzuchtwert "
                       f"({anteil:.0%}) - Felder der Website haben sich vermutlich geändert")

    return True, f"{len(bulls)} Bullen, {anteil:.0%} mit Gesamtzuchtwert"


def alte_anzahl(dateiname: str) -> int:
    pfad = DATA_DIR / dateiname
    if not pfad.exists():
        return 0
    try:
        return len(json.loads(pfad.read_text(encoding="utf-8")))
    except Exception:
        return 0


def hole_quelle(quelle) -> dict:
    """Startet einen Scraper und prüft das Ergebnis."""
    print(f"\n=== {quelle['name']} ===", flush=True)
    try:
        proc = subprocess.run(
            [sys.executable, str(SCRAPER_DIR / quelle["script"])],
            capture_output=True, text=True, timeout=quelle["timeout"],
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "meldung": f"Zeitüberschreitung nach {quelle['timeout']}s"}

    if proc.stderr.strip():
        print(proc.stderr.strip(), flush=True)
    if proc.returncode != 0:
        return {"ok": False, "meldung": f"Scraper-Fehler (Exit {proc.returncode}): {proc.stderr.strip()[-300:]}"}

    try:
        bulls = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {"ok": False, "meldung": f"Ergebnis ist kein gültiges JSON: {e}"}

    ok, meldung = pruefe(bulls, quelle)
    if not ok:
        return {"ok": False, "meldung": meldung, "anzahl": len(bulls) if isinstance(bulls, list) else 0}

    # Starker Einbruch gegenüber dem letzten Stand = verdächtig
    vorher = alte_anzahl(quelle["file"])
    if vorher and len(bulls) < vorher * 0.5:
        return {"ok": False, "anzahl": len(bulls),
                "meldung": f"Einbruch von {vorher} auf {len(bulls)} Bullen - alte Daten bleiben stehen"}

    # geprüft -> übernehmen
    text = json.dumps(bulls, ensure_ascii=False, indent=2)
    (DATA_DIR / quelle["file"]).write_text(text, encoding="utf-8")
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (WEB_DATA_DIR / quelle["file"]).write_text(text, encoding="utf-8")

    staende = sorted({b.get("stand") for b in bulls if b.get("stand")})
    mit_strich = sum(1 for b in bulls if b.get("strichlaenge_de") is not None or b.get("strichlaenge_us") is not None)
    print(f"OK: {meldung}, {mit_strich} mit Strichlänge", flush=True)
    return {"ok": True, "meldung": meldung, "anzahl": len(bulls),
            "vorher": vorher, "stand": staende[-1] if staende else None,
            "mit_strichlaenge": mit_strich}


def main() -> int:
    nur = sys.argv[1:] or None  # z.B. "python3 refresh.py WWS RBW"
    status = {"lauf": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "datum": date.today().isoformat(), "quellen": {}}

    kaputt = []
    for quelle in SOURCES:
        if nur and quelle["name"] not in nur:
            continue
        ergebnis = hole_quelle(quelle)
        status["quellen"][quelle["name"]] = ergebnis
        if not ergebnis["ok"]:
            kaputt.append(quelle["name"])
            print(f"FEHLER {quelle['name']}: {ergebnis['meldung']}", file=sys.stderr, flush=True)

    status["alles_ok"] = not kaputt
    status["kaputte_quellen"] = kaputt
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (WEB_DATA_DIR / "status.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 50)
    for name, e in status["quellen"].items():
        print(f"{'OK  ' if e['ok'] else 'FEHL'} {name:<10} {e['meldung']}")

    if kaputt:
        print(f"\n{len(kaputt)} Quelle(n) kaputt: {', '.join(kaputt)}", file=sys.stderr)
        print("Alte Daten dieser Quellen bleiben unverändert stehen.", file=sys.stderr)
        return 1
    print("\nAlle Quellen erfolgreich aktualisiert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

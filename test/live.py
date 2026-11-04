# Live-Kurztest der veröffentlichten App (ohne Anmeldung, keine Daten). Aufruf: zsh test/live.sh
# Prüft am PC und am Handy: alle Bereiche öffnen, nichts ragt über den Rand, keine versteckten Fehler,
# Bullendaten und Schlüsseldatei erreichbar, Offline-Helfer aktiv.
import sys, json, time, urllib.request, os
T = os.path.dirname(os.path.abspath(__file__))
exec(open(T + "/cdp.py").read().split("seiten = json.load")[0])
BASIS = sys.argv[1] if len(sys.argv) > 1 else "https://julianfleig1-ai.github.io/poolehof-bullenauswahl/"
c = CDP([p for p in json.load(urllib.request.urlopen("http://127.0.0.1:9333/json")) if p["type"] == "page"][0]["webSocketDebuggerUrl"])
c.rufe("Page.enable")
c.rufe("Page.addScriptToEvaluateOnNewDocument", source="""window.__fehler = [];
  addEventListener('error', e => __fehler.push(String(e.message)));
  addEventListener('unhandledrejection', e => __fehler.push('Promise: ' + String(e.reason && e.reason.message || e.reason)));""")
erg = []
def pruef(name, ok, info=""):
    erg.append((name, bool(ok), "" if ok else str(info)[:200]))
BEREICHE = [("start", "viewStart"), ("bullen", "viewZucht"), ("besamung", "viewZucht"), ("feld", "viewFeld"), ("anleitungen", "viewAnleitungen"), ("anleitungen-guelle", "viewAnleitungen"), ("einstellungen", "viewEinstellungen")]
for geraet, breite, hoehe, mobil in [("PC", 1280, 900, False), ("Handy", 375, 812, True)]:
    c.rufe("Emulation.setDeviceMetricsOverride", width=breite, height=hoehe, deviceScaleFactor=1, mobile=mobil)
    c.rufe("Page.navigate", url=BASIS + "?t=" + str(int(time.time()))); time.sleep(6)
    pruef(f"{geraet}: Seite lädt", c.js("!!document.getElementById('viewStart') && document.title.length > 0"))
    for hash_, view in BEREICHE:
        c.js(f"location.hash = '#{hash_}'"); time.sleep(1.2)
        sichtbar = c.js(f"!document.getElementById('{view}').hidden")
        breit = c.js("document.documentElement.scrollWidth")
        pruef(f"{geraet}: #{hash_} öffnet", sichtbar is True)
        pruef(f"{geraet}: #{hash_} ragt nicht über den Rand", isinstance(breit, int) and breit <= breite + 1, breit)
    pruef(f"{geraet}: Anmeldung angeboten (nicht angemeldet)", c.js("!!document.getElementById('einstPasswort')"))
    fehler = c.js("window.__fehler")
    pruef(f"{geraet}: keine versteckten Fehler", fehler == [], fehler)
pruef("Bullendaten erreichbar", c.js("fetch('data/status.json',{cache:'no-store'}).then(r => r.ok)") is True)
pruef("Bullen geladen", c.js("fetch('data/wws_bulls.json',{cache:'no-store'}).then(r => r.json()).then(d => (Array.isArray(d) ? d : (d.bulls || d.bullen || [])).length)") or 0)
pruef("GitHub-Schlüsseldatei erreichbar (verschlüsselt)", c.js("fetch('github-zugang.json',{cache:'no-store'}).then(r => r.json()).then(d => d.art === 'poolehof-github-zugang' && !!d.daten && !('token' in d))") is True)
pruef("Anleitungen-Daten erreichbar", c.js("fetch('anleitungen/daten.json',{cache:'no-store'}).then(r => r.json()).then(d => d.anleitungen.length)") or 0)
pruef("Speicher-Art GitHub", c.js("HS_MODUS") == "github")
pruef("Offline-Helfer aktiv", c.js("navigator.serviceWorker.getRegistration().then(r => !!r)") is True)
fehl = [e for e in erg if not e[1]]
for n, ok, info in erg:
    if not ok: print("  ✗", n, "→", info)
print(f"{len(erg) - len(fehl)} bestanden, {len(fehl)} fehlgeschlagen")
sys.exit(1 if fehl else 0)

# Prüft die E-Rechnungen der App mit dem amtlichen KoSIT-Prüfprogramm (XRechnung 3.0.2)
import sys, json, time, urllib.request, os, subprocess, re
T = os.path.dirname(os.path.abspath(__file__))
exec(open(T + "/cdp.py").read().split("seiten = json.load")[0])
c = CDP([p for p in json.load(urllib.request.urlopen("http://127.0.0.1:9333/json")) if p["type"] == "page"][0]["webSocketDebuggerUrl"])
c.rufe("Page.navigate", url="http://127.0.0.1:8777/index.html?hofspeicher=http://127.0.0.1:8779/#feld"); time.sleep(4)
r = c.rufe("Runtime.evaluate", expression=open(T + "/erechnung_daten.js").read(), awaitPromise=True, returnByValue=True, timeout=120000)
werte = r.get("result", {}).get("result", {}).get("value")
if not werte: print("FEHLER:", json.dumps(r)[:800]); sys.exit(1)
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for w in werte:
    open(f"{out}/{w['name']}.xml", "w").write(w["xml"])
    if w["fehlt"]: print(w["name"], "Fehlende Angaben laut App:", w["fehlt"])
W = sys.argv[2]
java = [l for l in subprocess.run(["find", W + "/jre", "-name", "java", "-path", "*bin*"], capture_output=True, text=True).stdout.split() if l][0]
erg = subprocess.run([java, "-jar", W + "/validator-standalone.jar", "-s", W + "/conf/scenarios.xml", "-r", W + "/conf", "-o", out, "-h"] + [f"{out}/{w['name']}.xml" for w in werte], capture_output=True, text=True)
ok = 0
for w in werte:
    bericht = open(f"{out}/{w['name']}-report.xml").read() if os.path.exists(f"{out}/{w['name']}-report.xml") else ""
    akzeptiert = 'acceptRecommendation>ACCEPT' in bericht.replace(":", "").replace("rep", "") or re.search(r"<rep:assessment>\s*<rep:accept", bericht)
    fehler = re.findall(r'<rep:message[^>]*level="(error|warning)"[^>]*code="([^"]+)"[^>]*>(.*?)</rep:message>', bericht, re.S)
    print(("✓ gültig" if akzeptiert else "✗ NICHT gültig"), w["name"], f"({w['brutto']} €)")
    for lvl, code, txt in fehler: print("   ", lvl, code, re.sub(r"\s+", " ", txt)[:220])
    ok += 1 if akzeptiert else 0
print(f"ERGEBNIS: {ok}/{len(werte)} E-Rechnungen vom amtlichen Prüfprogramm akzeptiert")
sys.exit(0 if ok == len(werte) else 1)

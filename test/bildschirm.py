# Bildschirmfoto einer App-Seite (zum Ansehen am Handy-/PC-Format).
# Aufruf: python3 test/bildschirm.py <url> <breite> <hoehe> <datei.png> [javascript-vorher] [ganzeSeite=1]
# Braucht einen laufenden headless Edge auf Port 9333 (siehe test/live.sh).
import sys, json, time, base64, urllib.request, os
T = os.path.dirname(os.path.abspath(__file__))
exec(open(T + "/cdp.py").read().split("seiten = json.load")[0])
url, breite, hoehe, datei = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
js = sys.argv[5] if len(sys.argv) > 5 else ""
ganz = len(sys.argv) > 6 and sys.argv[6] == "1"
c = CDP([p for p in json.load(urllib.request.urlopen("http://127.0.0.1:9333/json")) if p["type"] == "page"][0]["webSocketDebuggerUrl"])
c.rufe("Emulation.setDeviceMetricsOverride", width=breite, height=hoehe, deviceScaleFactor=2, mobile=breite < 700)
c.rufe("Page.navigate", url=url); time.sleep(4)
if js: print(c.js(js)); time.sleep(1.5)
breit = c.js("document.documentElement.scrollWidth")
opt = {"format": "png"}
if ganz:
    h = c.js("document.documentElement.scrollHeight")
    opt.update(captureBeyondViewport=True, clip={"x": 0, "y": 0, "width": breite, "height": min(h, 6000), "scale": 1})
r = c.rufe("Page.captureScreenshot", **opt)
open(datei, "wb").write(base64.b64decode(r["result"]["data"]))
print("Breite", breit, "von", breite)

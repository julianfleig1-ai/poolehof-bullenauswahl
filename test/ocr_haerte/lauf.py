import sys, json, time, base64, urllib.request
exec(open(sys.argv[1]).read().split("seiten = json.load")[0])
H = sys.argv[2]
c = CDP([p for p in json.load(urllib.request.urlopen("http://127.0.0.1:9333/json")) if p["type"] == "page"][0]["webSocketDebuggerUrl"])
var = json.load(open(H + "/varianten.json"))
nur = sys.argv[3].split(",") if len(sys.argv) > 3 else None
for v in var:
    if nur and str(v["id"]) not in nur: continue
    c.rufe("Emulation.setDeviceMetricsOverride", width=1150, height=400, deviceScaleFactor=v["dsf"], mobile=False)
    c.rufe("Page.navigate", url=f"http://127.0.0.1:8780/v{v['id']}.html"); time.sleep(1.5)
    hoehe = c.js("document.body.scrollHeight")
    c.rufe("Emulation.setDeviceMetricsOverride", width=1150, height=int(hoehe) + 4, deviceScaleFactor=v["dsf"], mobile=False); time.sleep(0.8)
    r = c.rufe("Page.captureScreenshot", format="png")
    open(f"{H}/v{v['id']}.png", "wb").write(base64.b64decode(r["result"]["data"]))
c.rufe("Emulation.setDeviceMetricsOverride", width=1280, height=900, deviceScaleFactor=1, mobile=False)
c.rufe("Page.navigate", url="http://127.0.0.1:8777/index.html#besamung"); time.sleep(4)
gesamtFalsch = [0]
for v in var:
    if nur and str(v["id"]) not in nur: continue
    r = c.rufe("Runtime.evaluate", expression=f"""(async()=>{{
      const csv = await (await fetch('http://127.0.0.1:8780/netrind.csv')).text();
      herde = null; uebernehmeTabelle(parseCSV(csv), 'netrind.csv');
      const png = await (await fetch('http://127.0.0.1:8780/v{v['id']}.png')).blob();
      const t0 = Date.now(); window.__ocrLog = [];
      const e = await tiereAusBild(new File([png], 'x.png', {{type: 'image/png'}}));
      return JSON.stringify({{s: (Date.now() - t0) / 1000, kal: e.kalibriert, gesamt: e.gesamt, tiere: e.tiere, unlesbar: (e.unlesbar||[]).length}});
    }})()""", awaitPromise=True, returnByValue=True, timeout=600000)
    val = r.get("result", {}).get("result", {}).get("value")
    if not val: print(v["id"], "FEHLER", json.dumps(r)[:600]); continue
    e = json.loads(val)
    ist = {t["key"]: t for t in e["tiere"]}
    falschSicher, unsicher, fehlt, ohrFalsch = [], [], [], []
    for z in v["soll"]:
        t = ist.get(z["key"])
        if not t: fehlt.append(z["key"] + "/" + z["nr"]); continue
        if t["sicher"] and t["nr"] != z["nr"]: falschSicher.append(f"{z['nr']}→{t['nr']}")
        elif not t["sicher"]: unsicher.append(f"{z['nr']}→{t['nr']}({t.get('hinweis','')})")
    sollKeys = {z["key"] for z in v["soll"]}
    erfunden = [k for k in ist if k not in sollKeys]
    gesamtFalsch[0] += len(falschSicher) + len(erfunden)
    print(f"V{v['id']} {v['font']} {v['size']}px {int(v['dsf']*100)}% {v['zeilen']} Zeilen{' ohne Kopf' if not v['kopf'] else ''}: {e['s']:.0f}s kal={e['kal']} unlesbar={e['unlesbar']} gesamt={e['gesamt']} | gelesen {len(ist)}/{v['zeilen']} | FALSCH-SICHER {len(falschSicher)} {falschSicher[:5]} | unsicher {len(unsicher)} {unsicher[:6]} | fehlt {len(fehlt)} {fehlt[:4]} | Ohrmarke falsch gelesen {len(erfunden)} {erfunden[:4]}")
print("ERGEBNIS:", "OK – kein falscher Wert als sicher" if gesamtFalsch[0] == 0 else f"FEHLER – {gesamtFalsch[0]} falsche Werte")
sys.exit(1 if gesamtFalsch[0] else 0)

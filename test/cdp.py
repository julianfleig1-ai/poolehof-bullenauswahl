# Minimaler Chrome-DevTools-Client (nur Standardbibliothek) für den Offline-Test.
import socket, base64, os, json, struct, sys, time, urllib.request
class CDP:
    def __init__(self, ws_url):
        host_port, pfad = ws_url[len("ws://"):].split("/", 1)
        host, port = host_port.split(":")
        self.s = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.send(f"GET /{pfad} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        antwort = b""
        while b"\r\n\r\n" not in antwort: antwort += self.s.recv(1)
        self.n = 0
    def _senden(self, text):
        data = text.encode(); kopf = bytearray([0x81]); maske = os.urandom(4); l = len(data)
        if l < 126: kopf.append(0x80 | l)
        elif l < 65536: kopf.append(0x80 | 126); kopf += struct.pack(">H", l)
        else: kopf.append(0x80 | 127); kopf += struct.pack(">Q", l)
        self.s.send(bytes(kopf) + maske + bytes(b ^ maske[i % 4] for i, b in enumerate(data)))
    def _lesen(self):
        def genau(n):
            b = b""
            while len(b) < n: b += self.s.recv(n - len(b))
            return b
        h = genau(2); l = h[1] & 0x7f
        if l == 126: l = struct.unpack(">H", genau(2))[0]
        elif l == 127: l = struct.unpack(">Q", genau(8))[0]
        return json.loads(genau(l).decode())
    def rufe(self, methode, **params):
        self.n += 1; mid = self.n
        self._senden(json.dumps({"id": mid, "method": methode, "params": params}))
        while True:
            m = self._lesen()
            if m.get("id") == mid: return m
    def js(self, ausdruck):
        r = self.rufe("Runtime.evaluate", expression=ausdruck, awaitPromise=True, returnByValue=True)
        return r.get("result", {}).get("result", {}).get("value", r)
seiten = json.load(urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/json"))
seite = [p for p in seiten if p["type"] == "page"][0]
c = CDP(seite["webSocketDebuggerUrl"])
befehl = sys.argv[2]
if befehl == "laden":
    c.rufe("Page.navigate", url=sys.argv[3]); time.sleep(4)
    print(c.js("navigator.serviceWorker.ready.then(async r => JSON.stringify({aktiv: !!r.active, steuert: !!navigator.serviceWorker.controller, caches: await caches.keys(), eintraege: (await (await caches.open('poolehof-v1')).keys()).length}))"))
elif befehl == "neu":
    c.rufe("Page.reload", ignoreCache=False); time.sleep(5)
    print(c.js("JSON.stringify({titel: document.title, feldbuch: typeof fbSichtBerechnen, bullen: document.querySelectorAll('#tabBullen tbody tr').length, steuert: !!navigator.serviceWorker.controller, logo: (document.querySelector('.brand img, img[src*=logo]')||{}).complete})"))
if befehl == "test":
    url, jsdatei = sys.argv[3], sys.argv[4]
    c.rufe("Page.enable")
    c.rufe("Page.addScriptToEvaluateOnNewDocument", source="window.__fehler=[];addEventListener('error',e=>__fehler.push(String(e.message)+' @'+(e.filename||'')+':'+(e.lineno||'')));addEventListener('unhandledrejection',e=>__fehler.push('Promise: '+String(e.reason&&e.reason.message||e.reason)));const _ce=console.error;console.error=(...a)=>{__fehler.push('console.error: '+a.join(' '));_ce(...a)};")
    c.rufe("Emulation.setDeviceMetricsOverride", width=1280, height=900, deviceScaleFactor=1, mobile=False)
    c.rufe("Page.navigate", url=url); time.sleep(4)
    r = c.rufe("Runtime.evaluate", expression=open(jsdatei).read(), awaitPromise=True, returnByValue=True, timeout=240000)
    werte = r.get("result", {}).get("result", {}).get("value")
    if werte is None: print("TESTLAUF FEHLER:", json.dumps(r)[:1500]); sys.exit(1)
    ok = [w for w in werte if w["ok"]]; nok = [w for w in werte if not w["ok"]]
    print(f"Desktop: {len(ok)} bestanden, {len(nok)} fehlgeschlagen")
    for w in nok: print("  ✗", w["name"], "→", w["info"])
    # Handy-Breite: jeder Reiter, nichts darf seitlich überstehen
    c.rufe("Emulation.setDeviceMetricsOverride", width=375, height=812, deviceScaleFactor=2, mobile=True)
    c.rufe("Page.reload"); time.sleep(4)
    print("Handy:", c.js("""(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const out=[];for(const t of FB_TABS){fbZeigeTab(t);await w(300);const sw=document.documentElement.scrollWidth;out.push(t+(sw>innerWidth?' ✗ steht über ('+sw+'px)':' ok'));}
      fbRechnungZeigen({nr:'2026-001',datum:fbHeuteIso(),positionen:[{datum:fbHeuteIso(),text:'Test',menge:1,einheit:'h',preis:10,betrag:10}],netto:10,mwstSatz:.19,mwst:1.9,brutto:11.9,firma:fbDaten.firmen[0],mandant:fbDaten.mandanten[1]});await w(300);
      out.push('Rechnungsansicht'+(document.documentElement.scrollWidth>innerWidth?' ✗ steht über':' ok'));$fb('reZu').click();
      navigiere('einstellungen');await w(300);out.push('Einstellungen'+(document.documentElement.scrollWidth>innerWidth?' ✗ steht über':' ok'));
      navigiere('zucht');await w(300);out.push('Zuchtplanung'+(document.documentElement.scrollWidth>innerWidth?' ✗ steht über':' ok'));navigiere('feld');
      return out.join(' | ')})()"""))
    print("Versteckte Fehlermeldungen:", c.js("JSON.stringify(window.__fehler)"))

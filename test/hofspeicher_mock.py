# Lokaler Nachbau von hofspeicher/api/herde.js (gleiches Protokoll) zum Testen.
# Test-Passwort ist NUR fuer diesen lokalen Test: "test-4711".
import http.server, json, hashlib, uuid
SALZ = "poolehof-hofspeicher-v1"
auth = hashlib.sha256(f"{SALZ}:auth:test-4711".encode()).hexdigest()
SOLL = hashlib.sha256(auth.encode()).hexdigest()
SPEICHER = {"herde": [], "feldbuch": []}   # neueste zuerst: (version, daten)
BEHALTEN = {"herde": 1, "feldbuch": 30}
ZUGANG = {"soll": SOLL, "verfahren": "v1"}
class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        o = self.headers.get("Origin", "")
        if o in ("http://127.0.0.1:8777", "http://localhost:8777"):
            self.send_header("Access-Control-Allow-Origin", o)
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self._cors()
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self):
        if "verfahren" in self.path: return self._json(200, {"ok": True, "verfahren": ZUGANG["verfahren"]})
        self._json(200, {**{k: len(v) for k, v in SPEICHER.items()}, "verfahren": ZUGANG["verfahren"]})  # nur fuer Tests
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        ist = hashlib.sha256(str(body.get("schluessel", "")).encode()).hexdigest()
        if ist != ZUGANG["soll"]: return self._json(401, {"ok": False, "fehler": "Passwort falsch"})
        if body.get("aktion") == "passwortAendern":
            neu = body.get("neu") or {}
            fb = SPEICHER["feldbuch"]
            if (fb[0][0] if fb else None) != (body.get("feldbuchVersion") or None):
                return self._json(409, {"ok": False, "konflikt": True, "fehler": "Feldbuch geändert"})
            vers = {}
            for f in ("herde", "feldbuch"):
                d = (body.get("daten") or {}).get(f)
                if d:
                    v = f"{f}/liste-{uuid.uuid4().hex[:10]}.json"; SPEICHER[f].insert(0, (v, d)); del SPEICHER[f][BEHALTEN[f]:]; vers[f] = v
            ZUGANG["soll"] = neu["pruefwert"]; ZUGANG["verfahren"] = "v2"
            return self._json(200, {"ok": True, "versionen": vers})
        fach = body.get("fach") or "herde"
        if fach not in SPEICHER: return self._json(400, {"ok": False, "fehler": "Unbekanntes Fach"})
        liste = SPEICHER[fach]
        if body.get("aktion") == "laden":
            return self._json(200, {"ok": True, "daten": liste[0][1] if liste else None, "version": liste[0][0] if liste else None})
        if body.get("aktion") == "speichern":
            d = body.get("daten") or {}
            if d.get("v") != 1 or not isinstance(d.get("daten"), str): return self._json(400, {"ok": False, "fehler": "Ungültige Daten"})
            if "erwarteteVersion" in body and (liste[0][0] if liste else None) != (body["erwarteteVersion"] or None):
                return self._json(409, {"ok": False, "konflikt": True, "fehler": "Inzwischen von einem anderen Gerät geändert"})
            v = f"{fach}/liste-{uuid.uuid4().hex[:10]}.json"
            liste.insert(0, (v, d)); del liste[BEHALTEN[fach]:]
            return self._json(200, {"ok": True, "version": v})
        return self._json(400, {"ok": False, "fehler": "Unbekannte Aktion"})
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", 8779), H).serve_forever()

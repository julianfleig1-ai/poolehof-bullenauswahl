#!/bin/zsh
# Automatischer Komplett-Test des Feldbuchs (nur Testdaten, lokale Attrappe des Hof-Speichers,
# Test-Passwort "test-4711" gilt NUR für die Attrappe). Aufruf: test/start.sh
set -e
T="${0:A:h}"; R="${T:h}"; P="$(mktemp -d)"
python3 "$T/cors_srv.py" "$R/docs" 8777 >/dev/null 2>&1 & W=$!
python3 "$T/hofspeicher_mock.py" >/dev/null 2>&1 & H=$!
python3 "$T/cors_srv.py" "$T/testdaten" 8778 >/dev/null 2>&1 & D=$!
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --remote-debugging-port=9333 --user-data-dir="$P" --no-first-run about:blank >/dev/null 2>&1 & E=$!
sleep 4
python3 "$T/cdp.py" 9333 test "http://127.0.0.1:8777/index.html?hofspeicher=http://127.0.0.1:8779/#feld" "$T/feldbuch_e2e.js" || true
kill $W $H $D $E 2>/dev/null; rm -rf "$P"

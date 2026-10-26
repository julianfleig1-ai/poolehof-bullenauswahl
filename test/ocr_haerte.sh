#!/bin/zsh
# Härtetest der Lely-Screenshot-Erkennung (nur erfundene Kühe). Aufruf: test/ocr_haerte.sh
# Kriterium: kein einziger falscher Wert darf als "sicher" durchgehen.
T="${0:A:h}"; R="${T:h}"; P="$(mktemp -d)"; O="$(mktemp -d)"
python3 "$T/ocr_haerte/gen.py" >/dev/null && mv "$T/ocr_haerte/"v*.html "$T/ocr_haerte/varianten.json" "$T/ocr_haerte/netrind.csv" "$O/"
python3 "$T/cors_srv.py" "$R/docs" 8777 >/dev/null 2>&1 & W=$!
python3 "$T/cors_srv.py" "$O" 8780 >/dev/null 2>&1 & D=$!
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --remote-debugging-port=9333 --user-data-dir="$P" --no-first-run about:blank >/dev/null 2>&1 & E=$!
sleep 4
python3 "$T/ocr_haerte/lauf.py" "$T/cdp.py" "$O"; ERG=$?
python3 "$T/ocr_haerte/lauf.py" "$T/cdp.py" "$O" 0,7 | tail -3
kill $W $D $E 2>/dev/null; sleep 1; rm -rf "$P" "$O"
exit $ERG

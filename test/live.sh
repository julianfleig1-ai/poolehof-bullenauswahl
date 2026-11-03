#!/bin/zsh
# Live-Kurztest nach jedem Hochladen (veröffentlichte Seite, ohne Anmeldung). Aufruf: zsh test/live.sh
T="${0:A:h}"; P="$(mktemp -d)"
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --remote-debugging-port=9333 --user-data-dir="$P" --no-first-run about:blank >/dev/null 2>&1 & E=$!
sleep 4
python3 "$T/live.py" "$@"; ERG=$?
kill $E 2>/dev/null; sleep 1; rm -rf "$P" 2>/dev/null
exit $ERG

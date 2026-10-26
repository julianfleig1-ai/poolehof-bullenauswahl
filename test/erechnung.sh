#!/bin/zsh
# E-Rechnungen der App mit dem amtlichen KoSIT-Prüfprogramm (XRechnung 3.0.2) prüfen – nur erfundene Daten.
# Beim ersten Mal werden Java (Adoptium) und das Prüfprogramm (KoSIT, GitHub) nach test/.werkzeuge geladen.
T="${0:A:h}"; R="${T:h}"; W="$T/.werkzeuge"; P="$(mktemp -d)"; O="$(mktemp -d)"
if [ ! -f "$W/validator-standalone.jar" ]; then
  mkdir -p "$W/jre" "$W/conf"
  curl -sL -o "$W/jre.tar.gz" "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.13_9.tar.gz" && tar -xzf "$W/jre.tar.gz" -C "$W/jre"
  curl -sL -o "$W/validator-standalone.jar" "https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar"
  curl -sL -o "$W/conf.zip" "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip" && unzip -q -o "$W/conf.zip" -d "$W/conf"
fi
python3 "$T/cors_srv.py" "$R/docs" 8777 >/dev/null 2>&1 & S=$!
python3 "$T/hofspeicher_mock.py" >/dev/null 2>&1 & H=$!
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --remote-debugging-port=9333 --user-data-dir="$P" --no-first-run about:blank >/dev/null 2>&1 & E=$!
sleep 4
python3 "$T/erechnung.py" "$O" "$W"; ERG=$?
[ -n "$ERECHNUNG_BEHALTEN" ] && cp "$O"/*.xml "$ERECHNUNG_BEHALTEN"/ 2>/dev/null
kill $S $H $E 2>/dev/null; sleep 1; rm -rf "$P" "$O"
exit $ERG

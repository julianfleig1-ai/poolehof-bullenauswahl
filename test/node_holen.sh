#!/bin/zsh
# Node.js (offizielle Quelle nodejs.org) für die Tests nach test/.werkzeuge/node holen, falls noch nicht da
W="${0:A:h}/.werkzeuge"
if [ ! -x "$W/node/bin/node" ]; then
  V=$(curl -s https://nodejs.org/dist/index.json | python3 -c "import json,sys; print([r['version'] for r in json.load(sys.stdin) if r['version'].startswith('v24.') and r['lts']][0])")
  mkdir -p "$W/node" && curl -sL "https://nodejs.org/dist/$V/node-$V-darwin-arm64.tar.gz" | tar xz -C "$W/node" --strip-components=1
fi
echo "$W/node/bin/node"

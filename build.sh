#!/bin/sh
# Bundle the cards into the single file the Marketplace installs.
set -eu
cd "$(dirname "$0")"
for f in src/personal-room-card.js src/personal-commute-card.js src/personal-agenda-card.js src/personal-birthday-card.js; do cat "$f"; printf '\n'; done > dist/personal-room-card.js

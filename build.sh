#!/bin/sh
# Bundle both cards into the single file the Marketplace installs.
set -eu
cd "$(dirname "$0")"
{ cat src/personal-room-card.js; printf '\n'; cat src/personal-commute-card.js; } > dist/personal-room-card.js

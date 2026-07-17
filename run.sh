#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "🧬 AADNA Local CMS запускается..."
xdg-open http://localhost:4400 2>/dev/null || open http://localhost:4400 2>/dev/null &
node server.js

#!/bin/sh
set -e

# Start Node.js server for manifest.json API in background
node /app/manifest-server.js &

# Start nginx in foreground
exec nginx -g 'daemon off;'

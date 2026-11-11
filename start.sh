#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
[ -f config.yaml ] || cp config.example.yaml config.yaml
cd frontend
[ -d node_modules ] || npm ci
npm run build
cd ../backend
exec go run ./cmd/server -config ../config.yaml "$@"

#!/usr/bin/env sh
# One command to run the app: npm start (or ./start.sh)
#   npm run setup (./start.sh --setup) only checks Node and installs dependencies, e.g. before npm run dev
#   - Node 20.19+ / 22.12+ → install dependencies if needed, build, serve (opens the browser)
#   - Node too old, Docker running → build and run the same thing in a container
#   - otherwise → explain what to install
set -eu
cd "$(dirname "$0")"

PORT="${PORT:-4173}"
URL="http://localhost:$PORT/"

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit((a === 20 && b >= 19) || (a === 22 && b >= 12) || a >= 23 ? 0 : 1)'
}

# npm writes node_modules/.package-lock.json on every install; if the lockfile is newer, dependencies changed.
deps_ok() {
  [ -f node_modules/.package-lock.json ] && [ ! package-lock.json -nt node_modules/.package-lock.json ]
}

open_browser() {
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"
  fi >/dev/null 2>&1 || true
}

if node_ok; then
  if deps_ok; then
    echo "▶ Dependencies up to date"
  else
    echo "▶ Installing dependencies"
    npm install --no-audit --no-fund
  fi
  if [ "${1:-}" = "--setup" ]; then
    echo "✔ Setup done. Run: npm start (production build) or npm run dev (dev server with hot reload), both at $URL"
    exit 0
  fi
  # Always rebuild (~0.3s) so a code change or git pull is never served from an old build.
  echo "▶ Building"
  npx vite build --logLevel warn
  echo "▶ Serving the production build at $URL (Ctrl+C to stop)"
  exec npx vite preview --port "$PORT" --strictPort --open
fi

if [ "${1:-}" = "--setup" ]; then
  echo "✖ Setup needs Node 20.19+ or 22.12+ (https://nodejs.org). Without it, npm start can still run the app with Docker." >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if command -v node >/dev/null 2>&1; then echo "▶ Node $(node -v) is too old (need 20.19+ or 22.12+), using Docker instead"
  else echo "▶ Node not found, using Docker"; fi
  docker build -t sales-pipeline .
  echo "▶ Serving at $URL (Ctrl+C to stop)"
  (sleep 2 && open_browser "$URL") &
  if [ -t 0 ]; then TTY="-it"; else TTY=""; fi
  # shellcheck disable=SC2086
  exec docker run --rm --init $TTY -p "$PORT:4173" sales-pipeline
fi

echo "✖ Can't start: this needs Node 22 (https://nodejs.org), or Docker running (https://docs.docker.com/get-docker/)." >&2
exit 1

#!/bin/bash
# Startup script for fietsroute services.
# Used by the init.d service and cron @reboot to ensure services survive reboots.

set -euo pipefail

PROJECT_DIR="/workspace/project/fietsroute"
ENV_FILE="$PROJECT_DIR/.env"

# Source environment
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

# ── PostgreSQL ───────────────────────────────────────────────────────────
echo "Starting PostgreSQL..."
pg_ctlcluster 17 main start 2>/dev/null || true

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
    if pg_isready -q 2>/dev/null; then
        echo "PostgreSQL is ready."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "ERROR: PostgreSQL failed to start within 30 seconds."
        exit 1
    fi
    sleep 1
done

# ── API Server ───────────────────────────────────────────────────────────
cd "$PROJECT_DIR"
API_PORT="${API_PORT:-8080}"
export PORT="$API_PORT"
export NODE_ENV="${NODE_ENV:-production}"
export DATABASE_URL="${DATABASE_URL:-}"
export CLERK_SECRET_KEY="${CLERK_SECRET_KEY:-}"
export CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export DISABLE_NETWORK_PRELOAD="${DISABLE_NETWORK_PRELOAD:-1}"

echo "Starting API server on port $API_PORT..."
nohup node --enable-source-maps "$PROJECT_DIR/artifacts/api-server/dist/index.mjs" \
    PORT="$API_PORT" >> /tmp/fietsroute-logs/api-server.log 2>&1 &
echo "API server PID: $!"

# Wait for API server to be ready
echo "Waiting for API server..."
for i in $(seq 1 30); do
    if curl -s "http://127.0.0.1:$API_PORT/api/healthz" > /dev/null 2>&1; then
        echo "API server is ready."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "WARNING: API server may not be ready yet (port $API_PORT)."
        break
    fi
    sleep 1
done

# ── Nginx ────────────────────────────────────────────────────────────────
echo "Starting nginx on ports 80 and 8011..."
sudo cp "$PROJECT_DIR/deploy/selfhost/nginx.conf" /etc/nginx/sites-available/fietsroute
sudo nginx

# ── API Proxy (expose API through host-mapped port 8012) ────────────────
# Kill stale proxies first
pkill -f "proxy-api.cjs" 2>/dev/null || true
sleep 1

echo "Starting API proxy on port 8012..."
nohup node "$PROJECT_DIR/scripts/proxy-api.cjs" \
    > /tmp/fietsroute-logs/proxy-api.log 2>&1 &
echo "API proxy PID: $!"

echo "=========================================="
echo "  fietsroute is running!"
echo "  Frontend (LAN): http://192.168.1.85:36181  (host→8011→80)"
echo "  API (LAN):      http://192.168.1.85:40863  (host→8012→8080)"
echo "  Frontend (local): http://localhost:80"
echo "  API (local):      http://localhost:8080"
echo "=========================================="

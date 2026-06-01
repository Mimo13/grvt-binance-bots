#!/bin/bash
set -e

# Retry logic for sqlite3 GLIBC compatibility issue
# If the pre-compiled binary fails, rebuild from source
MAX_RETRIES=2
RETRY_COUNT=0

rebuild_sqlite3() {
    echo "[entrypoint] GLIBC error detected — rebuilding sqlite3 from source..."
    npm rebuild sqlite3 --build-from-source
    echo "[entrypoint] sqlite3 rebuilt successfully"
}

start_server() {
    echo "[entrypoint] Starting GRVT Grid bot..."
    exec node dist/dashboard/server.js
}

# Try starting, rebuild on GLIBC error
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    start_server &
    SERVER_PID=$!

    # Wait a few seconds for the server to start or fail
    sleep 5

    # Check if server process is still running
    if kill -0 $SERVER_PID 2>/dev/null; then
        wait $SERVER_PID
        exit $?
    fi

    # Check logs for GLIBC error
    if docker logs grvt-grid-bot 2>&1 | grep -q "GLIBC.*not found"; then
        echo "[entrypoint] Server failed with GLIBC error — attempting rebuild..."
        kill $SERVER_PID 2>/dev/null || true
        rebuild_sqlite3
        RETRY_COUNT=$((RETRY_COUNT + 1))
    else
        break
    fi
done

start_server
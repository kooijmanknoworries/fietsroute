#!/bin/bash
### BEGIN INIT INFO
# Provides:          fietsroute
# Required-Start:    $all
# Required-Stop:     $all
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Fietsroute cycling route planner
### END INIT INFO

case "$1" in
    start)
        /workspace/project/fietsroute/scripts/start.sh
        ;;
    stop)
        nginx -s stop 2>/dev/null || true
        pkill -f "dist/index.mjs" 2>/dev/null || true
        pkill -f "proxy.cjs" 2>/dev/null || true
        pg_ctlcluster 17 main stop 2>/dev/null || true
        echo "fietsroute stopped."
        ;;
    restart)
        $0 stop
        sleep 2
        $0 start
        ;;
    status)
        if pg_isready -q 2>/dev/null; then echo "PostgreSQL: running"; else echo "PostgreSQL: stopped"; fi
        if curl -s "http://127.0.0.1:8080/api/healthz" > /dev/null 2>&1; then echo "API server: running"; else echo "API server: stopped"; fi
        if nginx -t 2>/dev/null && pgrep -x nginx > /dev/null; then echo "nginx: running"; else echo "nginx: stopped"; fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

#!/bin/sh
# Stops the app server. Double-click in Finder, or: ./stop.command 4322
# Grant permission once: chmod +x stop.command
PORT="${1:-4321}"

# -sTCP:LISTEN, because `lsof -ti tcp:PORT` also lists processes merely
# CONNECTED to it. With the app open in a browser that is the browser, and
# the loop below refuses to kill it and exits before reaching the server.
PIDS=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null)
if [ -z "$PIDS" ]; then
  echo "Nothing was listening on port $PORT - the app is not running."
  exit 0
fi

for pid in $PIDS; do
  # Do not kill someone else's process just because it took this port.
  if ps -p "$pid" -o command= | grep -q 'server/index.mjs'; then
    kill "$pid" && echo "Stopped (PID $pid)."
  else
    echo "Port $PORT is held by something else (PID $pid). Leaving it alone."
    exit 1
  fi
done
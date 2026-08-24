#!/bin/sh
# Stops the app server. Double-click in Finder, or: ./stop.command [PORT]
# Grant permission once: chmod +x stop.command
#
# With no argument it stops EVERY solo-ops server on this machine, not just the
# default port. Instances started on another port (a dev run, a test) share the
# same data directory, and each keeps its own in-memory snapshot of the files.
# Left running they invalidate each other's snapshots, and the app starts
# refusing writes with "This file changed outside the app".

if [ -n "$1" ]; then
  PORT="$1"
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
  exit 0
fi

# -f matches the full command line, so this finds the server whatever port it took.
PIDS=$(pgrep -f 'node .*server/index\.mjs' 2>/dev/null)
if [ -z "$PIDS" ]; then
  echo "No solo-ops server is running."
  exit 0
fi

for pid in $PIDS; do
  # -a matters: without it lsof ORs the selectors and lists every listening socket on
  # the machine next to this process's files, so the message names a stranger's port.
  PORT=$(lsof -a -nP -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk '/LISTEN/ {split($9,a,":"); print a[2]; exit}')
  kill "$pid" && echo "Stopped (PID $pid${PORT:+, port $PORT})."
done

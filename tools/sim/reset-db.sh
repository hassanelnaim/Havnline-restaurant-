#!/bin/bash
# Fresh database + restart PostgREST/gateway so caches are clean.
cd /home/claude/sim
./load-schema.sh > /tmp/claude-0/load.txt 2>&1 || { grep -B2 ERROR /tmp/claude-0/load.txt; exit 1; }
grep -B2 ERROR /tmp/claude-0/load.txt && exit 1
./start-db.sh > /dev/null
echo "db reset ($(grep -c '^==' /tmp/claude-0/load.txt) migrations)"

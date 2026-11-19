#!/bin/bash
# Start PostgREST and the Supabase gateway (Postgres must already be running).
cd /home/claude/sim
pkill -f 'tools/postgrest' ; pkill -f 'node gateway.mjs'; sleep 0.5
nohup /home/claude/tools/postgrest postgrest.conf > logs-postgrest.txt 2>&1 &
nohup node gateway.mjs > logs-gateway.txt 2>&1 &
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3001/ && curl -s -o /dev/null http://127.0.0.1:54321/__auth/stats && break; sleep 0.3; done
echo started

#!/bin/bash
# Recreate the havnline database: bootstrap + base schema + all migrations in order.
set -e
P="psql -h 127.0.0.1 -p 54322 -U postgres -v ON_ERROR_STOP=1 -q"
psql -h 127.0.0.1 -p 54322 -U postgres -q -c "drop database if exists havnline with (force)" -c "create database havnline" -c "alter database havnline set timezone to 'UTC'"
psql -h 127.0.0.1 -p 54322 -U postgres -q -c "drop role if exists authenticator" -c "drop owned by anon, authenticated, service_role cascade" -c "drop role if exists anon" -c "drop role if exists authenticated" -c "drop role if exists service_role" 2>/dev/null || true
$P -d havnline -f /home/claude/sim/bootstrap.sql
grep -vE '^\\(un)?restrict|^SET transaction_timeout' /home/claude/sim/base-schema.sql > /tmp/schema16.sql
$P -d havnline -f /tmp/schema16.sql
# The dump already holds tables that migrations 007 and 009 create; let the migrations own them.
$P -d havnline -c "drop table if exists public.reviews, public.rate_limit_hits cascade"
for f in /home/claude/havnline-restaurant/base-clone/lib/database/migrations/*.sql; do
  echo "== $(basename $f)"
  # 010 alters the appointments table that 001 dropped and 015 removes for good; obsolete on a fresh database.
  case "$(basename $f)" in 010_*) echo skip; continue;; esac
  $P -d havnline -f "$f"
done

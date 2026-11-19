#!/bin/bash
# Copy the repo's current code into the sim app and rebuild it.
set -e
tar -C /home/claude/havnline-restaurant/base-clone --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude='./*.bundle' -cf - . | tar -C /home/claude/sim/app -xf -
cd /home/claude/sim/app && ./node_modules/.bin/next build > /home/claude/sim/build.txt 2>&1 || { tail -30 /home/claude/sim/build.txt; exit 1; }
echo built

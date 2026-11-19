#!/bin/bash
# Start the fakes and the app under test (production build) on :3000.
cd /home/claude/sim
pkill -f 'node fakes.mjs'; pkill -f 'next start' ; pkill -f 'next-server'; sleep 0.5
nohup node fakes.mjs > logs-fakes.txt 2>&1 &
cd app
NODE_OPTIONS="--use-openssl-ca --require /home/claude/sim/hook.cjs" \
NODE_EXTRA_CA_CERTS=/home/claude/sim/certs/bundle.crt \
NO_PROXY="$NO_PROXY,api.stripe.com,api.twilio.com,messaging.twilio.com,api.elevenlabs.io,api.resend.com,challenges.cloudflare.com,app.scrapingbee.com" \
no_proxy="$NO_PROXY,api.stripe.com,api.twilio.com,messaging.twilio.com,api.elevenlabs.io,api.resend.com,challenges.cloudflare.com,app.scrapingbee.com" \
nohup ./node_modules/.bin/next start -p 3000 > ../logs-app.txt 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3000/ && break; sleep 0.5; done
curl -s -o /dev/null -w 'app %{http_code}\n' http://localhost:3000/

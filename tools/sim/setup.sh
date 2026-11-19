#!/bin/bash
# One-time setup of the HavnLine simulation workspace on a Linux machine
# (Claude's cloud workspace: Ubuntu, root, Postgres 16, Node 22, Playwright).
# Everything runs locally: a real Postgres + PostgREST with all migrations,
# a small Supabase-auth stand-in, and fake Stripe/Twilio/Anthropic/ElevenLabs/
# Resend/Turnstile on 127.0.0.1:443. The app under test can't reach the
# real services (see hook.cjs), so nothing is charged, texted or called.
set -e
REPO=/home/claude/havnline-restaurant/base-clone
SIM=/home/claude/sim
mkdir -p $SIM /home/claude/tools /home/claude/simlib
cp $REPO/tools/sim/* $SIM/
cd $SIM

# Postgres
if [ ! -d $SIM/pgdata ]; then
  mkdir -p $SIM/pgdata && chown -R postgres $SIM/pgdata
  su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $SIM/pgdata -A trust -U postgres >/dev/null"
fi
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $SIM/pgdata -o '-p 54322 -c max_connections=300 -c shared_buffers=512MB -k /tmp' -l $SIM/pgdata/log.txt start" || true

# PostgREST
[ -x /home/claude/tools/postgrest ] || (cd /home/claude/tools && curl -sSL -o p.tar.xz https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz && tar xf p.tar.xz)

# Node pieces for the harness
(cd /home/claude/simlib && [ -d node_modules/pg ] || (npm init -y >/dev/null && npm i pg@8.13.1 >/dev/null))
ln -sfn /home/claude/simlib/node_modules $SIM/node_modules

# TLS for the fakes
mkdir -p $SIM/certs && cd $SIM/certs
HOSTS="api.stripe.com files.stripe.com api.twilio.com messaging.twilio.com monitor.twilio.com marketplace.twilio.com api.anthropic.com api.elevenlabs.io api.resend.com challenges.cloudflare.com app.scrapingbee.com"
SAN=$(for h in $HOSTS; do printf 'DNS:%s,' $h; done | sed 's/,$//')
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 30 -subj "/CN=HavnLine Sim CA" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj "/CN=sim-fakes" 2>/dev/null
printf "subjectAltName=$SAN\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" > ext.cnf
openssl x509 -req -in srv.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out srv.crt -days 30 -extfile ext.cnf 2>/dev/null
cat ${NODE_EXTRA_CA_CERTS:-/dev/null} ca.crt > bundle.crt
echo "$HOSTS" > hosts.txt
cd $SIM

# Keys PostgREST trusts, then the app copy with sim settings
node keys.mjs > keys.env && source keys.env
mkdir -p app && ln -sfn $REPO/node_modules app/node_modules
cat > app/.env.production.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_sim
STRIPE_SECRET_KEY=sk_test_sim_platform_key
STRIPE_WEBHOOK_SECRET=whsec_sim_platform
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_sim_connect
STRIPE_PRICE_ID=price_sim
TWILIO_ACCOUNT_SID=ACsimmain0000000000000000000000000
TWILIO_AUTH_TOKEN=simmaintoken000000000000000000000
ANTHROPIC_API_KEY=sk-ant-sim-key
ELEVENLABS_API_KEY=sim-eleven-key
RESEND_API_KEY=re_sim_key
SIGNING_SECRET=sim-signing-secret-0123456789abcdef
SECRETS_ENCRYPTION_KEY=sim-encryption-key-0123456789abcdef
CRON_SECRET=sim-cron-secret
PLATFORM_ADMIN_EMAIL=admin@havnline.test
ADMIN_TIMEZONE=America/Detroit
ENV
./sync-build.sh
./reset-db.sh
./start-app.sh
echo "Ready. Run: cd $SIM && node run.mjs calls pay tablet forms combos ui   (or: node loadtest.mjs 3 10,50,100)"

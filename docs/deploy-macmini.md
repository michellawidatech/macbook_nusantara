# Deploying to the shop's Mac mini

The POS on one Mac mini at the shop, shipped as **compiled output only**.
`deploy/macmini/build-release.mjs` builds the release on your laptop;
`deploy/macmini/ops/` is everything the Mac mini runs it with. This file is
the order to do things in. The Mac mini is the only deployment: Render and
Netlify were retired on 2026-09-18, and their runbook is in git history
(`git show f6f5f3c:docs/deploy.md`).

## Read this first

**Every POS screen reads PostgreSQL** (2026-09-13, `docs/store-on-postgres.md`).
The browser loads the shop from `/api/store` after sign-in, commits each change
there, and polls for what the other tills wrote. A screen shows "Loading the
shop…" until the first load lands and an offline banner while changes wait for
the connection. The shop's history comes from B2Soft (`docs/migration-b2soft.md`).

**What "without the source" buys, and what it does not.** The release carries
minified bundles, a Prisma client generated from a comment-free copy of the
schema, and the built SPA. No TypeScript, docblocks, tests, git history,
CLAUDE.md or source maps — the build refuses to pack if any of them turn up.
That makes the code impractical to maintain, extend or resell from what is on
the disk. It does not make it secret:

- Anyone with an admin password on the Mac mini can copy the release, run it
  elsewhere, or read the minified JavaScript.
- Every browser that opens the POS downloads the SPA bundle; that is what a web
  app is. Most of the POS logic is in it today, because the screens run on the
  browser store.
- An obfuscator on top would buy a little more and cost speed and every stack
  trace. It is not done here.

The protection that holds is on paper: a licence agreement in which the shop
gets the right to use the software and you keep ownership, with no copying,
reverse engineering or resale. Keep the Mac mini's admin password yourself if
you can, and give the shop a Standard account for everyday use.

## The shape

```
staff ─https─▶ tailscale serve :443 ─▶ Caddy 127.0.0.1:8080 ─┬─ /            web/  (the SPA)
  (tailnet only)                                             └─ /api, /auth  API :4000 ─▶ PostgreSQL 16
Meta ──https─▶ tailscale funnel :8443 ─▶ webhook :3001     (optional, public)
                                         worker            (optional, no port)
GitHub Actions ──tailnet, ssh :22──▶ nusantara-deploy      (releases, migrations — docs/deploy-pipeline.md)
you ───────────tailnet, ssh :22──▶ your admin account      (everything else)
```

Every process is a LaunchDaemon — it starts at boot with nobody logged in and
comes back if it dies — running as a hidden user `_nusantara` out of one
directory:

```
/opt/nusantara/
  current -> releases/nusantara-<version>
  releases/nusantara-<version>/   app/  web/  ops/  node_modules/  RELEASE
  etc/       common.env  api.env  webhook.env  worker.env  pgpass     (mode 600)
  logs/      api.log  caddy.log  backup.log …
  backups/   nusantara-YYYYMMDD-HHMM.dump
  var/       HOME for the services
```

**HTTPS is not optional.** Sign-in is the app's own form (since 2026-09-18;
Auth0 is gone), and the session cookie it sets is `Secure` unless told
otherwise (`apps/api/src/config.ts`) — a browser will not send it back over
plain http. `tailscale serve` supplies that certificate — an https `*.ts.net` name —
without opening a port on the shop's router, and reaches the POS only from
devices on the tailnet: the price is the Tailscale app on every staff device.
Meta cannot join a tailnet, so the webhook, if WhatsApp moves here, goes public
through `tailscale funnel` on a port of its own (§8). A Cloudflare Tunnel on a
domain the shop owns does the same jobs without the app on every device; it
was this runbook's first design, and is in git history (`git show
f6f5f3c:docs/deploy-macmini.md`).

Assumed: an Apple Silicon Mac mini (every model since late 2020) on macOS 14 or
later, and an Apple Silicon machine to build on — GitHub's `macos-15` runner
for the pipeline, or your laptop by hand. The two native pieces — Prisma's
query engine and argon2 — are built for the build machine's CPU, and `ops/run`
refuses to start on a different one rather than failing inside `dlopen`.

## 1. Build the release — your laptop

The pipeline does this on GitHub whenever a `v*` tag is pushed
(`docs/deploy-pipeline.md`); by hand, it is one command. Commit first, so the
version names a commit instead of ending in `-dirty`.

```bash
node deploy/macmini/build-release.mjs
```

Under ten seconds. It generates a Prisma client from a comment-free copy of the
schema, bundles the API, worker, webhook and staff CLI into one minified file
each, builds the SPA, copies the two native addons, and then audits what it is
about to pack: a `.ts` file, a source map, or a path under your home directory
aborts it. Two things come out:

- `build/macmini/nusantara-<version>.tar.gz` — about 11 MB, and the only thing
  that goes to the shop.
- `build/macmini/maps/<version>/` — the source maps. Keep them and never ship
  them: a stack trace from the shop says `app/api.mjs:1:48213`, which means
  nothing without them.

## 2. Prepare the Mac mini — once

Sign in with an admin account that is yours, not the shop's.

**Power.** It is a server now.

```bash
sudo pmset -a sleep 0 disksleep 0 autorestart 1
```

`autorestart` brings it back after a power cut; a UPS stops the cut landing in
the middle of a sale. FileVault is a trade: on, the Mac waits at the unlock
screen after every power cut and the POS stays down until somebody types the
password; off, it comes straight back.

**Remote access for you.** System Settings → General → Sharing → Remote Login:
on, for your admin account only. Then Homebrew (from brew.sh) and everything
this deploy uses:

```bash
brew install node@24 postgresql@16 caddy tailscale
sudo brew services start tailscale
sudo tailscale up        # open the URL it prints and approve the machine
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zprofile && source ~/.zprofile
```

With Tailscale on your laptop under the same account, `ssh <you>@<macmini>`
works from anywhere, with no port open on the shop's router.

**The service user and its directory.** A role account: no password, no entry
on the login window, no shell.

```bash
dscl . -list /Users UniqueID | awk '$2 == 399'   # must print nothing; pick another UID in 200–400 if it does
sudo sysadminctl -addUser _nusantara -fullName "Nusantara POS" -UID 399 \
  -shell /usr/bin/false -home /opt/nusantara/var -roleAccount
sudo mkdir -p /opt/nusantara/{etc,logs,var,backups,releases}
sudo chown -R _nusantara:staff /opt/nusantara
sudo chmod 700 /opt/nusantara
```

`700` makes the release unreadable to every account except `_nusantara` and
root — to anyone, that is, without an admin password. It also means your own
shell cannot glob inside `/opt/nusantara`; that is why the commands below spell
paths out, and wrap the one glob in `sudo sh -c`.

## 3. PostgreSQL — once

Start it at boot, as your own user (PostgreSQL refuses to run as root):

```bash
sudo brew services start --sudo-service-user "$USER" postgresql@16
```

Homebrew creates the cluster with `trust` authentication: any local process may
connect as any role without a password, which would make the three roles below
decoration. Make it passwords over TCP and OS identity over the socket:

```bash
PGDATA=/opt/homebrew/var/postgresql@16
sed -i '' -E '/^local/s/trust$/peer/; /^host/s/trust$/scram-sha-256/' "$PGDATA/pg_hba.conf"
psql -d postgres -c 'select pg_reload_conf()'
```

It already listens on localhost only. Leave that alone.

**Roles and the database — from your laptop.** Generate four passwords with
`openssl rand -hex 24` (hex, so nothing in a connection string needs escaping)
for the owner, app, agent and read-only roles, put them in your password
manager, and have them in your shell as `$OWNER_PW`, `$APP_PW`, `$AGENT_PW` and
`$READONLY_PW`. Then run `packages/db/prisma/bootstrap-managed.sql`; connected
as the cluster's superuser, it creates all four roles and `nusantara_pos_prod`:

```bash
ssh <you>@<macmini> "/opt/homebrew/opt/postgresql@16/bin/psql -d postgres \
  -v owner_password=$OWNER_PW -v app_password=$APP_PW \
  -v agent_password=$AGENT_PW -v readonly_password=$READONLY_PW -f -" \
  < packages/db/prisma/bootstrap-managed.sql
```

The SQL travels on ssh's stdin and is never written to the Mac mini's disk.

**Migrations — from your laptop, through a tunnel, as the owner.** The Prisma
CLI, the schema and the migration files stay on your laptop. In one terminal:

```bash
ssh -N -L 55432:127.0.0.1:5432 <you>@<macmini>
```

In another:

```bash
export OWNER_URL="postgresql://nusantara:$OWNER_PW@127.0.0.1:55432/nusantara_pos_prod"
DATABASE_URL="$OWNER_URL" pnpm --filter @nusantara/db exec prisma migrate deploy
```

Then ask the database, not Prisma — `prisma migrate status` lies in this
project:

```bash
psql "$OWNER_URL" -tAc "select count(*) from _prisma_migrations where finished_at is not null"
ls packages/db/prisma/migrations | grep -c '^[0-9]'
psql "$OWNER_URL" -tAc "select has_table_privilege('nusantara_app','\"Unit\"','SELECT'), has_table_privilege('nusantara_app','\"Unit\"','DELETE'), has_table_privilege('nusantara_app','\"UnitEvent\"','INSERT'), has_table_privilege('nusantara_app','\"UnitEvent\"','UPDATE'), has_table_privilege('nusantara_app','\"UnitNotePhoto\"','DELETE')"
```

The first two numbers must match, and the third must print `t|f|t|f|t` —
anything else means the ledger's append-only rule is a convention again rather
than a permission.

**Starting data — optional, same tunnel.** ⚠️ The seed TRUNCATES every table
first; run it on this fresh database and never again once the shop is using it.

```bash
APP_ENV=prod SEED_REFERENCE_ONLY=1 DATABASE_URL="$OWNER_URL" pnpm --filter @nusantara/db seed
```

`SEED_REFERENCE_ONLY=1` writes the catalogue, locations, payment methods and
staff, and no stock. Leave it off for the full demo shop.

## 4. Install the release — the Mac mini

From your laptop:

```bash
scp build/macmini/nusantara-<version>.tar.gz <you>@<macmini>:/tmp/
```

Use `scp`, not AirDrop or a browser download: those mark the files quarantined,
and macOS then refuses to load the two native addons. If one arrived that way,
`sudo xattr -dr com.apple.quarantine /opt/nusantara/releases/<release>`.

On the Mac mini:

```bash
v=nusantara-<version>
sudo tar -xzf /tmp/$v.tar.gz -C /opt/nusantara/releases && rm /tmp/$v.tar.gz
sudo ln -sfn /opt/nusantara/releases/$v /opt/nusantara/current
sudo chown -R _nusantara:staff /opt/nusantara
```

**Configuration.** One file per process plus a shared one, so the API never
holds the webhook's secrets:

```bash
for f in common api; do
  sudo -u _nusantara cp /opt/nusantara/current/ops/env/$f.env.example /opt/nusantara/etc/$f.env
done
sudo sh -c 'chmod 600 /opt/nusantara/etc/*.env'
sudo nano /opt/nusantara/etc/common.env   # $APP_PW into DATABASE_URL
sudo nano /opt/nusantara/etc/api.env      # the https address — step 5
```

And the backup's credentials — one line,
`127.0.0.1:5432:nusantara_pos_prod:nusantara:<OWNER_PW>`:

```bash
sudo nano /opt/nusantara/etc/pgpass
sudo chown _nusantara:staff /opt/nusantara/etc/pgpass && sudo chmod 600 /opt/nusantara/etc/pgpass
```

**A first look, before launchd.** In the foreground, so a configuration error
prints where you can see it (Ctrl-C to stop):

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run api
curl -s http://127.0.0.1:4000/api/health   # second terminal: {"ok":true,"app":"api","env":"production"}
```

**The accounts.** Sign-in is the app's own. Every account starts on the
shop's initial password, `password`, and must choose its own at the first
sign-in; the owner resets anybody back to it from Settings → Staff accounts
(owner ask 2026-09-18). With the master data imported (docs/migration-b2soft.md
§1), one command gives every salesperson a login and makes Ersen the owner:

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run accounts --owner ersen
```

Before any import, or for one person, `staff` does one account — `--initial`
for the shop's initial password, or a password on stdin:

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run staff \
  --username ersen --name 'Ersen' --role OWNER --initial
```

Sign in as the owner straight away and choose a password: until each person
has, anyone who knows a username can take that account.

**The chatbot's answers.** The owner's answer sheet is
`docs/chatbot/knowledge-2026-09-18.md`; copy it over and load it (it is also
pasteable into /chat → Knowledge → Import from a document):

```bash
scp docs/chatbot/knowledge-2026-09-18.md <admin>@<mini>:/tmp/
sudo -u _nusantara /opt/nusantara/current/ops/run knowledge /tmp/knowledge-2026-09-18.md --by ersen
```

**Moving from Auth0** (a Mac mini set up before 2026-09-18). The owner account
this runbook used to create is named by an email and carries a random password
nobody knows, and an account Auth0 created carries no password at all; neither
can sign in now. Run `accounts --owner ersen` as above, sign in as Ersen, and
switch the old ones off in Settings → Staff accounts (or reset one to the
initial password there, if that person should keep it). The five `AUTH0_*`
lines in `api.env` are read by nothing and can be deleted.

**Start the services.**

```bash
sudo /opt/homebrew/bin/caddy validate --config /opt/nusantara/current/ops/Caddyfile --adapter caddyfile
for s in api caddy backup; do
  sudo install -m 644 -o root -g wheel /opt/nusantara/current/ops/launchd/local.nusantara.$s.plist /Library/LaunchDaemons/
  sudo launchctl bootstrap system /Library/LaunchDaemons/local.nusantara.$s.plist
done
curl -s http://127.0.0.1:4000/api/health
curl -sI http://127.0.0.1:8080/ | head -1   # HTTP/1.1 200 OK
```

macOS lists them under System Settings → General → Login Items → Allow in the
Background. They must stay switched on there.

## 5. The address — Tailscale

Below, `<mini>.<tailnet>.ts.net` is the Mac mini's MagicDNS name —
`tailscale status` on it prints it.

1. Tailscale admin console → **DNS**: MagicDNS on, and **HTTPS Certificates**
   enabled. `tailscale serve` cannot get a certificate without both.
2. On the Mac mini, serve Caddy on that name. `--bg` keeps it across reboots:

   ```bash
   sudo tailscale serve --bg http://127.0.0.1:8080
   tailscale serve status   # https://<mini>.<tailnet>.ts.net → http://127.0.0.1:8080
   ```

3. Admin console → **Machines** → the Mac mini → **Disable key expiry**.
   Otherwise it leaves the tailnet every 180 days, and the till goes with it.
4. In `api.env`, `CORS_ORIGIN` is `https://<mini>.<tailnet>.ts.net`. Then
   `sudo launchctl kickstart -k system/local.nusantara.api`.
5. On a staff phone signed in to the tailnet, open that address and sign in as
   `ersen` with the initial password. The app asks for a new one before
   anything else.

If a sign-in that worked starts answering "too many attempts" for everybody at
once, the API is seeing every client as one address: `TRUST_PROXY` must be
`loopback` (the default) while tailscale serve and Caddy both run on the Mac
mini.

Every staff device needs the Tailscale app, signed in to the shop's tailnet.
That is also the POS's front door: a device that is not on the tailnet cannot
reach even the login page.

## 6. Backups — check once, then leave them

The backup daemon went in with step 4. Run it now rather than trusting it:

```bash
sudo launchctl kickstart system/local.nusantara.backup
sudo tail -n 3 /opt/nusantara/logs/backup.log   # backup ok: /opt/nusantara/backups/nusantara-….dump
```

It dumps nightly at 22:30, checks that `pg_restore` can read the dump, and keeps
30 days — on the machine it is protecting, which is half a backup. Get a copy
off it: Time Machine to an external disk is the least effort, and a cloud
folder is better.

A restore nobody has tried is a guess. Once, into a scratch database:

```bash
f=$(sudo ls -t /opt/nusantara/backups | head -1)
createdb restore_test && sudo cat /opt/nusantara/backups/$f | pg_restore -d restore_test
psql -d restore_test -tAc 'select count(*) from "UnitEvent"' && dropdb restore_test
```

## 7. Updating

**Push a `v*` tag.** The pipeline builds the release on GitHub, backs the
database up, applies the migrations through the tunnel and checks them by
query, installs the release, and switches back by itself if it does not come
up. `docs/deploy-pipeline.md` is how to set it up, how to release, and how to
roll back.

What follows is the same thing by hand, for a day GitHub or the tailnet is not
there. On your laptop: build, then copy.

```bash
node deploy/macmini/build-release.mjs
scp build/macmini/nusantara-<version>.tar.gz <you>@<macmini>:/tmp/
```

If the release brings migrations, apply them first, through the tunnel exactly
as in step 3 — migrations before code. Then on the Mac mini:

```bash
v=nusantara-<version>
sudo tar -xzf /tmp/$v.tar.gz -C /opt/nusantara/releases && rm /tmp/$v.tar.gz
sudo chown -R _nusantara:staff /opt/nusantara/releases/$v
sudo ln -sfn /opt/nusantara/releases/$v /opt/nusantara/current
sudo launchctl kickstart -k system/local.nusantara.api
curl -s http://127.0.0.1:4000/api/health
```

The SPA needs no restart: Caddy reads `current/web` on every request and
`index.html` is never cached, so a reload picks the new one up. Restart Caddy
only when the Caddyfile changed, and the worker and webhook if you run them. If
a plist changed, `install` it again, then `bootout` and `bootstrap` it.

**Rolling back** is `sudo /usr/local/libexec/nusantara-deploy rollback` once
the pipeline is set up — it health-checks the release it goes back to. Without
it, the same symlink pointed at the previous release and the same kickstart;
old releases stay in `releases/` for exactly this. Either way it is only safe
when no migration came in between that the older code cannot live with —
pointing at older code does not undo a migration.

## 8. Optional — WhatsApp from the Mac mini

The worker is what turns on the unattended replies, and on this machine it
costs nothing to run.

Meta is not on the tailnet, so the webhook is the one thing on this machine
the internet can reach. Funnel is set per port: the webhook goes public on
8443, and the POS on 443 stays tailnet-only.

1. Publish the webhook alone. The tailnet policy must give the Mac mini the
   `funnel` attribute — the default policy gives it to every member's devices:

   ```bash
   sudo tailscale funnel --bg --https=8443 http://127.0.0.1:3001
   ```

2. `webhook.env` and `worker.env` from their examples, as in step 4, and the
   same `chmod 600`. The worker needs `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID` and
   `ANTHROPIC_API_KEY`; without the last it stays dormant and every message
   waits in the inbox for a person. Load the owner's answers first (§4, "The
   chatbot's answers") — with none, the bot hands every question over.
3. Install and bootstrap `local.nusantara.webhook` and `local.nusantara.worker`
   the way step 4 did the others. From then on the pipeline restarts and
   health-checks them with every release.
4. From a device OFF the tailnet:
   `curl https://<mini>.<tailnet>.ts.net:8443/health`.
5. Only then point Meta at `https://<mini>.<tailnet>.ts.net:8443/webhook`. Meta
   asks for a valid public certificate — Funnel's is — and documents no port
   rule; the verify handshake is the proof. **That is a change to the shop's
   live WhatsApp channel:** from that moment, inbound messages stop arriving
   wherever they arrive today. Do it as its own deliberate act, after the
   verify handshake succeeds.

**What the bot does** is docs/chatbot-rag.md. In short: while the shop runs
this app beside B2Soft it answers only from the owner's approved answers and
the shop's facts, and hands stock, prices, negotiation and anything else to a
person — the Chat page lists those first, with the bot's note, and the bot
stays out of that conversation until somebody replies or presses *Mark
handled*.

## Day to day

```bash
sudo tail -f /opt/nusantara/logs/api.log                 # one JSON object per line
sudo launchctl kickstart -k system/local.nusantara.api   # restart
sudo launchctl bootout system/local.nusantara.api        # stop; bootstrap to start again
sudo launchctl print system/local.nusantara.api | grep -E 'state|last exit'
sudo cat /opt/nusantara/current/RELEASE                  # which build is running
```

launchd does not rotate logs. At three staff they grow slowly; if one ever
matters, `sudo sh -c ': > /opt/nusantara/logs/api.log'` empties it while the
process keeps writing.

The API listens on every interface — it has no bind-address setting — so the
shop's Wi-Fi can reach `:4000` directly, around Caddy. Everything there is still
behind sign-in. If that is not enough, the macOS firewall can refuse incoming
connections to node (`socketfilterfw --blockapp`).

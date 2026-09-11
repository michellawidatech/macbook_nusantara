# Deploying to the shop's Mac mini

The POS on one Mac mini at the shop, shipped as **compiled output only**.
`deploy/macmini/build-release.mjs` builds the release on your laptop;
`deploy/macmini/ops/` is everything the Mac mini runs it with. This file is
the order to do things in. `docs/deploy.md` is the Render + Netlify runbook,
and nothing here changes that deployment.

## Read this first

**The POS screens still keep their data in the browser.** 26 route files read
`apps/web/src/mock/store.ts`, an in-memory store with no persistence: a reload
resets it, and every device holds its own copy. Moving the app onto a Mac mini
does not change that. What IS real on this deploy is what lives in PostgreSQL —
sign-in, staff accounts and sessions, and the chat inbox. Until the remaining
slices move onto the API, this is a pilot of the same app Netlify serves today,
and the machine the migrated slices will land on.

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
browser ─https─▶ Cloudflare ─tunnel─▶ cloudflared ─▶ Caddy 127.0.0.1:8080 ─┬─ /            web/  (the SPA)
                                                                           └─ /api, /auth  API :4000 ─▶ PostgreSQL 16
Meta ───https─▶ Cloudflare ─tunnel─▶ cloudflared ─▶ webhook :3001     (optional)
                                                    worker            (optional, no port)
you ──Tailscale──▶ ssh                                                (updates, migrations)
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

**HTTPS is not optional.** The session cookie is `Secure` unless told otherwise
(`apps/api/src/config.ts`), and sign-in is Auth0's hosted page — `LoginPage` has
no other control — whose callback must be the https origin the browser is on.
Cloudflare Tunnel supplies that certificate without opening a port on the
shop's router, works from outside the shop, and is the public URL Meta needs if
WhatsApp moves here too. It needs a domain on Cloudflare; the free plan is
enough. If the shop has no domain and wants none, Tailscale can do the same job
(`tailscale serve` gives an https `*.ts.net` name), at the price of the
Tailscale app on every staff device.

Assumed: an Apple Silicon Mac mini (every model since late 2020) on macOS 14 or
later, and an Apple Silicon laptop to build on. The two native pieces — Prisma's
query engine and argon2 — are built for the build machine's CPU, and `ops/run`
refuses to start on a different one rather than failing inside `dlopen`.

## 1. Build the release — your laptop

Commit first, so the version names a commit instead of ending in `-dirty`.

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
brew install node@24 postgresql@16 caddy cloudflared tailscale
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
`$READONLY_PW`. Then run the same bootstrap Render was set up with; connected
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
holds the webhook's secrets — the split `render.yaml` keeps:

```bash
for f in common api; do
  sudo -u _nusantara cp /opt/nusantara/current/ops/env/$f.env.example /opt/nusantara/etc/$f.env
done
sudo sh -c 'chmod 600 /opt/nusantara/etc/*.env'
sudo nano /opt/nusantara/etc/common.env   # $APP_PW into DATABASE_URL
sudo nano /opt/nusantara/etc/api.env      # the https address and Auth0 — step 5
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

**The owner's account.** Sign-in is Auth0, and the first Auth0 login adopts the
`Staff` row whose username is that email — so create it with the email the
owner will sign in with. The SPA never asks for the local password, so make it
random:

```bash
openssl rand -hex 16 | sudo -u _nusantara /opt/nusantara/current/ops/run staff \
  --username owner@example.com --name 'Owner Name' --role OWNER
```

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

## 5. The address — Cloudflare Tunnel and Auth0

1. Put the shop's domain on Cloudflare (free plan).
2. Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel**
   (Cloudflared), name it, choose macOS, and run the command it shows on the
   Mac mini. It installs its own LaunchDaemon, so it survives a reboot too:

   ```bash
   sudo cloudflared service install <token>
   ```

3. Add a public hostname: `pos.<domain>` → **HTTP** → `localhost:8080`.
4. Auth0 → Applications → the POS application → Settings. Add, keeping the
   Netlify entries while both deployments exist:
   - Allowed Callback URLs — `https://pos.<domain>/auth/callback`
   - Allowed Logout URLs — `https://pos.<domain>`
   - Allowed Web Origins — `https://pos.<domain>`
5. In `api.env`, `CORS_ORIGIN` and `AUTH0_BASE_URL` are both
   `https://pos.<domain>`, beside the four `AUTH0_*` values. Then
   `sudo launchctl kickstart -k system/local.nusantara.api`.
6. Open `https://pos.<domain>` on a phone that is off the shop's Wi-Fi, and sign
   in as the owner.

`AUTH0_BASE_URL` is the setting most likely to be wrong, and it fails at the
redirect — after the person has already been sent to Auth0 — rather than at
startup. If sign-in loops, check it first.

Optional, and worth it for a till on the public internet: a Cloudflare Access
application on `pos.<domain>` with a one-time-PIN policy for the staff's
emails, so nobody reaches even the login page without passing it. Never put
Access in front of the webhook's hostname: Meta cannot pass it.

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

On your laptop: build, then copy.

```bash
node deploy/macmini/build-release.mjs
scp build/macmini/nusantara-<version>.tar.gz <you>@<macmini>:/tmp/
```

If the release brings migrations, apply them first, through the tunnel exactly
as in step 3 — migrations before code, the order `docs/deploy.md` keeps. Then on
the Mac mini:

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

**Rolling back** is the same symlink pointed at the previous release, and the
same kickstart; old releases stay in `releases/` for exactly this. It is only
safe when no migration came in between — pointing at older code does not undo
a migration.

## 8. Optional — WhatsApp from the Mac mini

Render has no free instance for the worker, so it is not deployed there; here
it costs nothing, and it is what turns on the unattended replies.

1. A second public hostname on the tunnel: `wa.<domain>` → **HTTP** →
   `localhost:3001`.
2. `webhook.env` and `worker.env` from their examples, as in step 4, and the
   same `chmod 600`.
3. Install and bootstrap `local.nusantara.webhook` and `local.nusantara.worker`
   the way step 4 did the others.
4. `curl https://wa.<domain>/health`.
5. Only then point Meta at `https://wa.<domain>/webhook`. **That is a change to
   the shop's live WhatsApp channel:** from that moment, inbound messages stop
   arriving wherever they arrive today. Do it as its own deliberate act, after
   the verify handshake succeeds.

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

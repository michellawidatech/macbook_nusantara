# Go-live: a clean production database with master data only

The order to do it in, one phase at a time, with every command ready to paste.
Written 2026-09-29 from the Mac mini's actual state; `docs/deploy-macmini.md`
is the machine's full runbook and `docs/deploy-pipeline.md` the pipeline's.

**Where things stand on 2026-09-29**

| | |
|---|---|
| Release on the Mac mini | `20260913-1737-f6f5f3c-dirty`, copied by hand; still the Auth0 login |
| Its database | `nusantara_pos_prod`, 23 of 40 migrations, holding a FULL B2Soft history import (2,297 sales, 6,458 units) the owner does not want |
| Services | `api` and `caddy` running, `backup` scheduled; no worker or webhook |
| The address | `https://nusantara-mini.tail903811.ts.net` — **public on the internet** through Tailscale Funnel |
| The pipeline | set up in the repo, never deployed: every tag failed its tests |

**What this guide ends with**

- The old database kept whole under a new name, `nusantara_pos_prod_old_20260929`.
  Nothing is dropped. It can be renamed back in one command.
- A fresh `nusantara_pos_prod` with all 40 migrations, and ONLY the master
  data: 4 warehouses, 8 categories, the catalogue, suppliers, customers and 4
  salespeople. No stock, no prices, no sales, no balances.
- The current release, installed by the pipeline, with the app's own sign-in.
- Every later `v*` tag pushed from `main` deploys itself.
- The POS reachable from the tailnet only.

**Why rename rather than a new database name.** The code pins production to
the name `nusantara_pos_prod` (`packages/db/src/environment.ts`), and so do the
nightly backup and the pipeline's safety check. A new name would mean changing
three guards whose whole job is to stop the wrong database being written to.
Renaming the OLD one keeps every guard as it is and keeps the old data.

**Why all 40 migrations.** A migration builds the database's STRUCTURE — its
tables and columns — not its data. The code expects the structure all 40
build; skipping one is a missing table at the first screen that reads it. The
choice of "only master data" is made at the import (phase 5), not here.

Machines: **LAPTOP** is this MacBook with the repository. **MINI** is the Mac
mini's own Terminal, signed in as `mac`.

---

## Phase 1 — Tailscale on both machines

**MINI.** Find out why it says "Tailscale is currently in use": usually two
copies installed — the Mac app and Homebrew's — fighting over one daemon.

```bash
which -a tailscale; ls /Applications | grep -i tailscale; sudo brew services list | grep -i tailscale; tailscale status | head -3
```

Paste the output back before changing anything. If `tailscale status` lists
the machines, Tailscale works and the message is only the second copy
complaining.

**Tailscale admin console** (login.tailscale.com), in a browser:

1. **Machines** → `nusantara-mini-1` (offline since 15 days) → **Remove**. It
   is a stale copy of the mini; while it exists the name `nusantara-mini`
   could one day point at the wrong one.
2. **Machines** → `nusantara-mini` → **Disable key expiry**. Otherwise it
   leaves the tailnet every 180 days and the tills go with it.
3. **DNS** → MagicDNS on, HTTPS Certificates on (already, since the address
   works).

**LAPTOP.** Open the Tailscale app and connect. Then:

```bash
tailscale status | head -3
```

**MINI.** Allow SSH for `mac`: System Settings → General → Sharing → **Remote
Login** on, "Allow access for: Only these users" → `mac`.

**LAPTOP.** Check it reaches (asks for `mac`'s password):

```bash
ssh mac@nusantara-mini 'echo reached; whoami'
```

---

## Phase 2 — Put the old database aside and make a new one (MINI)

Do this out of hours: the POS is down from step 2.2 until phase 4 ends.

**2.1 Back up the old database** — a file you keep whatever happens. It is
written as `mac` (the database's superuser on this machine), then filed with
the nightly backups.

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_dump -Fc -d nusantara_pos_prod -f ~/nusantara-20260929-before-golive.dump && ls -lh ~/nusantara-20260929-before-golive.dump && sudo cp ~/nusantara-20260929-before-golive.dump /opt/nusantara/backups/
```

Check the size is not zero, then copy the file in your home folder off the mini
(a USB disk or a cloud folder). If `pg_dump` answers "role … does not exist",
stop and paste the error to me.

**2.2 Stop the API**, so nothing holds a connection to the old database:

```bash
sudo launchctl bootout system/local.nusantara.api; sleep 2; sudo launchctl list | grep nusantara
```

`local.nusantara.api` should be gone from the list.

**2.3 Rename the old database** (nothing is deleted):

```bash
/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c 'ALTER DATABASE nusantara_pos_prod RENAME TO nusantara_pos_prod_old_20260929'
```

If it says another session is using it, run this and repeat 2.3:
`/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -c "select pid, usename, application_name from pg_stat_activity where datname='nusantara_pos_prod'"`
(and paste the output to me rather than killing anything).

**2.4 New passwords for the four roles, and the new database.** The old
passwords are forgotten, so every role gets a new one. They are generated on
the mini and printed ONCE — put all four in your password manager straight
away; nothing else keeps them.

```bash
OWNER_PW=$(openssl rand -hex 24); APP_PW=$(openssl rand -hex 24); AGENT_PW=$(openssl rand -hex 24); READONLY_PW=$(openssl rand -hex 24)
PSQL=/opt/homebrew/opt/postgresql@16/bin/psql
$PSQL -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE nusantara PASSWORD '$OWNER_PW'" \
  -c "ALTER ROLE nusantara_app PASSWORD '$APP_PW'" \
  -c "ALTER ROLE nusantara_agent PASSWORD '$AGENT_PW'" \
  -c "ALTER ROLE nusantara_readonly PASSWORD '$READONLY_PW'" \
  -c 'CREATE DATABASE nusantara_pos_prod OWNER nusantara' \
  -c 'REVOKE ALL ON DATABASE nusantara_pos_prod FROM PUBLIC' \
  -c 'GRANT CONNECT ON DATABASE nusantara_pos_prod TO nusantara, nusantara_app, nusantara_agent, nusantara_readonly'
printf '\nSAVE THESE FOUR NOW:\nowner    %s\napp      %s\nagent    %s\nreadonly %s\n' "$OWNER_PW" "$APP_PW" "$AGENT_PW" "$READONLY_PW"
```

The roles themselves are not recreated: they own nothing in the new database
yet, and migration grants are written against these names.

**2.5 Point the configuration at the new passwords.** Same Terminal window, so
`$APP_PW` and `$OWNER_PW` are still set:

```bash
sudo sed -i '' -E "s#^DATABASE_URL=.*#DATABASE_URL='postgresql://nusantara_app:${APP_PW}@127.0.0.1:5432/nusantara_pos_prod?connection_limit=5'#" /opt/nusantara/etc/common.env
echo "127.0.0.1:5432:nusantara_pos_prod:nusantara:${OWNER_PW}" | sudo tee /opt/nusantara/etc/pgpass >/dev/null
sudo chown _nusantara:staff /opt/nusantara/etc/pgpass /opt/nusantara/etc/common.env && sudo chmod 600 /opt/nusantara/etc/pgpass /opt/nusantara/etc/common.env
sudo sed -i '' -E '/^AUTH0_/d' /opt/nusantara/etc/api.env
sudo grep -E '^(CORS_ORIGIN|API_PORT)' /opt/nusantara/etc/api.env
```

The last line must print `CORS_ORIGIN='https://nusantara-mini.tail903811.ts.net'`
(and the port). If CORS_ORIGIN says anything else:

```bash
sudo sed -i '' -E "s#^CORS_ORIGIN=.*#CORS_ORIGIN='https://nusantara-mini.tail903811.ts.net'#" /opt/nusantara/etc/api.env
```

Leave the API stopped. The pipeline starts it (phase 4) on the new release,
after the migrations — an old release on an empty database would only confuse.

---

## Phase 3 — The pipeline's one-time setup

Three places. `docs/deploy-pipeline.md` §1–3 explains each; these are the
values for this shop.

**3.1 Tailscale admin console → Access controls.** Add, keeping the rest:

```jsonc
"tagOwners": { "tag:ci": ["autogroup:admin"] },
"hosts":     { "nusantara-mini": "100.94.139.120" },
"grants": [
  { "src": ["tag:ci"], "dst": ["nusantara-mini"], "ip": ["tcp:22"] }
]
```

If an existing rule has `"src": ["*"]`, change it to `"autogroup:member"` —
`*` would let every CI run reach every device, your laptop included.

Then **Settings → Trust credentials → New credential → OpenID Connect**:
issuer GitHub, subject
`repo:michellawidatech/macbook_nusantara:environment:prod`, scope *Auth keys:
write*, tag `tag:ci`. Note the client ID and audience.

**3.2 The deploy key and the installer. LAPTOP:**

```bash
ssh-keygen -t ed25519 -N '' -C github-actions@nusantara -f ~/nusantara-deploy-key
scp deploy/macmini/ops/nusantara-deploy deploy/macmini/ops/setup-deploy-access mac@nusantara-mini:/tmp/
ssh -t mac@nusantara-mini "sudo zsh /tmp/setup-deploy-access '$(cat ~/nusantara-deploy-key.pub)'"
```

It prints a host-key line at the end — copy it. Check:

```bash
ssh -i ~/nusantara-deploy-key nusantara-deploy@nusantara-mini status
```

**3.3 GitHub** → the repository → Settings → Environments → `prod`:

| | Name | Value |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | `cat ~/nusantara-deploy-key` (the PRIVATE half) |
| Secret | `PROD_OWNER_DATABASE_URL` | `postgresql://nusantara:<OWNER PASSWORD>@127.0.0.1:55432/nusantara_pos_prod` |
| Secret | `TS_OAUTH_CLIENT_ID` | the client ID from 3.1 |
| Variable | `TS_AUDIENCE` | the audience from 3.1 |
| Variable | `DEPLOY_HOST` | `nusantara-mini.tail903811.ts.net` |
| Variable | `DEPLOY_KNOWN_HOSTS` | the line from 3.2, with its host name replaced by `nusantara-mini.tail903811.ts.net` |

While there: **Environments** also lists three leftovers named
`rebuild/inc1-interaction-kit - nusantara-…` from the retired Render setup —
delete them. And confirm `prod`'s deployment rule admits tags `v*` only.

Afterwards move `~/nusantara-deploy-key` into your password manager and delete
the file.

---

## Phase 4 — Release (LAPTOP)

The code is on `rebuild/inc1-interaction-kit`; production deploys from `main`.

```bash
gh pr create --base main --head rebuild/inc1-interaction-kit --title "Go-live 2026-09-29" --body "Everything since the walking skeleton; see docs/go-live.md"
```

Wait for CI on the PR to be green, merge it on GitHub, then tag `main`:

```bash
git fetch origin && git checkout main && git pull --ff-only && git tag v2026.09.29 && git push origin v2026.09.29
```

```bash
gh run watch
```

What the run does, in order: the same tests every push runs → builds the
release on GitHub's Apple-silicon runner → joins the tailnet → `pg_dump`s the
(empty) new database → applies all 40 migrations → checks them BY QUERY →
installs the release → starts the API → refuses to finish unless
`/api/health` names `2026.09.29`.

If a step fails, the table in `docs/deploy-pipeline.md` ("When it fails") says
what it means. Nothing about the old database can be touched by it.

Check from the LAPTOP:

```bash
curl -s https://nusantara-mini.tail903811.ts.net/api/health
```

It now carries `"release":"…2026.09.29…"`.

---

## Phase 5 — Import the master data (LAPTOP)

**5.1 Read the five workbooks** — no database involved. It reads ONLY
`Master Data Tanpa Gudang`, `Master Gudang`, `Master Pelanggan`,
`Supplier List` and `Salesman List`.

```bash
python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft-masters --masters-only --salesmen ERSEN,RIRIN,HARDI,DINA
```

```bash
cat build/b2soft-masters/masters-audit.txt
```

Read the audit before going on: it lists every product left out (not in the
eight categories) and every duplicate or missing phone number. Rehearsed
2026-09-29 on a scratch database: warehouses 4, salesmen 4, suppliers 64,
customers 38, categories 8, models 143, variants 345, and every consistency
check `OK`.

**5.2 Import it, through a tunnel, as the owner.** Terminal 1 (leave it open;
asks for `mac`'s password):

```bash
ssh -N -L 55432:127.0.0.1:5432 mac@nusantara-mini
```

Terminal 2 (type the OWNER password when it asks; it is not echoed or stored):

```bash
read -s "OWNER_PW?Owner DB password: " && echo && APP_ENV=prod DATABASE_URL="postgresql://nusantara:${OWNER_PW}@127.0.0.1:55432/nusantara_pos_prod" pnpm --filter @nusantara/db import:b2soft build/b2soft-masters --master-only; unset OWNER_PW
```

`--master-only` is the switch that matters: reference data, and no opening
balances. Never add `--with-balances`. Running it twice is safe — the second
run answers "already imported".

Check, in the same terminal:

```bash
read -s "OWNER_PW?Owner DB password: " && echo && psql "postgresql://nusantara:${OWNER_PW}@127.0.0.1:55432/nusantara_pos_prod" -tAc 'select (select count(*) from "Location"),(select count(*) from "Category"),(select count(*) from "Sku"),(select count(*) from "Supplier"),(select count(*) from "Customer"),(select count(*) from "Salesperson"),(select count(*) from "Unit"),(select count(*) from "Order")'; unset OWNER_PW
```

Expected `4|8|345|64|38|4|0|0`. Close terminal 1 (Ctrl-C).

---

## Phase 6 — Accounts (MINI)

One login per salesperson (ersen, ririn, hardi, dina), Ersen as the owner, all
on the initial password `password`, each forced to choose their own at first
sign-in:

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run accounts --owner ersen
```

And the ADMIN account (role: STAFF, unless you decide otherwise):

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run staff --username admin --name 'Admin' --role STAFF --initial
```

Sign in as `ersen` straight away and change the password — until each person
has, anyone who knows a username can take that account.

---

## Phase 7 — Take the POS off the public internet (MINI)

Today anyone on the internet can open the login page. After this, only devices
signed in to the shop's tailnet can. **Every staff phone and laptop needs the
Tailscale app, signed in**, before you do it.

```bash
tailscale serve status
sudo tailscale funnel --https=443 off
sudo tailscale serve --bg http://127.0.0.1:8080
tailscale serve status
tailscale funnel status
```

The last two should show the address proxying to `127.0.0.1:8080` and **no**
"Funnel on". From a phone with Wi-Fi AND Tailscale off, the address must no
longer load; with Tailscale on, it must.

(The WhatsApp webhook, later, goes public on its own port, 8443 — see
`docs/deploy-macmini.md` §8. The POS stays private.)

---

## Phase 8 — Prove it survives

**MINI:**

```bash
sudo launchctl kickstart system/local.nusantara.backup; sleep 20; sudo tail -n 3 /opt/nusantara/logs/backup.log
sudo pmset -a sleep 0 disksleep 0 autorestart 1
```

Then restart the Mac mini (Apple menu → Restart) and, without signing in to
it, from the LAPTOP:

```bash
curl -s https://nusantara-mini.tail903811.ts.net/api/health
```

---

## Every change after today

Commit on a branch → PR into `main` → merge → on the LAPTOP:

```bash
git checkout main && git pull --ff-only && git tag v$(date +%Y.%m.%d) && git push origin v$(date +%Y.%m.%d)
```

A second release on the same day: `v2026.10.01.2`. Migrations in the commit
are applied by the pipeline, after a backup, before the new code starts. A
migration must never break the release before it (add first; drop only in a
later release) because the code can be rolled back and the database cannot.

**Roll back the code** (seconds, MINI): `sudo /usr/local/libexec/nusantara-deploy rollback`

**Go back to the old database** (only if the owner decides; MINI, API stopped
first):

```bash
PSQL=/opt/homebrew/opt/postgresql@16/bin/psql; $PSQL -d postgres -c 'ALTER DATABASE nusantara_pos_prod RENAME TO nusantara_pos_prod_new_unused' -c 'ALTER DATABASE nusantara_pos_prod_old_20260929 RENAME TO nusantara_pos_prod'
```

(The old database is at 23 migrations; the current release would need the
pipeline to migrate it forward.)

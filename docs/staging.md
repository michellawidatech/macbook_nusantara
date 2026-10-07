# Staging

**`https://staging-pos.macbooknusantara.com`** is the POS on a copy of the
shop's own data, running on the shop's Mac mini beside the real one. A push to
`main` deploys `main` there; **Actions → CI → Run workflow** on any branch
deploys that branch, so a feature can be tried on real products, suppliers and
customers before it is merged — and a migration can be run on a copy of the
shop before it is run on the shop.

```
staging-pos.macbooknusantara.com ─▶ Cloudflare ─▶ the same tunnel ─▶ Caddy 127.0.0.1:8081 ─┬─ /     /opt/nusantara-stage/current/web
                                                  (nusantara-mini)    (gate, §2)             └─ /api  API :4001 ─▶ nusantara_pos_stage
pos.macbooknusantara.com         ─▶ Cloudflare ─▶ the same tunnel ─▶ Caddy 127.0.0.1:8080 ─── …     API :4000 ─▶ nusantara_pos_prod
```

| | the shop | staging |
|---|---|---|
| Address | `pos.macbooknusantara.com` | `staging-pos.macbooknusantara.com` |
| Install | `/opt/nusantara` | `/opt/nusantara-stage` |
| API · Caddy | `:4000` · `:8080` | `:4001` · `:8081` |
| launchd | `local.nusantara.*` | `local.nusantara-stage.api`, `.caddy` |
| Database | `nusantara_pos_prod` | `nusantara_pos_stage`, a copy (`refresh`) |
| Deployed by | a `v*` tag | a push to `main`, or Run workflow on a branch |
| GitHub Environment | `prod` | `stage` |
| Worker, webhook | when switched on | **never** |
| Backups | nightly, and before every deploy | none — `refresh` rebuilds it |

## Why the name has a dash

`staging.pos.macbooknusantara.com` was the first ask. Cloudflare's free
certificate for the zone is `*.macbooknusantara.com`, and a wildcard covers ONE
level: a browser opening a name two levels deep gets a TLS error. Covering it
takes Advanced Certificate Manager — $10 a month and a card on the account,
which the shop has already declined once. `staging-pos` is one level deep and
is covered today (owner's choice, 2026-10-06).

## What staging is, and is not

- **It is the shop's data, so it is behind the shop-password gate.** The
  installer refuses to put staging up without a gate file (§2). The shop's
  own address does not enforce that; staging does.
- **You sign in with your shop username and password**, because the copy
  carries the staff accounts. A password changed on staging changes nothing on
  the shop, and the next `refresh` puts the shop's back.
- **It never talks to WhatsApp.** The copy includes the shop's Outbox — replies
  queued and not yet sent — and every customer's number, so a worker on
  staging would message real people, some of them a second time. The installer
  never loads one for staging, staging has no `worker.env` or `webhook.env`,
  and `ops/run` refuses to start either unless `APP_ENV` is `prod`. A reply
  "sent" from staging's /chat stays in staging's Outbox forever.
- **It is not walled off from the shop's database.** Both databases live in one
  PostgreSQL cluster, and roles belong to the cluster: staging's `nusantara_app`
  login is the shop's, and the owner password in the `stage` environment opens
  `nusantara_pos_prod` too. What stops staging opening the shop's database by
  mistake is `APP_ENV=stage` (`packages/db/src/environment.ts` refuses any other
  name); what stops it on purpose is nothing — so treat the `stage` environment
  as you treat `prod`. It widens nothing today: anybody who can push to this
  repository can already push a `v*` tag.
- **Nothing on it is kept.** `refresh` drops staging's database and copies the
  shop's in its place.

## One-time setup

About twenty minutes: the Mac mini, Tailscale, GitHub, Cloudflare. The commands
for the Mac mini run as its admin account — Screen Sharing or SSH over
Tailscale, as in `docs/public-domain.md` §4.

### 1. The Mac mini — the install and its configuration

```bash
sudo mkdir -p /opt/nusantara-stage/etc/caddy /opt/nusantara-stage/logs /opt/nusantara-stage/var /opt/nusantara-stage/releases
```

```bash
sudo chown -R _nusantara:staff /opt/nusantara-stage && sudo chmod 700 /opt/nusantara-stage
```

`common.env` is written FROM the shop's, so its password is never typed: only
`APP_ENV` and the database name change.

```bash
sudo sed -e "s/^APP_ENV=.*/APP_ENV='stage'/" -e 's#/nusantara_pos_prod#/nusantara_pos_stage#' /opt/nusantara/etc/common.env | sudo -u _nusantara tee /opt/nusantara-stage/etc/common.env >/dev/null
```

```bash
printf '%s\n' "API_PORT='4001'" "CORS_ORIGIN='https://staging-pos.macbooknusantara.com'" | sudo -u _nusantara tee /opt/nusantara-stage/etc/api.env >/dev/null
```

```bash
sudo chmod 600 /opt/nusantara-stage/etc/common.env /opt/nusantara-stage/etc/api.env
```

Check it — the password is masked:

```bash
sudo grep -E '^(APP_ENV|DATABASE_URL)=' /opt/nusantara-stage/etc/common.env | sed -E 's#(://[^:]+:)[^@]*@#\1…@#'
```

`APP_ENV='stage'` and a `DATABASE_URL` ending `/nusantara_pos_stage?…`. And
nothing may already be listening on staging's two ports — this prints nothing:

```bash
sudo lsof -nP -iTCP:4001 -iTCP:8081 -sTCP:LISTEN
```

`deploy/macmini/ops/env/stage/` holds the same two files as examples.

### 2. The gate

The shop's (`docs/public-domain.md` §5), in staging's own directory. The
username is `nusantara`; the password can be the shop's or your own — staging
is yours to use.

```bash
HASH=$(/opt/homebrew/bin/caddy hash-password) && printf '%s\n' '@public header Cf-Connecting-IP *' 'basic_auth @public {' "  nusantara $HASH" '}' | sudo -u _nusantara tee /opt/nusantara-stage/etc/caddy/public-gate.caddy >/dev/null
```

`hash-password` asks twice and prints only a bcrypt hash. Without this file the
staging deploy stops with *"holds no gate file — staging stays down until it
does"*.

### 3. The deploy key, and installer 2

Staging gets a key of its own. On your laptop:

```bash
ssh-keygen -t ed25519 -N '' -C github-actions-stage@nusantara -f ~/nusantara-stage-deploy-key
```

```bash
scp deploy/macmini/ops/nusantara-deploy deploy/macmini/ops/setup-deploy-access <admin>@nusantara-mini:/tmp/
```

```bash
ssh -t <admin>@nusantara-mini "sudo zsh /tmp/setup-deploy-access --stage '$(cat ~/nusantara-stage-deploy-key.pub)'"
```

It pins the key beside the shop's — *"the prod key is kept"* — with a forced
command that names `--stage` itself, so this key, which every branch can
reach, can only ever act on staging. It also installs **installer 2**, which
the shop's deploys use from then on: the same four verbs, the same paths, and a
`target=prod` line in `status` (`docs/deploy-pipeline.md`).

```bash
ssh -i ~/nusantara-stage-deploy-key nusantara-deploy@nusantara-mini status
```

`installer=2`, `target=stage`, nothing installed yet.

### 4. The data

On the Mac mini:

```bash
sudo /usr/local/libexec/nusantara-deploy --stage refresh
```

It creates `nusantara_pos_stage` and copies the shop's into it — a consistent
snapshot, so the till keeps selling while it runs — as the cluster's
superuser, the account PostgreSQL runs as. Owners, grants and the ledger's
`unit_event_drop_last` come across with it. This one is needed before the
first deploy: a deploy migrates staging's database and cannot migrate one that
does not exist.

### 5. Tailscale — staging's identity

Tailscale admin console → **Settings → Trust credentials → New credential →
OpenID Connect**: issuer **GitHub**, subject
`repo:michellawidatech/macbook_nusantara:environment:stage`, scope **Auth
keys: write**, tag `tag:ci`. It gives a client ID and an audience. The shop's
credential names `environment:prod` and does not admit a staging job; the
`tag:ci` grant to the Mac mini's port 22 already covers this one.

### 6. GitHub — the `stage` environment

It exists, admits only `main`, and holds nothing. From the repository on your
laptop — let it admit every branch (that is what Run workflow on a branch
needs), then give it its credentials:

```bash
gh api -X PUT repos/michellawidatech/macbook_nusantara/environments/stage --input - <<< '{"deployment_branch_policy": null}'
```

```bash
for v in DEPLOY_HOST DEPLOY_KNOWN_HOSTS; do gh variable set $v --env stage --body "$(gh variable get $v --env prod)"; done
```

```bash
gh secret set DEPLOY_SSH_KEY --env stage < ~/nusantara-stage-deploy-key
```

```bash
gh secret set STAGE_OWNER_DATABASE_URL --env stage
```

Paste `postgresql://nusantara:<OWNER_PW>@127.0.0.1:55432/nusantara_pos_stage` —
the shop's owner password, and the tunnel's end, as `PROD_OWNER_DATABASE_URL`
has.

```bash
gh secret set TS_OAUTH_CLIENT_ID --env stage
```

```bash
gh variable set TS_AUDIENCE --env stage --body '<the audience from step 5>'
```

Then keep the private key in your password manager or delete it:
`rm ~/nusantara-stage-deploy-key`.

### 7. Cloudflare — the address

**Zero Trust → Networks → Tunnels → `nusantara-mini` → Edit → Published
application routes** (*Public Hostname* on older dashboards) → **Add**:

| Subdomain | Domain | Path | Type | URL |
|---|---|---|---|---|
| `staging-pos` | `macbooknusantara.com` | *(empty)* | HTTP | `127.0.0.1:8081` |

Cloudflare makes the DNS record. Nothing changes on the Mac mini: the
connector there takes its routes from the dashboard.

### 8. The first deploy

```bash
gh workflow run CI --ref main
```

Or **Actions → CI → Run workflow** on a branch. Until the staging jobs are
merged, `main`'s workflow has none — name the branch that carries them. The run builds, joins the
tailnet, migrates staging, and installs — and that first install loads
`local.nusantara-stage.api` and `.caddy` by itself. `gh run watch` follows it.

### 9. Check it

```bash
curl -sI https://staging-pos.macbooknusantara.com | head -1
```

`HTTP/2 401` — the gate. In a browser: the gate's prompt, then the POS
sign-in, then your shop username and password.

## Day to day

| | |
|---|---|
| Try a branch | `gh workflow run CI --ref <branch>` |
| …on a fresh copy of the shop | `gh workflow run CI --ref <branch> -f refresh_staging_data=true` |
| What is live | the run's summary, or `ssh -i … nusantara-deploy@nusantara-mini status` |
| Roll back | on the Mac mini: `sudo /usr/local/libexec/nusantara-deploy --stage rollback` |
| Logs | `sudo tail -f /opt/nusantara-stage/logs/api.log` |
| A login on staging only | `sudo -u _nusantara /opt/nusantara-stage/current/ops/run staff --username <u> --name '<n>' --role OWNER --initial` |

A staging release is named `stage-<branch>-<commit>-<run>`, and
`/api/health` answers with it.

**Staging migrates before the shop does** — that is half of what it is for.
When a branch's migration is later rewritten, staging still holds the old one
and the deploy warns *"staging's database has migrations this branch does
not"*; deploy again with the refresh ticked. A refresh by hand on the Mac mini
leaves staging on the shop's schema until the next staging deploy, which is
why the workflow's refresh runs just before it migrates.

A staging deploy does not wait for the test suite: the build is what it
needs, and the tests still run beside it and still report. It builds on
GitHub's `macos-15` runner like a release does, and on a private repository
those minutes count ten-fold against the free 2,000.

## When it fails

| | |
|---|---|
| Check the stage environment is configured | §6 — the error names what is missing |
| Join the tailnet | §5: the credential's subject must end `environment:stage` |
| What is live on staging now: the usage line, or *"refused the staging key"* | the Mac mini runs installer 1, or the key was pinned without `--stage` — §3 again |
| Migrate: `database "nusantara_pos_stage" does not exist` | §4 was skipped |
| Install: *"holds no gate file"* | §2 |
| Install: *"failed its health check"* | the new release did not come up and the old one is serving again; its log lines are above it |
| The address answers 502 | staging's Caddy is not up, or the tunnel route points somewhere other than `127.0.0.1:8081` |

## Undo

Remove the route in Cloudflare, then on the Mac mini:

```bash
sudo launchctl bootout system/local.nusantara-stage.api; sudo launchctl bootout system/local.nusantara-stage.caddy
```

```bash
sudo rm /Library/LaunchDaemons/local.nusantara-stage.api.plist /Library/LaunchDaemons/local.nusantara-stage.caddy.plist
```

The install (`/opt/nusantara-stage`), the database and the key can stay or go;
none of them touches the shop.

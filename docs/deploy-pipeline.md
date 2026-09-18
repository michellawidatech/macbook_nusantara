# The deploy pipeline

Pushing a `v*` tag deploys that tag to the shop's Mac mini. This file is the
one-time setup, how to release, how to roll back, and what each failure means.
`docs/deploy-macmini.md` is the machine itself — how it was set up, and how to
do by hand what the pipeline does.

```
git push origin v2026.09.18
  │
  ├─ static, test     ubuntu      the same gates every push runs
  ├─ release          macos-15    deploy/macmini/build-release.mjs on Apple silicon
  │                               → the tag's GitHub Release: tarball, .sha256, source maps
  └─ deploy           ubuntu      environment prod (v* tags only)
       join the tailnet as tag:ci (ephemeral; reaches the Mac mini's port 22, nothing else)
       ssh … status                          what is live now
       ssh … backup predeploy-<version>      pg_dump before anything changes
       ssh -L 55432:127.0.0.1:5432 …         prisma migrate deploy, as the owner
       psql …                                every migration applied, none half-done,
                                             nusantara_app's grants t|f|t|f|t
       ssh … install <version> <sha256> < tarball
             check hash and shape → unpack → switch `current` → restart
             → /api/health must name <version> → otherwise switch BACK by itself
```

Every `ssh …` above lands in `ops/nusantara-deploy` on the Mac mini, whatever
the command line says: the deploy key has a forced command, so the job cannot
open a shell there, and the script accepts four verbs — `status`, `backup`,
`install` and `rollback` — and nothing else.

## Why it has this shape

- **The release is built on GitHub, never on the Mac mini.** The release exists
  so the shop's machine holds compiled output and no source
  (`docs/deploy-macmini.md`, "What without the source buys"). A GitHub runner
  installed on the Mac mini would check the repository out there. GitHub's
  `macos-15` runner is Apple silicon, so it produces the same darwin-arm64
  Prisma engine and argon2 binary the Mac mini loads.
- **Tailscale is the only way in.** No port is open on the shop's router,
  nothing runs on the Mac mini between deploys, and the Mac mini holds no
  GitHub credential. The CI's node is ephemeral and tagged, and the tailnet
  policy decides what the tag can reach.
- **Every credential lives in the `prod` environment**, which admits only
  `v*` tags. A branch — anybody's — cannot reach the SSH key, the Tailscale
  identity or the owner's database password.
- **Migrations are checked by asking the database.** `prisma migrate status`
  lies in this project (CLAUDE.md), which is exactly why CI did not deploy
  before: the step that would report a bad migration was the one that could
  not be trusted. The pipeline never asks Prisma whether it worked.

## One-time setup

Three places: the tailnet, the Mac mini, and GitHub. About half an hour.

### 1. The tailnet

In the Tailscale admin console → **Access controls**, add the tag and the one
thing it may reach. With `grants` (current policy files):

```jsonc
"tagOwners": {
  "tag:ci": ["autogroup:admin"],
},
"hosts": {
  "nusantara-mini": "100.x.y.z", // the Mac mini's Tailscale IP
},
"grants": [
  // … your existing rules …
  { "src": ["tag:ci"], "dst": ["nusantara-mini"], "ip": ["tcp:22"] },
],
```

With the older `acls` syntax the rule is
`{ "action": "accept", "src": ["tag:ci"], "dst": ["nusantara-mini:22"] }`.

⚠️ If the policy still has the default allow-everything rule (`"src": ["*"]`),
change that rule's source to `autogroup:member`. `*` includes tagged nodes, so
it would let every CI run reach every device on the tailnet — your laptop
included. `autogroup:member` is every signed-in person's device, and no tagged
one.

Then, in **Machines**, open the Mac mini → **Disable key expiry**. Otherwise it
drops off the tailnet every 180 days, and the till and the pipeline go with it.

**The CI's identity** — preferred, because nothing secret is stored in GitHub:
**Settings → Trust credentials → New credential → OpenID Connect**, issuer
**GitHub**, subject `repo:michellawidatech/macbook_nusantara:environment:prod`,
scope **Auth keys: write**, tag `tag:ci`. It gives a client ID and an audience.

The alternative is an OAuth client with the same scope and tag, which gives a
client ID and a secret. The workflow takes either (step 3).

### 2. The Mac mini

On your laptop, make the deploy key — it is used by GitHub and nothing else:

```bash
ssh-keygen -t ed25519 -N '' -C github-actions@nusantara -f ~/nusantara-deploy-key
```

Copy the two scripts across, then run the setup as an admin on the Mac mini,
passing the PUBLIC half:

```bash
scp deploy/macmini/ops/nusantara-deploy deploy/macmini/ops/setup-deploy-access <admin>@nusantara-mini:/tmp/
ssh -t <admin>@nusantara-mini "sudo zsh /tmp/setup-deploy-access '$(cat ~/nusantara-deploy-key.pub)'"
```

It creates `nusantara-deploy` (hidden, no password, key-only), installs
`nusantara-deploy` root-owned at `/usr/local/libexec/`, adds one sudoers rule
for it, and pins the key with a forced command. At the end it prints the host
key line GitHub needs. Re-run it whenever `ops/nusantara-deploy` changes — a
release never updates the installed copy — or to rotate the key; the pipeline
warns when the two copies' `INSTALLER_VERSION` differ.

Check it from your laptop over the tailnet:

```bash
ssh -i ~/nusantara-deploy-key nusantara-deploy@nusantara-mini status
```

It prints `installer=1`, `current=…` and the loaded services. `ssh … bash` or
anything else gets the usage line.

### 3. GitHub

**Settings → Environments → prod** already admits only `v*` tags. Add:

| | Name | Value |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | the PRIVATE key: `cat ~/nusantara-deploy-key` |
| Secret | `PROD_OWNER_DATABASE_URL` | `postgresql://nusantara:<OWNER_PW>@127.0.0.1:55432/nusantara_pos_prod` — the tunnel's end, never the Mac mini's address |
| Secret | `TS_OAUTH_CLIENT_ID` | the client ID from step 1 |
| Secret | `TS_OAUTH_SECRET` | only for an OAuth client |
| Variable | `TS_AUDIENCE` | only for workload identity — its audience |
| Variable | `DEPLOY_HOST` | the Mac mini's MagicDNS name, e.g. `nusantara-mini.tailXXXX.ts.net` |
| Variable | `DEPLOY_KNOWN_HOSTS` | the line setup printed, with `<DEPLOY_HOST>` replaced |
| Variable | `DEPLOY_USER` | optional; defaults to `nusantara-deploy` |
| Variable | `DEPLOY_PUBLIC_URL` | optional, e.g. `https://nusantara-mini.tailXXXX.ts.net` — a last check through `tailscale serve`; needs `tcp:443` beside `tcp:22` in the grant |

Then delete the private key from your laptop, or keep it in your password
manager: GitHub is the only thing that should hold it.

## Releasing

1. Everything the release needs is committed and pushed, and CI is green on
   that commit.
2. Tag it and push the tag:

   ```bash
   git tag v2026.09.18
   git push origin v2026.09.18
   ```

   A second release the same day is `v2026.09.18.2`.

   ⚠️ `v2026.09.18` itself is taken, locally and on GitHub: it was pushed at
   `f6f5f3c` — the 2026-09-11 code, before this pipeline was committed — and
   its CI run failed on format, lint and tests, so it built and deployed
   nothing. Use `v2026.09.18.2` or a later date, or delete that tag first
   (`git tag -d v2026.09.18 && git push origin :refs/tags/v2026.09.18`).
3. Watch it: `gh run watch`, or the Actions tab. The deploy job's summary names
   what was live before, the backup it took, and the installer's own account.

The restart is a second or two. A till mid-sale sees the offline banner and
commits when the API is back; nothing is lost. Tag after closing time anyway
when a release carries a migration.

## Rolling back

**The fast way — seconds, no CI.** On the Mac mini, as an admin:

```bash
sudo /usr/local/libexec/nusantara-deploy rollback
```

It switches to the release that was live before the last deploy, restarts,
and health-checks it. Migrations are not touched.

**Through the pipeline — any earlier tag.** Actions → **CI** → **Run workflow**
→ *Use workflow from* → **Tags** → the tag to go back to. The gates run again,
the release job finds that tag's tarball already on its GitHub Release and
reuses the exact bytes, the migrations step applies nothing new, and the
installer switches to the release — still unpacked on the Mac mini if it is
one of the last five.

**The database is never rolled back automatically.** Restoring a dump erases
every sale made since it was taken. Each deploy leaves
`/opt/nusantara/backups/nusantara-<date>-predeploy-<version>.dump`; restoring
one is a decision for the owner, done by hand.

That is why a migration must never break the release before it: the code can
go back, the schema cannot. Add first; drop or rename only in a later release,
once no deployed code reads the old shape.

## When it fails

| The step that failed | What it means | What to do |
|---|---|---|
| Check the prod environment is configured | a secret or variable is missing | the error names it; step 3 above |
| Join the tailnet | the Tailscale credential is wrong, or `tag:ci` is not in `tagOwners` | step 1 |
| What is live now: `Permission denied (publickey)` | the key is not the one setup pinned, or Remote Login does not allow `nusantara-deploy` | re-run setup-deploy-access with the right public key. If it persists, give the account a random password nobody keeps: `sudo dscl . -passwd /Users/nusantara-deploy "$(openssl rand -hex 32)"` |
| What is live now: `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` does not match `DEPLOY_HOST` | re-take the line from setup's output |
| What is live now: `sudo: a password is required` | the sudoers rule is missing | re-run setup-deploy-access |
| Migrate | a migration failed partway | nothing was switched; the API still runs the old release against the database. Read the migration's error, fix it, tag again |
| Verify the schema | a migration is missing or half-applied, or the grants changed | nothing was switched. The message says which |
| Install: `sha256 mismatch` / `refusing the tarball` | the upload was damaged, or not a release | nothing was switched; re-run the job |
| Install: `failed its health check; … is serving again` | the new release did not come up; the installer put the old one back | the log lines above it are the new release's own; fix, tag again |
| Install: `… is not healthy either` | neither release comes up — most likely the database or the machine itself | look at the Mac mini now |

## The pieces

| | |
|---|---|
| `.github/workflows/ci.yml` | the `release` and `deploy` jobs |
| `deploy/macmini/build-release.mjs` | the sealed release; `NUSANTARA_VERSION` names it |
| `deploy/macmini/ops/nusantara-deploy` | the installer the key is pinned to |
| `deploy/macmini/ops/setup-deploy-access` | the one-time setup on the Mac mini |
| `deploy/macmini/ops/run` | exports `NUSANTARA_RELEASE`, which `/api/health` reports |
| `deploy/macmini/ops/backup` | takes the `predeploy-<version>` label |

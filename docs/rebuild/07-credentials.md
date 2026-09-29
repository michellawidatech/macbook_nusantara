# Credentials

Every secret the system uses: what it is, where it came from, who reads it, how
to rotate it, and what happens if it leaks. The rebuild replaces the UI — it must
not lose the keys, and it must not scatter them further than they already are.

---

## 0. This project's actual values

Concrete configuration for *this* shop, so a fresh checkout does not have to
guess. **These are identifiers, not secrets** — they are useless without the
tokens, and they are exactly what you need to find the right app in a dashboard.

| Setting | Value |
|---|---|
| Meta App ID | `2157052578394015` |
| WhatsApp Business Account (WABA) ID | `1701973881546032` |
| WhatsApp `PHONE_NUMBER_ID` | `1200651716467039` |
| `GRAPH_API_VERSION` | **`v25.0`** — pinned, one constant, both channels |
| Webhook port | `3001`, callback path `/webhook` |
| API port / SPA port / Monitor port | `4000` / `3000` / `4100` |
| Database | `nusantara_pos_app` on `localhost:5432`, role `nusantara` |
| `AUTH_URL` (legacy) | `http://localhost:3000` |

**The four real secrets stay out of these markdown files.** `APP_SECRET`,
`VERIFY_TOKEN`, `WHATSAPP_TOKEN` and `ANTHROPIC_AUTH_TOKEN` live only in
`secrets/webhook-credentials.env`, which is gitignored and `chmod 600`. Docs get
committed and pushed; that is the whole reason for the split, and it costs you
one command to carry them across:

```bash
mkdir -p <new-project>/secrets && cp secrets/webhook-credentials.env <new-project>/secrets/ && chmod 600 <new-project>/secrets/webhook-credentials.env
```

That single file plus this folder is everything the new project needs. If you
would still rather have the token strings inline in the markdown, say so and I
will add them — but the vault file already makes the plan self-contained without
putting live credentials into git history.

---

## 1. Inventory

| Key | What | Source | Read by | Rotation | If leaked |
|---|---|---|---|---|---|
| `APP_SECRET` | Meta App Secret — HMAC key for `X-Hub-Signature-256` | Meta app → Settings → Basic | `whatsapp-webhook`, `packages/instagram` | On suspicion; forces a brief webhook outage | **Critical.** Anyone can forge events into the agent. Rotate immediately |
| `VERIFY_TOKEN` | Random string echoed during the webhook handshake | You (`openssl rand -hex 32`) | `whatsapp-webhook` | Any time; re-verify the callback afterwards | Low. Only useful while registering a callback URL |
| `WHATSAPP_TOKEN` | System-user access token, WA scopes | Business Settings → System Users | `whatsapp-webhook`, `apps/api` | 12 months, or on staff departure | **Critical.** Messages can be sent as the shop |
| `PHONE_NUMBER_ID` | WA business number id | WhatsApp → API Setup | `whatsapp-webhook`, `apps/api` | Only if the number changes | Not secret; an identifier |
| `IG_ACCESS_TOKEN` | System-user token, IG scopes | Business Settings → System Users | `whatsapp-webhook`, `apps/api` | 12 months | **Critical.** Comments/DMs can be posted as the shop |
| `IG_BUSINESS_ACCOUNT_ID` | Connected IG business account id | `GET /me/accounts` | same | Only if the account changes | Not secret; an identifier |
| `GRAPH_API_VERSION` | Pinned Graph version — **`v25.0`** | — | both clients | Deliberately, when upgrading | Not secret |
| `ANTHROPIC_API_KEY` | Agent LLM key | console.anthropic.com | `whatsapp-webhook`, `apps/api` | 6 months | **High.** Billable. Revoke in the console |
| `ANTHROPIC_AUTH_TOKEN` | OAuth bearer alternative to the key | Anthropic OAuth | `whatsapp-webhook` | Per its own expiry | High. Same as above |
| `DATABASE_URL` | Postgres connection string, with password | Your Postgres | `apps/api`, webhook, `packages/db` | On any host or role change | **Critical.** Full data access |
| `JWT_SECRET` | Signs the POS session cookie | You (`openssl rand -hex 32`) | `apps/api` | 6 months; rotating logs everyone out | **Critical.** Sessions can be forged for any staff |
| `AUTH_SECRET` | Legacy secret from the Next.js build | Prior build | nothing current | Delete after the rebuild | Low, but remove it |
| `MONITOR_TOKEN` | Break-glass access to the Monitor app | You | `apps/monitor` | 6 months | Medium. Read access to logs |
| ngrok reserved domain + authtoken | Stable dev callback URL | ngrok dashboard | developer machines | Rarely | Low. Someone else could claim the tunnel |

Removed by this rebuild — delete rather than carry forward:
`SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID`,
`SHOPEE_REFRESH_TOKEN`, `SHOPEE_OPEN_BASE_URL`, and every `MARKET_SCRAPE_*`
variable. They belong to the marketplace and competitor-analysis features that
are out of scope. **Revoke the Shopee credentials at the source**, do not merely
delete the lines — an unused-but-valid key is worse than a used one, because
nobody is watching it.

---

## 2. Where secrets live

| Environment | Storage | Notes |
|---|---|---|
| Developer machine | `apps/*/.env`, gitignored by the `*.env` rule | Never shared over chat or email |
| Canonical backup | `secrets/webhook-credentials.env` — gitignored, `chmod 600` | The "do not lose the keys" copy |
| Production | The host's secret store (systemd `EnvironmentFile` with mode 600, or the platform's secret manager) | Never a file inside the deploy directory |
| CI | Repository/organisation secrets | Tests must **not** need real credentials — see §5 |

**Verify the ignore rule rather than trusting it**, every time you add a file
under `secrets/`:

```bash
git check-ignore -v secrets/webhook-credentials.env
```

No output means **it is not ignored** and is one `git add .` from being
committed. `.gitignore:9` (`*.env`) is what currently covers it.

---

## 3. Creating the canonical backup

`secrets/webhook-credentials.env.example` is committed as the documented shape.
The real file is never committed.

> **`secrets/webhook-credentials.env` already exists and already holds the real
> Meta credentials.** Do not regenerate it from a script — you would overwrite
> working keys. Verify it and fill the gaps instead.

### Current state (verified 2026-08-13)

| Key | State |
|---|---|
| `META_APP_ID`, `WABA_ID` | **Set** — identifiers, not secrets; needed to assign system-user assets |
| `APP_SECRET` | **Set** — 32-hex |
| `VERIFY_TOKEN` | **Set** — but a guessable dev string, see §2a |
| `WHATSAPP_TOKEN` | **Set** — 200+ char system-user token |
| `PHONE_NUMBER_ID` | **Set** — empty in `./.env`, correct in `apps/whatsapp-webhook/.env` |
| `GRAPH_API_VERSION` | **Set** to `v25.0` — decided; see §2a defect 1 |
| `DATABASE_URL` | **Set** — local dev; password equals username |
| `AUTH_SECRET`, `AUTH_URL` | **Set** — legacy Next.js; `AUTH_SECRET` reuses the `VERIFY_TOKEN` string |
| `ANTHROPIC_AUTH_TOKEN` | **Set** — the OAuth token is the credential in use |
| `ANTHROPIC_API_KEY` | Empty **by design** — only one of the two is needed |
| `IG_ACCESS_TOKEN` | **Required** — obtain per [06 §5](06-webhook-integration.md#5-instagram-setup). Gates Increment 7 |
| `IG_BUSINESS_ACCOUNT_ID` | **Required** — same |
| `JWT_SECRET` | **Required** — lives in `apps/api/.env`; copy it across |
| `MONITOR_TOKEN` | **Required** — `openssl rand -hex 32` |

### 2a. Known defects in the current credential set

Recorded here rather than fixed silently, because each is a decision:

1. **`GRAPH_API_VERSION` — DECIDED: `v25.0` everywhere.** It previously disagreed
   (`v21.0` in `./.env`, `v25.0` in the webhook's `.env`, and
   `packages/instagram/src/config.ts` defaulting to `v21.0` when unset), so
   WhatsApp ran v25.0 while Instagram could silently run v21.0. In the rebuild
   the version is a **single constant in one module**, not an env var read in two
   places with two different fallbacks.
2. **`AUTH_SECRET` reuses the `VERIFY_TOKEN` string.** One guessable value
   spanning two unrelated trust domains. `AUTH_SECRET` is legacy and should be
   deleted; if anything still reads it, give it its own random value first.
3. **`VERIFY_TOKEN` is a guessable dev string**, not `openssl rand -hex 32`. Low
   severity — it only matters at callback registration — but rotate it as the
   rehearsal called for in §5 rule 6, since re-verifying the callback is exactly
   the drill you want to have done before touching `APP_SECRET`.
4. **`PHONE_NUMBER_ID` is empty in `./.env`.** Any process loading the root file
   cannot send, and the failure surfaces as a confusing Graph error rather than a
   missing-config error.
5. **`DATABASE_URL` uses `nusantara:nusantara`.** Fine locally; it must not reach
   a shared or production host.

### Verifying without printing values

Which keys are present:

```bash
grep -oE '^[A-Z_]+' secrets/webhook-credentials.env | sort
```

Which look like unfilled placeholders (prints key names only):

```bash
cd ~/claudeproject/macnus_redo && while IFS='=' read -r k v; do case "$k" in ''|\#*) continue;; esac; case "$v" in *'<'*|*'>'*|*' '*|*your*|*YOUR*|*xxx*|*XXX*|*TODO*|*REPLACE*) echo "PLACEHOLDER: $k";; esac; done < secrets/webhook-credentials.env
```

Whether a key here matches the one the service actually loads — compare
fingerprints, never values (see §4):

```bash
cd ~/claudeproject/macnus_redo && for k in APP_SECRET VERIFY_TOKEN WHATSAPP_TOKEN PHONE_NUMBER_ID; do a=$(grep -m1 "^$k=" secrets/webhook-credentials.env | cut -d= -f2- | tr -d '"'"'"'); b=$(grep -m1 "^$k=" apps/whatsapp-webhook/.env | cut -d= -f2- | tr -d '"'"'"'); printf '%-18s %s\n' "$k" "$([ "$a" = "$b" ] && echo match || echo DIFFERS)"; done
```

### Filling the gaps

Edit `secrets/webhook-credentials.env` by hand — there are only a handful of
lines and a hand edit cannot clobber a working key. For each gap, replace the
placeholder with the real value, keeping the quoting style of the lines already
there. Then re-run the three checks above, and:

```bash
chmod 600 secrets/webhook-credentials.env && git check-ignore -v secrets/webhook-credentials.env
```

Keep `secrets/webhook-credentials.env.example` open alongside it — the template
carries the per-key documentation that the real file deliberately does not
duplicate.

**Store a copy outside this machine** — a password manager entry per key, or one
encrypted attachment. A gitignored file on one laptop is not a backup; it is a
single point of failure with good manners.

---

## 4. Comparing secrets safely

To check whether two environments hold the same value, compare **fingerprints**,
never values — a fingerprint is safe to paste into a chat, a ticket or a PR:

```bash
printf '%s' "$APP_SECRET" | shasum -a 256 | cut -c1-12
```

Same first twelve hex characters ⇒ same secret.

---

## 5. Rules

1. **A secret never enters the repository.** Not in a test fixture, not in a
   comment, not in a commit message, not in a screenshot.
2. **Tests never require real credentials.** Fail-closed behaviour is tested by
   *injecting* config, not by reading `.env`. A test that passes only on the
   developer's machine tests the machine. (See commit `d6f18dd`.)
3. **Never log a secret**, even truncated. The redaction rules in
   [05 §6](05-logging.md#6-redaction) are a safety net, not permission to try.
4. **Never report which secrets are set** on a public endpoint. The webhook's
   status page deliberately omits this.
5. **One secret, one purpose.** Do not reuse `JWT_SECRET` for cookie signing and
   CSRF and anything else — rotation then becomes impossible without breaking
   something unrelated.
6. **Rotation is a rehearsed procedure, not an emergency improvisation.** Rotate
   `VERIFY_TOKEN` once deliberately, in staging, before you ever need to rotate
   `APP_SECRET` in anger.

---

## 6. Rotation runbook

**`APP_SECRET`** — the only one with an unavoidable gap.
1. Meta app → Settings → Basic → *App Secret* → **Reset**.
2. Update the production secret store and restart the webhook.
3. Inbound events between reset and restart fail signature verification and are
   rejected. Meta retries for ~36 h, so nothing is lost if you are quick.
4. Confirm with a signed test event (§10.2 of [06](06-webhook-integration.md)) and
   watch for `wa.event.rejected` in the logs.

**`WHATSAPP_TOKEN` / `IG_ACCESS_TOKEN`** — no gap if ordered correctly.
1. Generate the new system-user token first.
2. Deploy it.
3. Verify a real send.
4. *Then* revoke the old token in Business Settings.

**`VERIFY_TOKEN`** — update `.env`, restart, then re-enter the callback URL and
the new token in the dashboard and press *Verify and save*. Existing
subscriptions keep working until you do.

**`JWT_SECRET`** — rotating invalidates every session. Do it out of hours and
tell staff they will be logged out. With `StaffSession`
([08 §9](08-data-integrity.md#9-security)) you can instead revoke selectively,
which is the better tool for a single compromised account.

**`DATABASE_URL`** — change the Postgres role's password, update the store,
restart every app. Confirm the webhook reconnected; it fails quietly otherwise.

---

## 7. If a secret leaks

1. **Revoke first, investigate second.** A key you are still reasoning about is a
   key still working for whoever has it.
2. Rotate per §6.
3. Scope the exposure: `git log -S '<fingerprint-free search term>'` across all
   branches; check whether the commit was ever pushed; check the log sink.
4. If it reached a remote branch, treat it as public **even after a force-push** —
   forks, mirrors and CI caches keep copies.
5. Review Meta's app activity and Anthropic's usage for the exposure window.
6. Write down what happened and which control would have caught it, in this file.

---

## 8. Definition of done

- [x] `secrets/webhook-credentials.env` exists, is `600`, and `git check-ignore` confirms it is ignored *(2026-08-13)*
- [x] Meta app keys, WhatsApp token, phone number id, database URL and the Anthropic OAuth token captured *(2026-08-13)*
- [ ] `IG_ACCESS_TOKEN` and `IG_BUSINESS_ACCOUNT_ID` obtained — gates Increment 7
- [ ] `JWT_SECRET` copied from `apps/api/.env`; `MONITOR_TOKEN` generated
- [ ] The five defects in §2a each decided: fixed, or accepted in writing
- [ ] `WHATSAPP_TOKEN`, `APP_SECRET` and `ANTHROPIC_AUTH_TOKEN` rotated — they were pasted into a chat transcript on 2026-08-13 (§7)
- [ ] A second copy exists off this machine, in a password manager
- [ ] Shopee and market-scrape credentials revoked at the source and deleted from every `.env`
- [ ] `AUTH_SECRET` removed once nothing reads it
- [ ] `.env.example` regenerated to match the rebuilt scope, with no real values
- [ ] One rotation rehearsed end to end and timed

# Webhook integration guide — WhatsApp + Instagram

Everything needed to take a fresh Meta app to a working chatbot: what each key
is, where it comes from, the exact contract our server implements, how to test
it without Meta, and what breaks in practice.

Written so someone who has never opened the Meta dashboard can finish it, and so
someone who has can skip to §9.

---

## 1. What you are building

```
                    ┌──────────────────────────────────────────────┐
  customer's        │  Meta                                        │
  WhatsApp    ────► │  WhatsApp Cloud API  ──┐                     │
  or IG comment ──► │  Instagram Graph API ──┤                     │
                    └────────────────────────┼─────────────────────┘
                                             │ HTTPS POST, signed
                                             ▼
                            ┌────────────────────────────────┐
                            │ apps/whatsapp-webhook   :3001  │
                            │  1. verify HMAC signature      │
                            │  2. reply 200 immediately      │
                            │  3. persist raw event          │
                            │  4. process out of band        │
                            └───────────┬────────────────────┘
                                        │
                     ┌──────────────────┼──────────────────┐
                     ▼                  ▼                  ▼
              WaRawEvent /        agent pipeline      Graph API send
              IgRawEvent          (Anthropic)         (reply / DM)
              WaMessage /               │                  │
              IgComment  ◄──────────────┘                  │
                     │                                     │
                     ▼                                     │
              apps/api :4000  ──►  POS inbox (Pesan / Komentar)
                     └───────── staff reply ───────────────┘
```

**One Meta app serves both channels.** The App Secret signs every event from both
WhatsApp and Instagram, which is why `APP_SECRET` appears once and is shared.

---

## 2. The five keys, in one table

| Key | What it is | Who creates it | Where it is used |
|---|---|---|---|
| `APP_SECRET` | Meta App Secret. HMAC key for `X-Hub-Signature-256` | Meta | Verifying **every** inbound event |
| `VERIFY_TOKEN` | A random string **you invent** | You | Only during the one-time `GET /webhook` handshake |
| `WHATSAPP_TOKEN` | Access token for sending WhatsApp messages | Meta | `Authorization: Bearer` on Graph sends |
| `PHONE_NUMBER_ID` | Numeric id of the WA business number (**not** the phone number) | Meta | The `{id}` in `/{PHONE_NUMBER_ID}/messages` |
| `IG_ACCESS_TOKEN` + `IG_BUSINESS_ACCOUNT_ID` | Instagram send credentials | Meta | Comment replies and DMs |

The two most common misunderstandings, stated plainly:

- **`VERIFY_TOKEN` is not from Meta.** You make it up, put it in `.env`, and type
  the same string into the dashboard. It proves *you* own the callback URL. It is
  used once at registration and never again.
- **`APP_SECRET` is the one that matters at runtime.** It authenticates every
  single event. Treat it like a database password.

Full inventory, rotation and storage: [07-credentials.md](07-credentials.md).

---

## 3. Prerequisites

- A Facebook **Business** account.
- A Meta **app** of type *Business* — <https://developers.facebook.com/apps>.
- For WhatsApp: a WhatsApp Business Account (WABA). Meta gives you a free test
  number immediately; a real number can be added later.
- For Instagram: an IG **Business or Creator** account connected to a Facebook
  Page you administer. A personal IG account cannot receive webhooks.
- A public HTTPS URL. In development, ngrok (§6). Meta will not call `http://`
  and will not call `localhost`.
- Node ≥ 20 and this repo running.

---

## 4. WhatsApp Cloud API setup

**4.1 Add the product.** App Dashboard → *Add product* → **WhatsApp** → *Set up*.

**4.2 Collect the ids.** WhatsApp → **API Setup** shows:
- *Phone number ID* → `PHONE_NUMBER_ID`
- *WhatsApp Business Account ID* → keep it, you need it to assign the system user
- A **temporary** access token (24 h) — fine for the first smoke test, useless
  after tomorrow.

**4.3 Get a permanent token.** The 24-hour token expiring silently at 3 a.m. is
the single most common "the bot stopped working" cause.

1. <https://business.facebook.com> → **Business Settings** → *Users* → **System
   Users** → **Add**. Name it `nusantara-webhook`, role *Admin*.
2. **Add Assets** → *Apps* → your app → toggle **Manage app**.
3. **Add Assets** → *WhatsApp Accounts* → your WABA → **Full control**.
4. **Generate new token** → select your app → scopes:
   - `whatsapp_business_messaging` (send + receive)
   - `whatsapp_business_management` (manage numbers and templates)
5. Expiry: **Never**. Copy the token — *it is shown once*. → `WHATSAPP_TOKEN`

**4.4 App Secret.** Settings → **Basic** → *App Secret* → **Show**. → `APP_SECRET`

**4.5 Invent the verify token.**

```bash
openssl rand -hex 32
```

Put the output in `.env` as `VERIFY_TOKEN`. You will paste the same value into
the dashboard in §7.

---

## 5. Instagram setup

**5.1 Connect the account.** The IG account must be **Business** or **Creator**
and linked to a Facebook Page (IG app → Settings → *Account type and tools*, then
Page → Settings → *Linked accounts*).

**5.2 Add the product.** App Dashboard → *Add product* → **Instagram** → *Set up*.

**5.3 Permissions.** Request on the app: `instagram_basic`,
`instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`,
`pages_read_engagement`. Development mode covers accounts with a role on the app;
**App Review is required before it works for the public**, and review takes days —
start it early.

**5.4 Token.** Add the same Page/IG assets to the system user from §4.3 and
generate a token with the scopes above → `IG_ACCESS_TOKEN`. A system-user token
does not expire; a Page token from the Graph Explorer expires in 60 days and will
strand you.

**5.5 Business account id.**

```bash
curl -s "https://graph.facebook.com/v25.0/me/accounts?fields=instagram_business_account,name&access_token=$IG_ACCESS_TOKEN"
```

Take `instagram_business_account.id` → `IG_BUSINESS_ACCOUNT_ID`.

---

## 6. Exposing localhost

```bash
ngrok http 3001
```

Copy the `https://` forwarding URL. Your callback URL is that plus `/webhook`:

```
https://<subdomain>.ngrok-free.app/webhook
```

A free ngrok URL changes on every restart, and **every change means re-entering
the callback URL in the dashboard**. A reserved ngrok domain, or a small VPS with
Caddy terminating TLS, is worth it within a week.

> This project already has a reserved ngrok domain from the previous build. Check
> [07-credentials.md](07-credentials.md) before creating a new one.

---

## 7. Register the callback

Start the webhook first — the dashboard calls it synchronously and fails if
nothing answers:

```bash
pnpm --filter @nusantara/whatsapp-webhook dev
```

**WhatsApp** → *Configuration* → **Edit**:
- *Callback URL*: `https://<your-domain>/webhook`
- *Verify token*: the `VERIFY_TOKEN` string from §4.5
- **Verify and save**

Then *Webhook fields* → **Manage** → subscribe to **`messages`**. Without this
subscription the handshake succeeds and no events ever arrive — a genuinely
confusing state, because everything looks configured.

**Instagram** → *Configuration* → same callback URL and verify token →
subscribe to **`comments`** (and `messages` if you want DM handling later).

What happens during "Verify and save":

```
Meta ──► GET /webhook?hub.mode=subscribe
                     &hub.verify_token=<yours>
                     &hub.challenge=1158201444
     ◄── 200, body: 1158201444        (echo the challenge verbatim, as text/plain)
```

Our handler ([`apps/whatsapp-webhook/src/app.ts:98`](../../apps/whatsapp-webhook/src/app.ts))
compares with `timingSafeEqual`, and **returns 503 when `VERIFY_TOKEN` is
unset** — otherwise an empty configured token would match an empty supplied one
and let anyone register this host as their callback.

---

## 8. Environment file

`apps/whatsapp-webhook/.env`:

```dotenv
PORT=3001
APP_SECRET=<Settings → Basic → App Secret>
VERIFY_TOKEN=<your openssl rand -hex 32>
WHATSAPP_TOKEN=<system user token>
PHONE_NUMBER_ID=<WhatsApp → API Setup>
GRAPH_API_VERSION=v25.0
IG_ACCESS_TOKEN=<system user token, IG scopes>
IG_BUSINESS_ACCOUNT_ID=<from §5.5>
ANTHROPIC_API_KEY=<for the agent>
```

Config is loaded by [`src/config.ts`](../../apps/whatsapp-webhook/src/config.ts)
via `process.loadEnvFile`. A missing `.env` is **not** fatal — values may come
from the shell — which is convenient in production and a trap in tests. Tests
must inject config explicitly rather than inheriting the developer's `.env`;
this repo has already been bitten by that (commit `d6f18dd`).

---

## 9. The contract our server implements

Four properties, in priority order. Do not reorder them in a rewrite.

### 9.1 Fail closed

```ts
if (!config.appSecret) return res.status(503).send("app secret not configured");
if (!verifySignature(raw, signature, config.appSecret)) return res.status(401).send("invalid signature");
```

A missing `APP_SECRET` **rejects** traffic. It must never degrade to "skip
verification in development", because this endpoint drives an agent that sends
messages from the shop's verified number. An unauthenticated version of it is a
free megaphone.

The public status page at `/` deliberately does **not** report which secrets are
set — advertising `appSecretSet: false` next to `canSend: true` hands an attacker
a confirmed target.

### 9.2 Verify over the raw bytes

The HMAC is computed over the **exact bytes Meta sent**. `JSON.parse` followed by
`JSON.stringify` reorders keys and changes whitespace, and the signature will
never match. Express is configured to keep the raw buffer:

```ts
express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } })
```

Comparison is constant-time
([`src/signature.ts`](../../apps/whatsapp-webhook/src/signature.ts)) — a
byte-by-byte early return leaks the expected signature through timing.

### 9.3 Ack fast, process later

```ts
res.status(200).send({ status: "ok" });
setImmediate(() => void handleInbound(req.body));
```

Meta retries deliveries that are slow or non-2xx, with backoff, for up to
~36 hours. Processing inline means an Anthropic call sits inside Meta's timeout,
Meta retries, and the customer gets the same answer three times. **Ack first,
always.**

### 9.4 Deduplicate

Retries mean the same message arrives more than once. `WaMessage.waMessageId` and
`IgComment.igCommentId` are `UNIQUE`, and persistence inserts first and treats a
unique violation as "already handled"
([`src/persist.ts`](../../apps/whatsapp-webhook/src/persist.ts)). The database
constraint is the dedup mechanism — a `findFirst`-then-`create` check loses the
race between two concurrent retries.

### 9.5 Routing

`payload.object` selects the pipeline
([`src/app.ts:33`](../../apps/whatsapp-webhook/src/app.ts)):

| `object` | Path |
|---|---|
| `"instagram"` | `persistInboundIg()` → `processComment()` — public reply, optional DM |
| anything else | `persistInbound()` → debounce per sender → `runConversation()` |

WhatsApp messages are **debounced per sender**
([`src/agent/debounce.ts`](../../apps/whatsapp-webhook/src/agent/debounce.ts)):
a customer who sends "halo" / "mau tanya" / "ada macbook?" as three messages gets
one considered answer rather than three fragments.

---

## 10. Testing without Meta

### 10.1 Handshake

```bash
curl -i "http://localhost:3001/webhook?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=test123"
```

Expect `200` and a body of exactly `test123`. A `403` means the token differs; a
`503` means `VERIFY_TOKEN` is unset in the server's environment.

### 10.2 A signed event

The signature must cover the exact bytes sent, so build the body once into a
variable and reuse it:

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"id":"0","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"628","phone_number_id":"0"},"contacts":[{"profile":{"name":"Test"},"wa_id":"628123456789"}],"messages":[{"from":"628123456789","id":"wamid.TEST1","timestamp":"1760000000","type":"text","text":{"body":"ada macbook air m2?"}}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$APP_SECRET" -binary | xxd -p -c 256)
curl -i -X POST http://localhost:3001/webhook -H "Content-Type: application/json" -H "X-Hub-Signature-256: sha256=$SIG" -d "$BODY"
```

Expect `200 {"status":"ok"}` immediately, then a `WaRawEvent` row, a `WaMessage`
row, and (with an Anthropic key set) a reply in `WaMessage.replyText`.

### 10.3 Rejection paths — test these too

```bash
curl -i -X POST http://localhost:3001/webhook -H "Content-Type: application/json" -d "$BODY"                                  # → 401 (no signature)
curl -i -X POST http://localhost:3001/webhook -H "X-Hub-Signature-256: sha256=deadbeef" -H "Content-Type: application/json" -d "$BODY"  # → 401 (bad signature)
```

Re-POST the identical valid request: it must return `200` and create **no** new
rows. That is the dedup test.

### 10.4 Automated

`apps/whatsapp-webhook/src/app.test.ts` and `app.failclosed.test.ts` already
cover handshake, signature rejection, fail-closed-with-no-secret and dedup. Keep
them; they are the regression net for every rule in §9.

---

## 11. Sending

**WhatsApp** ([`packages/whatsapp/src/client.ts`](../../packages/whatsapp/src/client.ts)):

```
POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages
Authorization: Bearer {WHATSAPP_TOKEN}
{ "messaging_product": "whatsapp", "to": "628…", "type": "text", "text": { "body": "…" } }
```

**The 24-hour window.** You may send free-form text only within 24 hours of the
customer's last message. Outside it, only a **pre-approved template** will
deliver — and the API returns success-shaped errors that are easy to miss. The
inbox UI must show the remaining window per thread; a reply box that looks
functional but silently cannot deliver is worse than a disabled one.

**Instagram** ([`packages/instagram/src/client.ts`](../../packages/instagram/src/client.ts)):
public comment reply via `POST /{comment-id}/replies`; private reply (DM) via
`POST /{ig-business-account-id}/messages` with `recipient: { comment_id }`, valid
for **7 days** from the comment.

Both clients no-op-and-log when credentials are missing (`canSend()` is false),
so the whole feature runs locally without live credentials. **The UI must
surface that state explicitly** — "Mode simulasi: balasan disimpan tapi tidak
dikirim" — never let it look like a message was sent.

Per [08 §5](08-data-integrity.md#5-crossing-the-boundary-outbox-not-fire-and-forget),
sends move to the **outbox** in this rebuild: the transaction writes the intent,
a worker performs the send. Today's inline send loses a reply if the process dies
between commit and HTTP call.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard: "The URL couldn't be validated" | Server not running, ngrok down, or `VERIFY_TOKEN` mismatch | `curl` the handshake (§10.1) first |
| Handshake returns 503 | `VERIFY_TOKEN` unset in the server's env | Set it, restart — the config is read at import |
| Handshake 200 but no events arrive | Field not subscribed | *Webhook fields → Manage* → tick `messages` / `comments` |
| Every POST returns 401 | Signature over parsed body, or a proxy rewrote the body | Verify over `rawBody`; check nothing between ngrok and Express re-serialises |
| POST 401 only in production | Different `APP_SECRET` per environment | Compare fingerprints, not values |
| Duplicate replies to one message | Handler slow → Meta retried | Ack before processing (§9.3); confirm the dedup unique index exists |
| Worked yesterday, dead today | Temporary 24 h token expired | Use a system-user token with no expiry (§4.3) |
| `#10 Application does not have permission` | Missing scope, or App Review not passed | Regenerate with the right scopes; check review status |
| `#131030 Recipient not in allowed list` | App in development mode | Add the number as a test recipient, or take the app live |
| Send returns 200, nothing delivered | Outside the 24 h window | Use an approved template |
| IG comment webhook silent | Personal IG account, or account not linked to the Page | Convert to Business/Creator and link |
| Events arrive, agent silent | `ANTHROPIC_API_KEY` unset | Check the startup log; the pipeline degrades to persist-only |

**First move, always:** `GET /health`, then the last 20 `WaRawEvent` rows. If raw
events are landing, the problem is downstream of Meta and you can stop reading
the dashboard.

---

## 13. Production checklist

- [ ] Stable HTTPS domain with a valid certificate (not a rotating free ngrok URL)
- [ ] `APP_SECRET`, `VERIFY_TOKEN`, tokens set from the deployment's secret store — never a file in the repo
- [ ] System-user tokens with **no expiry**; a calendar reminder anyway
- [ ] App Review passed for every Instagram permission in use
- [ ] App switched from Development to **Live**
- [ ] Real phone number verified and display name approved
- [ ] Signature rejection alert wired ([05 §9](05-logging.md#9-alerting))
- [ ] Outbox worker running and monitored for depth
- [ ] `WaRawEvent` / `IgRawEvent` retention job scheduled (30 days)
- [ ] Fail-closed tests passing in CI **without** a `.env` present
- [ ] Credentials recorded per [07-credentials.md](07-credentials.md), and one rotation rehearsed

---

## 14. Reference

- [WhatsApp Cloud API — Set up webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)
- [Graph API — Webhooks: getting started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- [Payload validation (`X-Hub-Signature-256`)](https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads)
- [Instagram Platform — Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)
- [WhatsApp — Conversation-based pricing & the 24-hour window](https://developers.facebook.com/docs/whatsapp/pricing)
- [Instagram — Private replies](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/private-replies)

**In this repo:** [`app.ts`](../../apps/whatsapp-webhook/src/app.ts) (routes and
the fail-closed contract) · [`signature.ts`](../../apps/whatsapp-webhook/src/signature.ts)
(HMAC) · [`persist.ts`](../../apps/whatsapp-webhook/src/persist.ts) (dedup) ·
[`instagram.ts`](../../apps/whatsapp-webhook/src/instagram.ts) (comment ingest +
auto-reply) · [`agent/pipeline.ts`](../../apps/whatsapp-webhook/src/agent/pipeline.ts)
(categorize → tool → handoff) · [`agent/debounce.ts`](../../apps/whatsapp-webhook/src/agent/debounce.ts)
(per-sender quiet window)

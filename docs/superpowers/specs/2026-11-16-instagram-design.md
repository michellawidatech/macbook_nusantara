# Instagram — DMs in /chat, a Comments tab, the bot on both — 2026-11-16

Owner-approved design (2026-11-16), including **new tables for Instagram**.
Built on `v2026.11.16.4`, branch `michellawidatech/instagram`. Not deployed.

## Intent

The shop sells from Instagram as much as from WhatsApp, and today an Instagram
DM or comment reaches nobody unless somebody opens the app on a phone. The
POS already has a complete chat desk for WhatsApp — the bot, hand-overs,
categories, tasks, staff alerts. Instagram should arrive in the same desk and
be answered by the same bot, with the same rules, without WhatsApp changing at
all.

## Goals

1. Connect straight to Meta with the **Instagram API with Instagram Login**
   (`graph.instagram.com`, scopes `instagram_business_basic`,
   `instagram_business_manage_messages`, `instagram_business_manage_comments`),
   on the same Meta app (2157052578394015) and the same public `/webhook`.
2. **DMs** in Chatbot → Chat under an **Instagram** switch beside WhatsApp, with
   every feature the WhatsApp side has: thread list, conversation, reply box,
   hand-over outline, categories and chips, Mark handled, the per-thread bot
   switch, the waiting count.
3. **The bot answers Instagram DMs** with the same rules, tools, hand-overs and
   categories — inside Instagram's 24-hour window and never outside it.
4. A **Comments** tab: every comment with its post, newest first, status
   NEW/REPLIED/DMED/DONE/HIDDEN, filters and search; reply publicly, send the
   one private DM a comment allows, hide/unhide, mark done. No public bot reply
   unless the owner switches `IgSettings.autoReply` on.
5. **Notifications**: Instagram DMs needing a person and NEW comments count in
   the sidebar notice and on the Chatbot badge, and raise the existing WhatsApp
   staff alerts with the `@username` and a link.
6. Every send through the **Outbox**, retried like WhatsApp's.
7. An owner-only **Instagram** card in Chatbot → Settings: connection, token
   expiry, last webhook event, the auto-reply switch and its two templates.

## Non-goals

- Instagram Stories replies/mentions as their own feature (a story reply is a
  DM and is read as one; a mention arrives as a comment and is listed).
- Edit / unsend of a sent Instagram message (the API has no such call).
- Reactions, read receipts, ice-breakers, persistent menu, Click-to-Direct ads.
- Publishing posts, insights.
- `/new` for Instagram testers (testers are phone numbers).
- A Customer row created by the bot for an Instagram sender (see Data model).

## Facts from Meta's documentation (checked 2026-11-16)

Cited in `docs/instagram-connect.md`. The ones that shaped the design:

- Send: `POST graph.instagram.com/<ver>/<IG_ID>/messages`, Bearer token;
  text is **≤ 1000 bytes UTF-8**; an image is `attachment.payload.url` — a
  **public URL**, PNG/JPEG ≤ 8 MB (the `attachment_id` upload is Page-based and
  not available without a linked Page: treat URL as the only way).
- Window: 24 h from the customer's last message. A person may reply up to
  **7 days** with the `HUMAN_AGENT` tag — a *feature* that needs App Review.
- Private reply: `recipient: {comment_id}`, **one** per comment, within
  **7 days**; the window opens only when they answer.
- Comments: `POST /<comment_id>/replies {message}`, `POST /<comment_id>?hide=`.
- Webhook: `object: "instagram"`, `entry[].id` = our account id; DMs in
  `entry[].messaging[]` (echoes carry `is_echo`), comments under `field:
  "comments"` — documented in **two shapes** (inside `changes[]` with
  `comment_id`, or directly under the entry with `id`). Signed
  `X-Hub-Signature-256` with "the app secret" — the docs do not say whether that
  is the Meta app's or the separate *Instagram app secret*.
- Long-lived token: 60 days; refresh with `ig_refresh_token` once ≥ 24 h old.
- Graph v27.0 is current; **v25.0 stays** (CLAUDE.md: one constant for both
  channels; valid to 2028-07-29).

## Approaches considered

**(a) Extend the existing chat tables, channel in the thread key — CHOSEN.**
Every chat table keys a conversation by one string, `from`, with no thread
table and no foreign key on it (`WaMessage`, `WaThreadMemory`, `ChatAction`,
`CustomerProfile`, `AgentRun`, `ChatMemoryChunk`, `StockWatch`,
`ReservationProposal`, `ChatMedia`), and the outbox addresses a send by
`payload.to`. An Instagram thread becomes `from = "ig:<IGSID>"`. The prefix is
the channel discriminator: a wa_id is digits, so no query keyed by one can
match an Instagram thread, and the whole bot pipeline — draft pass, leases,
debounce, hand-overs, tasks, categories, summaries, recall, profile, follow-ups,
the watchdog — runs on Instagram with no fork. `packages/domain/chatChannel.ts`
holds the rule (`igThreadKey`, `channelOf`, `isThreadKey`).

**(b) Parallel `Ig*` tables plus a channel-aware layer — rejected.** Every pass
in `apps/worker` and every route in `/api/inbox` reads `WaMessage` /
`WaThreadMemory` / `ChatAction` directly (≈ 40 queries, raw SQL among them).
Either each grows a second copy, or a repository layer is introduced under all
of them first. Both rewrite WhatsApp's hot path to add Instagram — the exact
risk the owner asked to avoid — and two copies of the bot's rules would drift.

**Why not a `channel` column on `WaMessage` too?** It would be a second source
of truth for what the key already says, every WhatsApp INSERT would have to
send it (the agent role's column grants make a new defaulted column a hazard —
see `WaThreadMemory.autoReply`'s `dbgenerated`), and nothing needs it: the
inbox filters on the prefix, and the volumes (≈ 50 customers a day) make a
`LIKE 'ig:%'` scan free.

### The outbox kind follows the recipient

Fifteen call sites queue `WA_REPLY` / `WA_IMAGE` with `payload.to` = the thread
key. `enqueueOutbox` stores a row addressed to an `ig:` key as **`IG_DM`** /
**`IG_IMAGE`** (`outboxKindFor`), so no call site can forget, and readers of
"what was sent to X" filter on `REPLY_KINDS` / `IMAGE_KINDS`. The WhatsApp send
pass claims every kind **except** the Instagram ones (`claimOutbox(…, {kinds})`);
the new Instagram send pass claims only those. A WhatsApp-only shop sees no
difference: no row it writes is addressed to an `ig:` key.

### What an Instagram key is NOT

- **Not a phone.** `phoneForms("ig:…")` returns `[]` — "we do not know who
  this is" — so every customer-by-phone read (orders, bookings, a reservation's
  phone, `upsertChatAction`'s customer) finds nobody. `toE164` throws for one.
- **No Customer row from the bot.** `remember_customer` writes the
  `CustomerProfile` (keyed by thread) and, for an Instagram sender, stops
  there: a `Customer` keyed by nothing could never be found again and would be
  a duplicate the first time the person buys over the counter. Staff link one
  from the profile panel as today.
- **A request the bot files** (`ReservationProposal`) approves into a
  reservation with **no phone** and the `@username` as the name; its approval
  message goes back to the Instagram thread through the same `enqueueOutbox`.
- **The agent API token** still carries `waId`, which is now "the thread key";
  for an Instagram turn it is `ig:<IGSID>`. No route takes a phone or a key
  from the request, so an Instagram customer reaches only their own profile,
  proposals and watches. Phone-scoped reads answer nothing for them.

## Data model (migration `20261116120000_instagram_dms_and_comments`, additive)

New tables (owner-approved):

- **`IgContact`** — one per Instagram sender: `igsid` (unique), `username`,
  `name`, `fetchedAt`, `lastError`, `createdAt`, `updatedAt`. Written by the
  worker's sync pass from the User Profile API (it needs the sender to have
  messaged us, which a DM thread always has). The inbox and the staff alert
  read the `@username` from it.
- **`IgConnection`** — singleton (`id = 'singleton'`): `igUserId`, `username`,
  `name`, `accountType`, `tokenRefreshedAt`, `tokenExpiresAt`, `checkedAt`,
  `lastError`. Written by the worker (which holds the token); the API reads it
  for the Settings card, so **the token lives in worker.env only**.

Enum `OutboxKind` gains `IG_IMAGE`, `IG_PRIVATE_REPLY`, `IG_HIDE` (`IG_DM` and
`IG_REPLY` exist, unused until now).

Existing tables, unchanged in shape: `IgRawEvent`, `IgMedia`, `IgComment`,
`IgSettings`. A comment's hide/unhide and done are its `status`; who did it is
the `AuditLog`. An `IgMedia` the webhook has not yet fetched is a stub with
`permalink` null and `fetchedAt` = the epoch.

Relaxed rather than added:

- `ChatMedia_shape` accepts `ig:<IGSID>` as well as a wa_id (a picture staff
  send to an Instagram thread), and Instagram takes JPEG/PNG only — the route
  refuses WebP for an Instagram thread.
- `wa_thread_delete` accepts an `ig:` key and also removes that sender's
  `IgRawEvent` DM envelopes; everything else it did is unchanged. It keeps the
  `IgContact` as it keeps the profile.

Grants (neither writer role gets default privileges):

| table | nusantara_app | nusantara_agent |
|---|---|---|
| IgContact | SELECT | SELECT, INSERT, UPDATE |
| IgConnection | SELECT | SELECT, INSERT, UPDATE |
| IgMedia | SELECT, INSERT, UPDATE | SELECT, UPDATE (caption, mediaType, permalink, thumbnailUrl, timestamp, fetchedAt) |
| IgComment | SELECT, INSERT, UPDATE | SELECT, UPDATE (replyCommentId) |
| IgSettings | SELECT, INSERT, UPDATE | SELECT |
| IgRawEvent | SELECT, INSERT, UPDATE | (unchanged: INSERT, UPDATE) |

No DELETE for either. The deploy's `t|f|t|f|t` reads `Unit`, `UnitEvent`,
`UnitNotePhoto` only and is untouched; `invariants.test.ts` checks the rest.

## Flows

### Inbound (apps/whatsapp-webhook)

1. Signature: verified with `APP_SECRET`; when it fails and `IG_APP_SECRET` is
   set, verified with that — **and then only an `object: "instagram"` body is
   accepted**, so the second secret can never inject a WhatsApp event. Which one
   matched is logged (`webhook.ig.signed_with`) so the open question above
   answers itself on the first real delivery.
2. `IgRawEvent` first, as now. Then `extractIgMessages`: each
   `entry.messaging[]` with a `message` that is not an echo, not deleted, not
   from `entry.id`, becomes a `WaMessage` (`waMessageId = "ig:" + mid`,
   `from = ig:<sender>`, `msgType` = text / image / story_mention / share…,
   status BARU). Unique on the id — Meta's 36 h of retries dedupe on it.
3. `extractIgComments` (both documented shapes): skip our own; upsert the
   `IgMedia` stub; insert the `IgComment` (NEW). When `IgSettings.autoReply` is
   on and the comment is top-level and the first from that person on that
   post, queue the public reply (`IG_REPLY`, the template) and — if the DM
   template is not blank — the private reply (`IG_PRIVATE_REPLY`), in the same
   transaction, marking the comment REPLIED/DMED with `repliedByAgent`.
4. Postbacks become text messages (their title); reads and reactions are
   stored raw and ignored.

### The bot (apps/worker draft pass — unchanged code path)

An Instagram thread is a candidate exactly like a WhatsApp one (BARU rows, the
per-thread switch, leases, debounce). The existing `isWithinWindow(anchor.ts)`
check is Instagram's 24-hour rule too: outside it the bot hands over
(`window_closed`), never sends. Follow-ups already refuse outside 24 h on the
Cloud API; an Instagram thread is treated as Cloud-API (never Baileys) there.
Photos queue as `IG_IMAGE` through the same lines.

### Outbound (apps/worker `igSendPass`)

Claims only `IG_*` rows; dormant without `IG_ACCESS_TOKEN` + `IG_USER_ID`.

- `IG_DM` — `splitForInstagram` (≤ 1000 bytes at a paragraph/line/sentence/word
  break); one Graph call per part; the first message id is kept. A row older
  than 24 h fails (exhausted at once), unless its payload carries `tag:
  "HUMAN_AGENT"`, which may go for 7 days.
- `IG_IMAGE` — the photo is served at a short-lived public URL through the
  webhook (below); without `IG_MEDIA_PUBLIC_URL` it fails at once with that
  reason, visible in /chat.
- `IG_REPLY` — `POST /<comment_id>/replies`; on success writes
  `IgComment.replyCommentId`.
- `IG_PRIVATE_REPLY` — `recipient.comment_id`.
- `IG_HIDE` — `POST /<comment_id>?hide=true|false`.

Failures go through `markOutboxFailed` (the same capped backoff).

### Pictures by URL

Instagram fetches an image from a URL; this deployment has no public origin
except the funnel, which publishes `/webhook` and everything under it. The
webhook gains `GET /webhook/media/:outboxId/:token`: it serves the bytes of the
photo an `IG_IMAGE` row names, only when the token matches the one the worker
wrote onto that row just before sending (`payload.mediaToken`, 32 random
bytes), the row is PENDING/SENDING/SENT, not unsent, and under 24 h old. One
picture, to whoever is holding a link that is being sent to that customer.

### Sync (apps/worker `igSyncPass`)

- New Instagram senders without an `IgContact` → User Profile API (`name`,
  `username`); a failure is kept in `lastError` and retried after an hour.
- `IgMedia` stubs and media older than a day with a comment in the last 30 days
  → `GET /<media_id>?fields=caption,media_type,media_url,permalink,thumbnail_url,timestamp`.
- Once an hour, `GET /me` → `IgConnection`.
- **Token refresh**: when the token was last refreshed ≥ 7 days ago (or never,
  once it is a day old), `refresh_access_token`; the new token is used at once
  and, with `IG_TOKEN_FILE` set, written back into that env file (temp file +
  rename, mode 600) beside `IG_TOKEN_REFRESHED_AT`. The token is never logged
  or stored in the database; `IgConnection.tokenExpiresAt` is.

### Staff (apps/api)

- `/api/inbox?channel=whatsapp|instagram` — default WhatsApp, so the list a
  WhatsApp shop sees is the list it saw. Every `/api/inbox/:phone` route takes
  either key (`isThreadKey`). For an Instagram thread the reply route enforces
  `igReplyMode`: RESPONSE sends, HUMAN_AGENT sends tagged only when
  `IG_HUMAN_AGENT=1` (the feature is approved), CLOSED refuses; the list's
  `windowClosesAt` follows the same rule. Edit/unsend answer "not possible"
  for an Instagram item. The thread carries `channel: "INSTAGRAM"` and
  `username`.
- `/api/inbox/waiting` adds `comments` (NEW comments) and counts Instagram DM
  threads as it counts WhatsApp ones.
- `/api/instagram/comments` (list, filter by status / post, search),
  `POST …/:id/reply`, `…/:id/private-reply`, `…/:id/hide` `{hidden}`,
  `…/:id/done`; each writes the comment, its outbox row and an `AuditLog` line
  in one transaction. `/api/instagram/settings` GET (all) / PUT (owner),
  `/api/instagram/connection` GET (owner).

### Notifications

The staff alert (`staffAlertText`) names the channel and the `@username` for
an Instagram thread, and its link is `/chat?phone=ig%3A…`. A NEW comment
raises an alert too (once per comment author per 15 minutes), queued by the
worker's sync pass — it already reads the alert numbers, and the webhook
should stay free of the agent package.

### Web

- Chatbot → Chat gets a WhatsApp | Instagram switch above the thread list; the
  same three columns; the reply box says when only a person may reply (7-day
  tagged window) or nobody can.
- Chatbot gains a **Comments** tab (between Chat and Knowledge Base) — a tab,
  not a nav leaf, because the Chatbot leaf is where staff already go when the
  badge lights up, and the badge counts comments.
- Settings tab: the owner-only **Instagram** card.
- Every string bilingual.

## Permissions

Instagram routes need a signed-in staff member; settings writes and the
connection card are owner-only, as the WhatsApp connection card is. The comment
actions are any staff, audited with who.

## Risks / open questions for the owner

1. Which secret signs Instagram webhooks — `IG_APP_SECRET` covers both.
2. `HUMAN_AGENT` needs App Review; until then replies stop at 24 h.
3. Meta says webhooks need the app **Live** and comments need Advanced Access;
   the guide says what to try in development mode first.
4. Pictures need the funnel URL in `IG_MEDIA_PUBLIC_URL`.
5. Comment auto-reply stays off until the owner switches it on.

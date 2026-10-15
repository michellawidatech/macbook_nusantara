# Chatbot v2 — design (owner-approved 2026-10-14)

> ⚠️ **Revised 2026-10-15 (later): rules first.** The owner chose to minimise
> AI — *"if the process can be rule based or automated, do not use AI"* — and
> to keep the interface. The default pipeline is now `rules` (§12); the three
> AI agents below remain built, tested and selectable in Settings.

Status: **approved 2026-10-14; step 1 built.** Answers given by the owner on
2026-10-14 are marked *(owner)*; my own choices are marked *(proposed)* and are
the things to correct first.

## 1. What changes and why

The shop handles about 50 customers a day, with 10–25 writing at the same time.
Today's bot is one agent on Haiku 4.5. The worker answers **one chat at a
time**, up to 5 per pass, and each reply can take up to 4 model calls. Context
does not leak between customers, because every query is filtered by the wa_id
and a reply only commits if its messages are still unanswered. The problem is
throughput: at 25 concurrent customers, the last one waits minutes.

v2 keeps the parts that already hold up:

- the webhook and its HMAC check;
- the outbox and photo upload by media id;
- the knowledge base and the reply fact-check;
- the four switches;
- the testers' `/new` reset.

Around those, v2:

- splits the single agent into three;
- runs chats in parallel, each under its own lease;
- puts the POS behind a REST boundary scoped to the sender;
- adds a lead tag, unread counts, a structured profile, per-agent personas,
  a simulator and an evaluation loop.

**n8n: not used** *(proposed)*. The hard parts are rules that must never break:

- per-customer isolation;
- a reservation written in the same transaction as its ledger event;
- a reply checked against facts before it is sent.

Those are already code with tests. n8n would be a second runtime on the Mac
mini that is edited in a browser, cannot run in the test suite, and would call
the same REST API anyway. The orchestration is plain TypeScript in
`packages/agent`, run by `apps/worker`.

## 2. Architecture

```
WhatsApp ──► apps/whatsapp-webhook ──► WaRawEvent / WaMessage (BARU)
              HMAC + wa_id check          │
                                          ▼
                      apps/worker  ── claims a THREAD LEASE (one per wa_id)
                      pool of N=8 chats in parallel
                                          │
                 ┌────────────────────────┼─────────────────────────┐
                 ▼                        ▼                         ▼
          1. Router / Guard        2. Operations              3. Sales Advisor
          Sonnet 5.5, low effort   Haiku 4.5, tools           Sonnet 5.5, low effort
          structured output only   POS REST, scoped token     writes the ONE reply
          language, tone, intent,  stock, price, photos,      + profile updates
          lead score, needs-ops?   reservations               + next question
                                          │
                                          ▼
                              apps/api  /api/agent/v1/*
                              (thread-scoped token: the wa_id
                               comes from the token, never the model)
                                          │
                                          ▼
                checkReply (facts) ──► Outbox (WA_TEXT, WA_IMAGE) ──► sendPass ──► Graph
```

### One turn

1. **Debounce.** The customer stops typing. The quiet window becomes 3–8 s
   (today 4–45 s), so the reply lands about 10 s after the last message
   *(owner: 10 s is fine)*.
2. **Router** (one call, structured JSON, no prose). It returns:
   - `language` (id/en), `tone` (casual/formal) and `intent` (greeting,
     browse, ask_stock, ask_price, ask_photo, reserve, confirm, negotiate,
     complaint, other);
   - `lead_score` 0–100 and `needs` (which Operations lookups to run);
   - `escalate` with a topic, for anything the policy sends to a person.

   The existing `routeMessage` code rules run first and still win:
   negotiation, payments, complaints and a photo the customer sent go to a
   person.
3. **Operations** runs only when the Router asks for it. It is a short tool
   loop (at most 3 calls) against the REST API and returns **structured facts**
   (units, prices, photo handles, reservation results), not prose.
4. **Sales Advisor** writes the reply in the Router's language and tone. It
   uses:
   - the customer profile, the thread summary and the last 8 turns;
   - Operations' facts and the knowledge base.

   It also proposes profile updates and the next question to ask
   *(owner: the advisor writes the reply)*.
5. **checkReply** verifies every price and availability claim against
   Operations' facts. A failed check becomes a hand-over (existing rule).
6. **One transaction** writes:
   - the reply to the outbox, plus image rows;
   - the profile updates and the lead tag;
   - an `AgentRun` trace row;
   - the compare-and-swap on the batch.

   No network I/O happens inside it.

**Expected latency** after the debounce:

| Step | Time |
|---|---|
| Router | ~1–2 s |
| Operations | ~2–3 s, only when needed |
| Advisor | ~2–3 s |
| **Total** | **≈ 4–8 s** |

### Models *(owner: cheap for writing to the POS, medium for intent and phrasing)*

| Agent | Model | Why |
|---|---|---|
| Router | `claude-sonnet-5-5`, effort `low`, structured output | Reading intent and tone is where judgement matters. |
| Sales Advisor | `claude-sonnet-5-5`, effort `low` | It writes what the customer reads. The persona and knowledge base sit in the cached prefix. |
| Operations | `claude-haiku-4-5` | Mechanical tool calls. Strict schemas do the work. |

Sonnet 5.5 rejects a forced `tool_choice` (`any`), so the Advisor returns
structured output instead of a forced `reply` tool. Operations stays on Haiku,
where the current `tool_choice: any` loop works unchanged.

**Cost estimate** *(proposed, to be measured on the sandbox)*:

- 50 customers × ~8 turns ≈ 400 turns a day.
- At about $0.005–0.012 per turn with caching, that is **≈ $2–5 a day, about
  $60–150 a month**.
- An all-Haiku pipeline would be about a third of that.

### Credential ⚠️

A Claude Pro/Max subscription (a Claude Code login) **cannot** power this bot.
Since early 2026, Anthropic's terms limit those OAuth tokens to Claude Code and
claude.ai. Its servers refuse them elsewhere ("This credential is only
authorized for use with Claude Code"). The worker needs either:

- an **API key from the Claude Console** (pay as you go), or
- **Console OAuth** (`ant auth login`), which is billed to the same API
  account.

The worker already reads `ANTHROPIC_API_KEY`.

## 3. Isolation: "a customer can only touch their own data" *(owner)*

- **At the webhook: nothing is refused** *(revised in step 2)*. The first
  draft said a `from` that is not 8–15 digits would never be queued. It is
  dropped from the plan: WhatsApp's usernames may deliver a sender id that is
  not a phone number, and refusing one would lose a real customer without a
  trace. The rule is enforced where it matters instead — every read is by
  `from`, the lease is per `from`, and the REST token carries it. Only the
  booking insists on digits (the `ReservationProposal_from_waid` CHECK),
  because a hold needs a number the shop can ring.
- **Thread lease** ✅ *(step 2, `apps/worker/src/lease.ts`)*. One statement
  inserts the thread's memory row holding the lease, or takes the lease on the
  existing row only when nobody holds an unexpired one (120 s). Released when
  the turn ends; a crashed worker's threads free themselves by the clock. The
  draft pass runs up to `WORKER_DRAFT_CONCURRENCY` (8) threads at once, 16 a
  tick, and the compare-and-swap at commit stays as a second guard.
- **Scoped REST token.** For each turn the worker mints a short-lived token,
  signed with a secret shared only between the worker and the API. The token
  carries `{ waId, turnId, capabilities, exp }`. Every `/api/agent/v1/*` route
  reads the phone **from the token**: no route takes a phone parameter, so the
  model cannot name another customer.
  - A reservation lookup, change or cancel touches only rows where
    `phone = token.waId`.
  - Stock, price and photos are shop data and are not phone-scoped.
  - A route whose switch is off returns 403.
- **Context per turn** is built from rows filtered by that wa_id only: the
  profile, summary, last 8 turns and open reservations.

## 4. Operations: the REST surface *(owner: use the POS REST API)*

✅ Built in step 3 (2026-10-15): `apps/api/src/routes/agent.ts`, with the
contract — route table, token, client — in `packages/agent/src/agentApi.ts`.
Mounted before the staff-session middleware: its caller is the worker, which
signs a token per turn (`AGENT_API_SECRET`, in api.env and worker.env and
nowhere else). Unset, the route answers 503 and the worker runs the tools
itself, so either half can be deployed first.

| Method | Path | Tool | Answer |
|---|---|---|---|
| GET | `/stock?query=&minPrice=&maxPrice=&sort=` | `search_stock` | 200 matching units |
| GET | `/units/:serial` | `check_serial` | 200, or **404** with the tool's own words |
| GET | `/units/:serial/photos` | `unit_photos` | 200 photo handles (ids, never bytes) |
| GET | `/photos?query=` | `find_unit_photos` | 200 |
| GET | `/catalog` | `browse_catalog` | 200 |
| GET | `/me` | `lookup_customer` | 200 the token's customer |
| PATCH | `/me/profile` | `remember_customer` | 200 |
| GET | `/me/orders/:code` | `check_order` | 200 |
| GET | `/me/reservations` | `check_reservation` | 200 this customer's holds |
| POST | `/me/reservations` | `create_reservation` | 200 |
| PATCH | `/me/reservations` | `reschedule_reservation` | 200 |
| DELETE | `/me/reservations?code=` | `cancel_reservation` | 200 |

- **Behind each route is the tool that ran in the worker** (`dispatchTool`), so
  nothing about what the bot can say changed — only where it runs. A tool the
  switches forbid is **403** (`toolsFor`, the same gate the model's tool list
  is built from); a token with `writes: false` cannot book.
- **No route reads a phone.** `/me` is the token's `waId`. A body carrying
  `phone`, `from` or `waId` is ignored (`apps/api/test/agentApi.test.ts`
  books as Alice with Bob's number in the body, and Bob cannot see or cancel
  Alice's hold by its code).
- **Stays in the worker:** `search_knowledge` (its `K` handles must match the
  prompt the worker built), `store_info`, `lookup_catalog` and the hand-over —
  none of them POS data about a unit or a customer.
- The Operations agent of step 4 calls the same routes.

**Photos** *(owner: WhatsApp uploads, not public links)*. A unit's
`photos` array carries handles. The Advisor picks up to 3 and the worker writes
one `WA_IMAGE` outbox row per handle. `sendPass` uploads the bytes to Graph and
sends the media id, as it does today. The "is it publicly reachable" check
becomes "does the photo have bytes"; a link-only photo is skipped and listed on
the trace.

## 5. The appointment *(owner)*

An appointment is a reservation to view units at the store: product(s) plus a
visit time. `Reservation.scheduledFor` already exists.

1. The Router's `lead_score` crosses 60 (or the intent is `reserve`). The
   Advisor offers a visit.
2. The Advisor collects the **name** (the phone is automatic), the **units**
   and the **time**, inside opening hours from `systemFacts`.
3. Operations creates a **proposal**. The Advisor restates every unit (name,
   grade, serial tail, price) and the time, and asks "betul ya kak?"
4. Only a Router `intent=confirm` on the customer's **next** message lets
   Operations call `confirm`. Any change creates a new proposal.

   **Confirmation is code-enforced**: the confirm route refuses a proposal
   older than 30 min or one already confirmed.
5. A name given here also fills the `Customer` row (existing behaviour of
   `remember_customer`).

## 6. Storing context efficiently

Each turn reads at most:

| Source | Size | Prompt caching |
|---|---|---|
| Profile | 1 row + child rows | uncached |
| Summary | ≤700 chars | uncached |
| Last 8 turns | — | uncached |
| Open holds | — | uncached |
| Persona, rules, knowledge base, shop facts | — | one cached prefix per agent |

Nothing grows with the length of a chat:

- The summary pass (every 3 turns, Haiku) is what lets a 200-message chat cost
  the same as a 10-message one.
- The profile is the long-term memory.
- Index use stays on `(from, ts)`.

## 7. Schema changes *(owner: OK, must be deploy-safe)*

All additive, in one migration with defaults and backfills. The release before
it never selects these columns, so it keeps running during a deploy.

- **`WaThreadMemory`** gains:
  - `leaseUntil`, `leasedBy` (the thread lease);
  - `readAt` (unread count = inbound messages after it);
  - `leadAt`, `leadBy` (enum `BOT|STAFF`), `leadScore` (Int?);
  - `leadClearedAt`, set when an `Order` names this customer *(owner: clears at
    sale)*.
- **`CustomerProfile`** gains:
  - `budgetMin` and `budgetMax`, replacing `budget` (backfilled to both);
  - `ageEstimate` (text such as "20–25", always shown as an estimate);
  - `occupation` (job or school, estimated).
- **New table `CustomerProfileFact`**: `(profileId, kind, value, source
  BOT|STAFF, createdAt, removedAt)`.
  - `kind` is an enum: `USAGE` (programming, design, office), `APP` (VS Code,
    Photoshop), `PREFERENCE` (new, 14", light), `ABOUT` (other bullet points).
  - It is a table rather than JSON or comma lists, so "who uses Photoshop" is a
    query.
- **New table `ReservationProposal`** plus child **`ReservationProposalItem`**
  (unitId): `from`, `custName`, `scheduledFor`, `createdAt`, `expiresAt`,
  `confirmedAt`, and `reservationId` (FK, set on confirm).
- **New table `AgentRun`**, one row per turn:
  - `from`, `messageId`;
  - the Router output as columns (`language`, `tone`, `intent`, `leadScore`,
    `escalateTopic`);
  - `agentsRun`, `inputTokens`, `cachedTokens`, `outputTokens`, `costMicros`,
    `latencyMs`.
- **New table `AgentRunStep`**: `(runId, agent, tool, status, ms)`, one row per
  tool call. This is what Evaluation and the simulator's "credits used" read.
- **`Persona`** gains `agent` (enum `ROUTER|ADVISOR|OPERATIONS`), nullable
  and unique: **one persona per agent** *(owner)*. The active persona today
  becomes the `ADVISOR` one; the other two are seeded from code defaults.
  Inactive personas are kept with `agent` null and are not shown.
- **New table `AgentEvaluation`**:
  - `messageId`, `runId?`, `rating` (`GOOD|BAD`), `reason` (enum: wrong_fact,
    wrong_tone, too_long, missed_question, should_escalate,
    should_not_escalate, other), `note?`, `corrected?`;
  - `status` (`OPEN|APPLIED|DISMISSED`), `createdById`, `createdAt`,
    `reviewedById?`, `reviewedAt?`.
  - `AgentCorrection` stays; an evaluation with a correction writes one when it
    is applied.

Grants: `nusantara_agent` gets SELECT/INSERT/UPDATE on the new agent tables and
no DELETE, matching the 2026-09-29 pattern.

## 8. The screen (`/chat`)

Full width for **the whole app** *(owner)*: `LAYOUT.contentMaxWidth` goes.
Top tabs: **Chat · Knowledge Base · Evaluation · Settings** *(owner)*.

- **Chat** has three columns:
  - **Recent chats**: name (ellipsis), phone, tags (🔥 lead red, 📅
    reservation blue, 🧑 escalation orange) and the unread count on the right.
  - **Conversation**: bubbles only; reply box with attach media; the AI on/off
    switch in the header; 👍/👎 on every bot bubble, opening the evaluation
    form.
  - **Customer profile**: the summary first, then estimated age and occupation
    (labelled *estimate*), budget range, usage, apps, preferences, open
    reservations and open tasks. Staff can edit every field and toggle 🔥.
  - The banners, the stacked task cards and the "Context" prose are gone. An
    open task is the orange tag plus one line at the top of the conversation.
- **Knowledge Base**: unchanged *(owner)*.
- **Settings** *(owner: this is the agents' persona tab)*: the four switches
  and Testers on top; below, the three agents as a list (name, main task).
  Clicking one opens its persona prompt in a dialog to edit — one persona per
  agent. On the right is the simulator: the real pipeline in dry-run mode,
  which reads the POS, books nothing, sends nothing, and shows the credits and
  steps of each turn. The lead threshold (default 60) lives here too.
- **Evaluation**: a list of ratings with filters (rating, reason, agent,
  status), opening the conversation at that bubble. A 👎 reaches the bot only
  when somebody presses *Apply*, which turns its correction into an
  `AgentCorrection` *(owner)*; *Dismiss* closes it.

## 9. Build order

Each step ships on its own and leaves the bot working.

1. **Migration + layout.** ✅ 2026-10-14
   (`20261014120000_chatbot_v2_threads_profiles_and_evaluation`); the app is
   full width.
2. **Throughput.** ✅ 2026-10-15. Thread lease, 8 lanes, 16 a tick; waits 3 s
   (question) / 6 s / ~11 s (filler) / 20 s ("nanti"). The worker runs as
   `nusantara_agent` and refuses any other role in production —
   `docs/worker-agent-role.md` is the Mac mini step.
3. **REST boundary.** ✅ 2026-10-15 — see §4. On with `AGENT_API_URL` +
   `AGENT_API_SECRET` (worker.env) and the same secret in api.env.
4. **Three agents.** ✅ 2026-10-15. `packages/agent/src/pipeline.ts`
   (`agents.ts` holds names, tasks, models, default prompts and the price
   table). Behind `AppSetting chatbot.pipeline` — **v1 until the owner
   switches it in Settings**, and switching back is the same switch. Every
   turn (v1 too) writes an `AgentRun` with its steps, tokens, cost and latency.
5. **Appointment flow.** ✅ 2026-10-15. `propose_reservation` (Operations,
   holds nothing, 30-minute life, same schedule rules as a hold) →
   `confirm_reservation` (code only, on the router's `confirm` with a proposal
   open). The lead: the router's score sets the bot's half at the threshold
   (Settings, default 60); staff set or clear it on the profile; a sale clears
   it (`documents.ts` adapter).
6. **UI.** ✅ 2026-10-15. Chat (list with tags and unread · bubbles with
   👍/👎 · profile), Knowledge Base (unchanged), Evaluation, Settings (switches,
   Testers, pipeline, lead threshold, the three agents' personas, simulator).
   The API side is `apps/api/src/routes/inboxV2.ts` and `chatV2.ts`.
7. **Measure.** ⏳ Needs a Console API key — see below. Then go live.

## 10. Measuring before go-live (step 7)

Nothing here can be measured with a Claude Code / Pro / Max login: Anthropic
refuses those tokens outside Claude Code. With a Console key:

1. Put `ANTHROPIC_API_KEY` in the environment `tools/wa-local/up` reads (or the
   sandbox's api.env/worker.env) and start it on `nusantara_pos_chatbot`.
2. In /chat → Settings switch **Pipeline** to *Three agents (v2)*.
3. Use the **simulator** for the scripted cases (a greeting; "ada macbook pro
   16 m3?"; "minta fotonya"; "besok jam 2 saya ke toko, nama Budi" then "iya";
   "kalau 30jt boleh?"; a question only the knowledge base answers). Each bot
   bubble shows its cost, latency and steps.
4. Then real chats from the tester numbers through the WhatsApp link. Every
   turn is an `AgentRun`:

   ```sql
   SELECT pipeline, count(*) AS turns,
          round(avg("latencyMs")) AS avg_ms,
          percentile_disc(0.9) WITHIN GROUP (ORDER BY "latencyMs") AS p90_ms,
          round(avg("costMicros") / 1e6, 4) AS avg_usd,
          round(sum("costMicros") / 1e6, 2) AS total_usd,
          round(100.0 * sum("cachedTokens") / nullif(sum("inputTokens"), 0)) AS cached_pct
     FROM "AgentRun"
    WHERE NOT "dryRun" AND "createdAt" > now() - interval '1 day'
    GROUP BY pipeline;
   ```

   The design's targets: a reply within ~10 s of the customer's last message
   (the wait plus `avg_ms`), and about $0.005–0.012 a turn.
5. Rate the replies (👍/👎) and work through Evaluation → Needs review before
   switching production to v2.

## 12. Rules first (2026-10-15, later) — the default

| Step | How |
|---|---|
| 1. Receive (webhook) | no AI — unchanged |
| 2. Read & classify | **rules** (`rules/understand.ts`): intent, product, budget, serial, which unit, name, visit time, usage/apps/preferences; hand-overs by `routeMessage` as before |
| 3. Hit the POS | no AI — the same `/api/agent/v1` tools, called by code |
| 4. Respond | **templates** (`rules/replies.ts`) for greeting, thanks, stock list, price, photos, visit read-back and booking; an owner's answer sent verbatim on a strong match; **AI only** for what is left, and only with a Console key — otherwise a person |

What still needs AI: an open question no rule or approved answer covers
("which is better for deep learning, the M3 or the M2 Pro?"). With no key
those go to staff, with an action item, exactly as a v1 hand-over does.
`test/rulesRun.test.ts` (no model at all) and
`apps/worker/test/rulesWorker.test.ts` (a full conversation — greeting, stock,
price of "yang pertama", visit proposal, booking on "iya" — as
`nusantara_agent` with no credential) are the review.

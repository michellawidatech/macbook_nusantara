# Chatbot audit — design

2026-11-18. Asked by Widatech (the developer), for Widatech only. Agreed in
chat, question by question, on 2026-11-12 → 2026-11-17.

## What it is for

A nightly, fully automated read of every chatbot conversation by an AI
reviewer that flags anything wrong or worth improving, shown on a dashboard
only the `widatech` login can open. It answers one question: **how good is
the bot?** Nobody marks replies by hand; the reviewer's flags are the output.

Out of scope (asked and dropped): an activity trail of who changed what
around the bot, a health screen, a manual review queue, a "review this chat
now" button, Instagram conversations (WhatsApp only in this version).

## Decisions taken

| Question | Answer |
|---|---|
| Who sees it | Widatech only — a per-account switch, `Staff.canViewAudit` (B) |
| Where | Inside the POS, its own full-screen page `/audit` |
| How replies are judged | Fully by AI, no human marking |
| Credential | The shop's existing Anthropic token (the worker's) |
| Model | Claude Sonnet 5.5 (`claude-sonnet-5-5`) |
| When | Nightly only, in a quiet window |
| What it looks for | The seven categories below, all of them |
| Where it runs | A new pass in the worker (approach A) |

## The seven categories

Each flag carries one category, a severity (`BAD` / `IMPROVE`), the exact
line(s) it is about, and a one-line suggestion.

1. `WRONG_FACT` — a price, stock, battery or condition that disagrees with
   the unit's record, or a claim with no source at all.
2. `UNANSWERED` — a question in the burst left unanswered, the wrong question
   answered, the bot repeating itself.
3. `HANDOVER` — handed to staff when it could have answered, or answered what
   belongs to a person (negotiation, payment proof, complaint).
4. `RULE_BROKEN` — the shop's rulebook (`packages/agent/src/conduct.ts`):
   emoji after the first reply, "saya" for "aku", grade letters, pushiness,
   photos offered unasked, and the rest.
5. `TONE` — robotic, too long, too formal or too casual, odd Indonesian a
   person at the shop would not write.
6. `MISSED_SALE` — interest shown (a budget, a use, a model) and no
   recommendation, follow-up or visit offered; a chat that went quiet after
   a weak reply.
7. `OTHER` — anything else odd the list did not foresee.

## 1. Data

Migration `20261118120000_chatbot_audit` (additive; owner approval needed per
CLAUDE.md "never invent schema").

- **`Staff.canViewAudit`** `Boolean @default(false)`. The migration sets it
  true for the login `widatech` (an existing OWNER) and nobody else.
- **`ChatReviewRun`** — one per night.
  `id`, `startedAt`, `finishedAt?`, `model`, `status` (enum
  `ReviewRunStatus`: `RUNNING`, `DONE`, `STOPPED`, `FAILED`), `reason?`
  (why it stopped or failed, in words), `chats` Int, `flags` Int,
  `inputTokens`, `outputTokens`, `costMicros` BigInt (US dollars × 10⁶, as
  `AgentRun.costMicros`).
- **`ChatReviewThread`** — one per chat the run read; also the cursor.
  `id`, `runId` → `ChatReviewRun` (RESTRICT), `from` (the thread key, as
  `ChatMemoryChunk.from`), `reviewedFrom`, `reviewedTo` (the answered window
  it read), `flagCount`. Index `(from, reviewedTo)`. "What is left to review"
  is every answered line after the thread's newest `reviewedTo`.
- **`ChatReviewFlag`** — `id`, `threadId` → `ChatReviewThread` (RESTRICT),
  `messageId?` → `WaMessage` (RESTRICT), `category` (enum
  `ReviewCategory`, the seven), `severity` (enum `ReviewSeverity`),
  `quote` (the flagged words, ≤ 500), `suggestion` (≤ 300), `createdAt`,
  `dismissedAt?`, `dismissedById?` → `Staff`.
- **Grants.** `nusantara_agent`: SELECT, INSERT, UPDATE on the three tables
  (the worker writes them). `nusantara_app`: SELECT on the three, UPDATE on
  `ChatReviewFlag("dismissedAt","dismissedById")` only. DELETE for neither.
- **`wa_thread_delete`** (the conversation delete) must remove a thread's
  flags and review rows before its messages — `ChatReviewFlag.messageId` is
  RESTRICT. The function is redefined in the same migration; its test gains
  a reviewed thread.
- No JSON columns. Money-like cost stays BigInt.

## 2. The review

`apps/worker/src/reviewPass.ts`, called from `loop.ts` like the summary and
memory passes, failing alone.

- **Window.** It works only between 01:00 and 05:00 WIB. Outside it the pass
  returns at once. One run row per night; a run interrupted (stopped, worker
  restarted) carries on the next night from the cursors.
- **What it picks.** WhatsApp threads with a line answered by the bot
  (`answeredByAgent`) after their last `reviewedTo`, oldest first, at most
  300 a night. The very first run reads back 30 days. Tester numbers are
  included — they are most of the traffic today — and the dashboard marks
  them.
- **What it sends, per chat.** The answered window, in order: customer
  lines, bot replies (and hand-over lines), staff replies, each labelled and
  timed; for every unit a bot reply named (`entities.units`), its record as
  it is now (model, variant, grade, price, battery, status) with a note that
  it may have changed since; the rulebook text (`CONDUCT`) and the shop's
  facts (hours, address); the seven categories with their definitions.
  Older context from before the window goes in as the thread's summary only.
- **What comes back.** Structured output (`output_config.format`, a JSON
  schema): a list of flags `{category, severity, messageId, quote,
  suggestion}`, possibly empty. A flag naming a message outside the window is
  dropped. Adaptive thinking, effort `medium`, the server-side `fallbacks:
  "default"` on a refusal; a refusal that survives it skips that chat.
- **The live bot comes first.** Before each chat the pass checks for an
  inbound line waiting (`BARU`) or a thread under lease; if so it waits and
  re-checks, and gives up for the night after 10 minutes of waiting. A 429,
  529 or overload stops the night (`STOPPED`, reason in words). Calls go
  through `guardClient` (timeouts, retries) with one retry rather than the
  draft pass's two.
- **When the token cannot do it.** If the token is refused for Sonnet 5.5
  (401/403/404, or 429 on the very first call), the run is `FAILED` with the
  reason, and no other model is tried — a weaker reviewer would produce
  flags that look trustworthy and are not. The dashboard shows it.
- **Writes.** Each chat's thread row and flags in one transaction after its
  model call returns (no network inside a transaction). Run totals are
  updated as it goes.
- **Cost, for the record.** About 50 chats a day × ~8k tokens ≈ 400k in /
  50k out a night ≈ US$1.30 at list price; ~US$40 once for the backfill. On
  a subscription token it spends the owner's allowance, not dollars.

## 3. Dashboard

`/audit`, a full-screen layout of its own (no shop nav), linked from the
account menu only when the signed-in account has `canViewAudit`.
Bilingual like every screen (`t()` + `id.ts`).

- **Last night** — the run's status, when it ran, chats read, flags (bad /
  improve), cost; a `FAILED` or `STOPPED` run says why in a banner.
- **Trend** — flags per category per night over the last 30 nights, and the
  share of reviewed chats with at least one BAD flag.
- **Flags** — a `ProTable`: date, category, severity, the quote, the
  suggestion, the chat (tester tag), dismissed. Header filters on category,
  severity and date; lazy scrolling like the finance lists. A row opens the
  conversation in a drawer with the flagged line highlighted; *Dismiss*
  marks a flag not worth acting on (shown struck through, filterable).

API (`apps/api/src/routes/audit.ts`): `GET /api/audit/runs`,
`GET /api/audit/flags`, `GET /api/audit/threads/:id` (the window's lines),
`POST /api/audit/flags/:id/dismiss` and its undo. All behind
`requireAuditor`.

## 4. Access

- `requireAuditor` refuses (403) any session whose staff row lacks
  `canViewAudit`, on every `/api/audit/*` route. The menu link and the page
  check the same flag; the API is the control.
- **No switch in Settings → Staff accounts.** The flag is not in `/api/staff`
  reads or writes, so the owner can neither see nor change it. It is set by
  the migration and by the CLI (`staff --username <u> --audit on|off`).
- The store never carries review data; the dashboard reads its own routes.

## Testing

- `reviewPass` against a real test database as `nusantara_agent`, with a
  scripted model client: picks only unreviewed threads, writes thread +
  flags atomically, drops a flag naming a foreign message, respects the
  window, waits for a BARU line, stops on 429, fails (no fallback model) on a
  refused model, resumes from the cursor.
- The prompt builder is pure and unit-tested (what goes in, units' current
  records, rulebook present).
- API: 403 without the flag, dismiss/undo, `/api/staff` never exposes it.
- Migration: grants as each role, `wa_thread_delete` on a reviewed thread.
- Web: the page renders the three sections on fixture data; the menu link
  appears only with the flag; `i18n.test.ts` passes.

## Known limits

- "Wrong fact" compares against the unit's record now, not what the POS
  returned at the time; prices and stock may have moved. Every price was
  already checked by code before it was sent (`checkReply`), so the reviewer
  is a second look.
- The reviewer is an AI: its flags can be wrong. Dismiss exists for that.
- Since 2026-11-14 the bot has been answering from templates (the AI fails
  on the shop's token). The reviewer uses the same token; until that is
  fixed it may fail too, and will say so.

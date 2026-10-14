# The chatbot: what it answers from, and when it hands over

Owner ask, 2026-09-18: *"I need the chatbot to function already. I have
compiled lists of questions, first design the RAG from documents and RAG from
system to fetch the information. [...] What is going to be migrated to
production is only the master product data, store, warehouse, staff, etc. So
for the stock etc, it is generally not accurate. For stock, price,
negotiation, and other questions that are not in the documents RAG, we should
escalate it to human."*

This file is the design, and the map of where each part lives.

## The constraint everything follows from

The shop runs this app **in parallel with B2Soft**. Production holds the
master data — the catalogue, the store, the warehouses, the staff — and not
the shop's real stock, prices or books. So the bot may repeat only two kinds
of thing:

1. **Documents** — the owner's approved answers (`AgentKnowledge`), first
   loaded from the owner's question list (`docs/chatbot/knowledge-2026-09-18.md`).
2. **The system's master data** — the store's name, address, opening hours and
   contact; how a customer can pay; which configurations a model comes in.

Everything else goes to a person: stock, prices, negotiation, the condition of
a particular machine, bookings, payments, trade-in and buy-back quotes,
shipping costs, complaints — and any question the documents do not answer.

## The flow of one customer message

```
WhatsApp ─▶ webhook ─▶ WaMessage (BARU)
                          │  worker draft pass (apps/worker/src/draft.ts)
                          ▼
             ┌─ routeMessage ───────────── must a person take this? (policy.ts)
             │     yes → only handoff_to_staff is offered
             ├─ matchesFor / matchesNote ── likeliest approved answers (retrieval.ts)
             └─ buildAgentPrompt ───────── persona + rules + SHOP FACTS + APPROVED ANSWERS
                          │                 (cached), then clock + notes (per turn)
                          ▼
             Claude Haiku 4.5, tool_choice: any  (converse.ts)
               lookups:  search_knowledge · lookup_catalog
               ends with: reply(message, sources) │ handoff_to_staff(topic, summary, customer_message)
                          │
                          ▼
             checkReply — every figure and every "ready" must be in a cited source
                          │ fails → hand-over with the shop's fixed holding line
                          ▼
   DIJAWAB_AGEN + Outbox (reply)          PERLU_STAF + Outbox (holding line)
                                          entities.handoff = {topic, summary}
                                          ── the worker holds this thread until a
                                             person replies or presses Mark handled
```

## Retrieval from documents

**Source.** `AgentKnowledge` rows: question, answer, active. Staff edit them on
/chat → Knowledge; *Import from a file* takes a spreadsheet of two columns
(`qaFromRows`, packages/domain/src/qaSheet.ts) and updates an answer the file
changed; `ops/run knowledge <file>` loads a `Q:`/`A:` document on the server
(`parseQaText`) and skips a question already there.

**Ranking** (packages/agent/src/retrieval.ts). Customers do not type the
owner's questions — they type "garansinya brp lama", "co dari shopee bs ambil
di toko ga", "jam oprasional". Both sides are normalised first: lower-case,
emoji and punctuation gone, multi-word terms joined ("tukar tambah" →
`tukartambah`, "battery health" → `baterai`), chat spelling mapped ("brp" →
`berapa`, "tokped" → `tokopedia`), glued particles removed ("garansinya" →
`garansi`), filler dropped ("kak", "ya", "bisa"). Then Okapi BM25, with the
question weighted twice the answer, and a one-letter-off fallback for typos
the table does not list. A match is **strong** when its BM25 score is high or
when the customer's words cover most of the entry's question — the second
measure still means something in a knowledge base of three entries, where BM25
scores collapse. `test/retrieval.test.ts` runs 29 of the owner's questions,
typed the way customers type them, against the real sheet; every one ranks its
own answer first.

Why not embeddings: tens of entries, one language, a small known vocabulary,
and every decision is a line a person can read and a test can pin. An
embedding store needs a provider, a column type and a migration to answer the
same questions with less explanation. `indexKnowledge` is the seam if that
changes.

**How the answers reach the model** (packages/agent/src/knowledge.ts). The
owner's sheet is ~12,000 characters, so the WHOLE base rides in the prompt,
in the part that is cached — every turn after the first reads it at a tenth
of the price (measured: 88% of input tokens served from the cache). Each entry
carries a handle, `K1`…`K31`, which the model must cite. Retrieval still runs
on every message: the likeliest handles ride beside the customer's words as a
note, and past `PROMPT_BUDGET_CHARS` (40,000) the prompt carries only the best
matches and `search_knowledge` finds the rest — so the base can grow without
the prompt growing with it.

## Retrieval from the system

packages/agent/src/systemFacts.ts:

| What | From | How it reaches the model |
|---|---|---|
| Shop name, contact | `AppSetting` `shop.name`, `shop.contact` (Settings → Shop identity) | SHOP FACTS, cached |
| Store address | active `Location` rows of kind `TOKO` | SHOP FACTS, cached |
| Opening hours, open now | `STORE_HOURS` (10.00–20.00 WIB) and the clock | SHOP FACTS; "open now" per turn |
| How to pay | active `PaymentMethod` rows for sale, without `TEMPO`, `MARKETPLACE`, `B2SOFT` | SHOP FACTS, cached |
| A model's configurations | `CatalogModel`, its axes and `Sku` variant labels | `lookup_catalog`, cited `catalog` |

Never selected: a `Unit`, `Sku.price`, an `Order`, a `Customer`, a
`Reservation`. The stock and customer tools of the earlier design
(`search_stock`, `check_serial`, `browse_catalog`, `lookup_customer`,
`check_order`, `create_reservation`, `cancel_reservation`) still exist in
tools.ts, tested, but `toolsFor` offers a customer's conversation only
`CUSTOMER_TOOLS` — a model cannot call a tool it was never given.

## Hand-over

**By rule, before the model** (`routeMessage`, packages/agent/src/policy.ts):

| The message | Topic |
|---|---|
| names a machine ("air m1", "i5", "8/256", "2020"…), unless it asks what the model *is* (RAM, SSD, chip, "bedanya") | `stock`, `price`, `negotiation`, `unit_details` |
| battery health, cycle count | `unit_details` — the owner answers these with a photo |
| a payment made, a receipt, a tracking number | `order_payment` |
| keep, hold, booking, DP | `reservation` |
| a budget with no machine named | `recommendation` |
| a photo, video, voice note or document | `media` |

The generic questions the owner answered — "apakah unitnya ready?", "ada price
list?", "bisa nego?" — are NOT routed: each of those answers asks which
machine, and the next message, naming it, is the one handed over.

**By the model** (`handoff_to_staff`): anything the approved answers and the
shop facts do not cover, a complaint, a request for a person.

**By the check** (`checkReply`): a reply citing nothing, citing a handle that
does not exist, or carrying a rupiah figure or an availability claim ("ready",
"masih ada") that no cited source contains, is replaced by a hand-over with
the shop's fixed holding line (`holdingMessage`). "Rp180.000" is fine in the
COD answer because the owner wrote it there.

**What the customer hears.** A short holding line in the owner's voice —
"Siap kak 😊 Untuk stok, harga, dan kondisi unit terbarunya kami cekkan dulu
ya. Admin kami segera balas di chat ini ya kak 🙏" — or the model's own, if it
carries no figure and no stock promise. Outside 10.00–20.00 it says the admin
replies when the shop opens.

**What staff see** (/chat). Handed-over threads first, tagged *Needs you ·
Stock* (or Price, Negotiation…), with the bot's one-line note. The bot stays out
of that conversation until somebody replies there or presses **Mark handled**
(`POST /api/inbox/:phone/handled`) — the hold is derived from the messages, not
from the per-thread switch, which is staff-owned and which the bot's database
role cannot write. *Write it for me* drafts through the same engine and says
when the bot would have handed over.

## The model

Claude Haiku 4.5 (`AGENT_MODEL`), `tool_choice: any`, temperature 1 for
variety in the wording (the facts come from the sources). Measured on 14 sample
messages against the dev database: 17 calls, ~$0.03 in all.

## Loading and changing the knowledge

- First load: `ops/run knowledge <file> --by ersen` on the server (the `Q:` /
  `A:` document), or /chat → Knowledge → **Import from a file**: an .xlsx or
  .csv with the question in column A and the answer in column B (2026-10-14).
  *Download .xlsx* gives the current base in that shape; uploading an edited
  copy adds what is new and updates what changed, after a preview.
- Edit an answer, or switch one off, on /chat → Knowledge. The next reply uses
  it; nothing restarts.
- A question customers keep asking that ends in a hand-over is a missing
  answer: write it in the Knowledge tab.

## The day stock is trustworthy

When the cutover to this app is done and its stock and prices are the shop's,
bring the stock tools back: add them to `CUSTOMER_TOOLS` (tools.ts), let
`checkReply` accept their results as a source, and relax the `stock`/`price`
routes in policy.ts. Until then, those rules are the owner's.

## Where the tests are

| | |
|---|---|
| packages/domain/test/qaText.test.ts | reading the owner's sheet |
| packages/agent/test/retrieval.test.ts | ranking, on the real sheet |
| packages/agent/test/policy.test.ts | the routes and the reply check |
| packages/agent/test/converse.test.ts | reply / hand-over / refusal / caching shape |
| apps/worker/test/draft.batch.test.ts | the hold, the note, the fixed line, the cached prompt |
| apps/api/test/inbox.test.ts | the inbox's hand-over view and Mark handled |

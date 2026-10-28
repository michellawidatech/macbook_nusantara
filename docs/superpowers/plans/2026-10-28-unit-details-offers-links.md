# Unit details, offer ladder, listing links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bot describes a unit fully (condition, battery, servicing, grade), offers cheapest-grade-first with photos attached, sends a variant's marketplace link when asked to buy online, runs keep → time → DP → verify with the owner's confirmation line, and /chat names every staff bubble.

**Architecture:** Pure rules in packages/domain (condition split, serviced state, offer ladder, approval message); two additive columns sets in Postgres projected through the store; the agent's stock results carry the new facts and `checkReply` guards links; the AI prompt and the rules bot change wording/order; the web gains a QC field, a links dialog and an import.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Express, React + antd 6, vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-unit-details-offers-links-design.md`

## Global Constraints

- Never invent schema beyond the spec's migration: `Unit.neverServiced BOOLEAN NULL`; `Sku.shopeeUrl`, `Sku.tokopediaUrl`, `Sku.instagramUrl` `TEXT NULL`, CHECK `IS NULL OR (col ~ '^https://' AND length(col) <= 500)`.
- Store contract fields are OPTIONAL (an older changeset still commits).
- Every user-facing web string is `t("key", "English")` with Indonesian in `apps/web/src/i18n/locales/id.ts`; say "unit", never "machine"/"mesin".
- packages/domain imports neither Prisma, Express nor React, and keeps 100% coverage.
- `nusantara_agent` already holds table-level SELECT on Unit and Sku — no grant needed; do not add UPDATE for it.
- No model array reaches a query (`tools.schema.test.ts`).
- Bot copy, verbatim: after-photo line `Gimana kakk? Kakak juga bisa lihat unitnya langsung di toko kita 😊`; keep-time question `Siapp kak 😊 rencananya mau ke toko kapan kak?`; DP ask `Mau DP sekarang kak?`; no-link line `Bisa order langsung lewat WA ini aja kak 😊`; filler words Okayy, Okee, Ohh, Baikk, Siapp.
- Approval template: `Okeyy kak noted, kak {name} nanti akan kita siapkan {unit} nya yaa untuk {day} jam {time}. Toko kita ada di {address}, buka {hours}.`
- Web suite: `npx vitest run --maxWorkers=2 --testTimeout=90000`.

## Review Focus

- A unit with `description` empty or null → `condition` has empty lists, nothing said, no crash (Task 1 test).
- A free-typed phrase with odd case/spacing ("  baterai LEMAH ") → still a fault (Task 1 test).
- A reply quoting a link with a trailing `)` or `.` or a tracking query → compared after trimming punctuation, exact URL otherwise (Task 3 test).
- An import row whose cell holds a non-https value ("shopee.co.id/…") → reported invalid, never written (Task 8 test).
- An approval with no name and a visit with no unit → template omits both cleanly, no "kak  nanti" double space (Task 5 test).

---

### Task 1: Domain rules — condition, servicing, ladder

**Files:**
- Create: `packages/domain/src/unitCondition.ts`, `packages/domain/test/unitCondition.test.ts`
- Modify: `packages/domain/src/index.ts` (export)

**Interfaces — Produces:**
- `UNIT_FAULT_PHRASES: readonly string[]` = `["Layar ada garis","Keyboard aus","Engsel longgar","Baterai lemah","Tanpa charger","Unit only"]`
- `splitCondition(description: string | null | undefined): { faults: string[]; marks: string[] }` — split on `,`, trim, drop empty, case-insensitive membership, original casing kept.
- `type ServicedState = "never" | "yes"`; `servicedState(input: { neverServiced: boolean | null | undefined; visits: number }): ServicedState | undefined` — visits>0 → "yes"; false → "yes"; true → "never"; else undefined.
- `GRADE_LADDER = ["C","B","A","NEW"] as const`; `interface LadderUnit { serial: string; grade?: string | null; price: bigint | null; skuId: string }`; `offerLadder<T extends LadderUnit>(units: readonly T[], skuId: string): { lead: T | null; grades: Array<{ grade: string; from: bigint | null; count: number; unit: T }> }` — only units of `skuId`; lead = lowest grade per GRADE_LADDER (unknown grade after NEW), then cheapest (null price last); `grades` = one entry per OTHER grade present, cheapest unit, in ladder order.

- [ ] Step 1: tests — `splitCondition("Lecet halus, Baterai lemah, Unit only")` → `{faults:["Baterai lemah","Unit only"], marks:["Lecet halus"]}`; `splitCondition("  baterai LEMAH ")` → faults `["baterai LEMAH"]`; null/"" → both empty; `servicedState` four cases; `offerLadder` with A 12jt, C 10jt, C 9.5jt, B null, other-sku unit → lead C 9.5jt, grades `[B (from null), A 12jt]`, counts right; empty → lead null.
- [ ] Step 2: run `pnpm --filter @nusantara/domain test` → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run with coverage (`pnpm --filter @nusantara/domain test -- --coverage`) → PASS, 100%.
- [ ] Step 5: commit `feat(domain): unit condition split, serviced state, cheapest-grade-first ladder`.

### Task 2: Schema, store contract, adapters, mock types

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Unit, Sku)
- Create: `packages/db/prisma/migrations/20261028090000_unit_never_serviced_and_listing_links/migration.sql`
- Modify: `packages/store/src/schemas.ts` (`unit`: `neverServiced: z.boolean().optional()`; `sku`: `shopeeUrl/tokopediaUrl/instagramUrl: z.string().url().max(500).optional()`), `packages/db/src/store/adapters/units.ts` (project/write `neverServiced`), `packages/db/src/store/adapters/catalogue.ts` (skus project/write the three urls, `?? undefined` / `?? null`), `apps/web/src/mock/seed.ts` (`Unit.neverServiced?: boolean`, `Sku.shopeeUrl?/tokopediaUrl?/instagramUrl?: string`)
- Test: `packages/db/test/store.test.ts` (round-trip)

- [ ] Step 1: test — commit a unit with `neverServiced: true` and a sku with `shopeeUrl: "https://shopee.co.id/x"`; snapshot reads them back; a sku with `shopeeUrl: "http://x"` is refused by the contract.
- [ ] Step 2: migration SQL: `ALTER TABLE "Unit" ADD COLUMN "neverServiced" BOOLEAN;` + three `ALTER TABLE "Sku" ADD COLUMN … TEXT` + three named CHECKs. Apply on the local test DB (`pnpm --filter @nusantara/db migrate` against TEST_DATABASE_URL) and verify with a real `SELECT column_name FROM information_schema.columns …` query; `prisma generate`.
- [ ] Step 3: implement contract + adapters + mock types.
- [ ] Step 4: `TEST_DATABASE_URL=… pnpm --filter @nusantara/db test -- store` → PASS; `pnpm -r typecheck` → clean.
- [ ] Step 5: commit `feat(db): Unit.neverServiced and per-variant listing links (migration 20261028090000)`.

### Task 3: The bot's stock facts

**Files:**
- Modify: `packages/agent/src/tools.ts` (`UNIT_SELECT`, `SHELF_SELECT`, `shelfUnit`, `searchStock`, `checkSerial`, find_unit_photos ordering + description), `packages/agent/src/policy.ts` (`StockFact.links?: readonly string[]`, `checkReply` URL check), `packages/agent/src/converse.ts` (`stockFactsOf` reads `links`)
- Test: `packages/agent/test/unitFacts.test.ts` (new), existing tool/switch tests updated

**Interfaces:**
- Consumes: `splitCondition`, `servicedState`, `offerLadder` (Task 1); Sku url columns (Task 2).
- Produces: `shelfUnit` adds `condition: { faults: string[]; marks: string[] }` (omitted when both empty), `serviced?: "never" | "yes"`, `links?: { shopee?: string; tokopedia?: string; instagram?: string }`. `search_stock` result adds `grades` (from `offerLadder` over the lead unit's sku, each `unit` a `shelfUnit`) and its `units` are ordered lead-first per ladder when no explicit `sort`. `checkReply` refusal code `LINK_INVENTED`.
- SELECTs add `description: true`, `neverServiced: true`, `_count: { select: { serviceVisits: true } }`, sku `shopeeUrl/tokopediaUrl/instagramUrl`.

- [ ] Step 1: tests — `shelfUnit` of a unit with description "Lecet halus, Baterai lemah", neverServiced true, 0 visits, sku shopeeUrl → carries condition/serviced "never"/links.shopee; with 1 visit → serviced "yes"; `checkReply` with facts links `["https://shopee.co.id/a"]` accepts "…di https://shopee.co.id/a." and refuses "https://shopee.co.id/b" with `LINK_INVENTED`; find_unit_photos over A 12jt (2 photos) and C 10jt (1 photo) picks the C.
- [ ] Step 2: run `pnpm --filter @nusantara/agent test -- unitFacts` → FAIL.
- [ ] Step 3: implement. URL match: extract `https?://\S+`, strip trailing `.,!?)` — compare exact against facts' links ∪ shop-fact text.
- [ ] Step 4: `pnpm --filter @nusantara/agent test` → PASS (update fixtures that assert exact result shapes).
- [ ] Step 5: commit `feat(agent): stock results carry condition, servicing and listing links; invented links refused`.

### Task 4: The AI's behaviour — prompt, persona, buy-online

**Files:**
- Modify: `packages/agent/src/prompt.ts` (recommendation block ~L480–530, GROUNDING spec bullet), `packages/agent/src/persona.ts` (filler words), `packages/agent/src/policy.ts` (`asksBuyOnline`)
- Test: `packages/agent/test/promptRules.test.ts` (new), `packages/agent/test/routing.realchat.test.ts`

**Interfaces — Produces:** `asksBuyOnline(text: string): boolean` — true for "cara belinya gimana", "bisa checkout di shopee?", "ada link shopee/tokped?", "beli online bisa?", "order dari luar kota"; false for "mau keep", "saya ambil", "cara bayarnya?". `routeMessage` never hands these over.

Prompt changes (replace, don't stack): describe a unit with condition in words + battery + "belum pernah servis" when `serviced` is "never"; `faults` always, `marks` and servicing "yes" only when asked; recommend the ladder's lead first, then the other grades one line each, then at most one upgrade only for a stated reason; pass the lead unit's photo handles with the recommendation (no photo-offer question) and close with the after-photo line; ask needs only before the first recommendation; in-person → address + hours from shop facts, no time question; keep → keep-time question → `propose_reservation` + DP rule → DP ask → proof is a hand-over; buy online → the named platform's link (else all) or the no-link line; GROUNDING: RAM/storage/battery from the lookup ARE stateable now; chip/spec explanations from the approved answers first, else general and number-free.

- [ ] Step 1: tests — the rendered prompt (with photos+price caps) contains the after-photo line and the keep-time question and no longer contains `Mau lihat fotonya kak?`; `asksBuyOnline` table above; routing.realchat: the five buy-online lines route `null`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: `pnpm --filter @nusantara/agent test` → PASS.
- [ ] Step 5: commit `feat(agent): cheapest-first offers with photos attached, links on a buy-online question, keep → time → DP`.

### Task 5: The rules bot

**Files:**
- Modify: `packages/agent/src/rules/run.ts` (`search`, `nextStep`, `followUp`, keep branch, new buy-online branch), `packages/agent/src/rules/replies.ts` (`recommend` → ladder wording, `unitLine` adds faults + "belum pernah servis", `afterPhotos`, `keepWhen`, `dpAsk`, `buyOnline(links, platform)`, filler openers)
- Test: `packages/agent/test/rulesRun.test.ts` (or the existing rules test file)

- [ ] Step 1: tests — a search with C 9.5jt + A 12jt of one sku + a stepUp → reply leads with the C, names the A in a second line, returns the C's photo handles, ends with the after-photo line, and contains no needs-question; "mau keep yang ini dong kak" after a shown unit → keep-time question; given a time → proposal filed + DP rule + `Mau DP sekarang kak?`; "bisa checkout shopee?" with shown unit linked → the shopee URL; unlinked → no-link line; a unit with "Baterai lemah" → said; "Dent di sudut" → not said until "ada minus?".
- [ ] Step 2: run → FAIL. Step 3: implement (the buy-online branch reads `lastShownUnits`' sku links via `check_serial` on the first shown serial). Step 4: PASS.
- [ ] Step 5: commit `feat(rules-bot): ladder offers, photos attached, keep and buy-online flows`.

### Task 6: The approval message

**Files:**
- Modify: `packages/domain/src/reservationRequest.ts` (`approvalMessage`), `apps/api/src/routes/reservationRequests.ts`, `apps/web/src/components/ReservationRequestDialogs.tsx`
- Test: `packages/domain/test/reservationRequest.test.ts`, `apps/api/test/reservationRequests.test.ts`

**Interfaces — Produces:** `approvalMessage(input: { unit: string | null; when: Date; name?: string | null; place?: { address: string; hours: string | null } | null }): string` (the `dp` field goes). Unit: `Okeyy kak noted, kak Budi nanti akan kita siapkan Air M2 8/256 nya yaa untuk 30 Oktober 2026 jam 14.00.`; no name → `Okeyy kak noted, nanti akan …`; no unit → `… nanti kita tunggu kedatangannya yaa di {day} jam {time}.`; place → ` Toko kita ada di {address}, buka {hours}.` (`, buka …` dropped when hours null). API: `name = realName(proposal.custName)`; `place` from `loadStoreFacts` (first store with an address; hours `setiap hari 10.00–20.00 WIB` built from `STORE_HOURS` in packages/agent hours.ts; no address recorded → `place` null) unless an Outbox WA_REPLY/WA_IMAGE body/caption to that thread already contains the address and the latest inbound text doesn't ask where (`/\b(di ?mana|dimana|alamat|lokasi)\b/i`). Web preview passes `name` from the request and `place` always, with caption `t("requests.placeNote", "The address is left out if the chat already has it.")`.

- [ ] Step 1: domain tests for the four shapes (incl. no double spaces); API test: second approval in a thread that already got the address omits it.
- [ ] Step 2–4: fail → implement → `pnpm --filter @nusantara/domain test` and `pnpm --filter @nusantara/api test -- reservationRequests` PASS.
- [ ] Step 5: commit `feat(reservations): the owner's confirmation line on approval`.

### Task 7: A name on every staff bubble

**Files:**
- Modify: `apps/api/src/routes/inbox.ts` (reply route writes `auditLog.create({ entity: "Outbox", entityId: outbox.id, action: "CREATE", staffId })` — use the id `enqueueOutbox` returns), `apps/api/src/routes/inboxSent.ts` (`uploadersFor` also maps WA_REPLY rows via `Outbox` CREATE audit rows → staff name; `SentItemJson.fromBot: boolean` = WA_REPLY with no audit name and `requestId` null), `apps/web/src/lib/inboxApi.ts` (`fromBot?: boolean`), `apps/web/src/routes/chatbot/ChatPage.tsx` (an extra with `fromBot` renders as Bot)
- Test: `apps/api/test/inbox*.test.ts`, `apps/web/test/chatPage*.test.tsx`

- [ ] Step 1: tests — two staff replies to the same customer message by Dina then Ersen → `sent` items name Dina and Ersen; web renders "Sent by Dina" on the first bubble.
- [ ] Step 2–4: fail → implement → PASS.
- [ ] Step 5: commit `fix(chat): every staff bubble names who sent it`.

### Task 8: Web — QC field, links dialog, import

**Files:**
- Create: `apps/web/src/components/NeverServicedField.tsx` (Segmented Yes / No / Not checked → `boolean | undefined`), `apps/web/src/routes/stock/ListingLinksModal.tsx`, `apps/web/src/lib/listingImport.ts`, `apps/web/src/routes/stock/ListingImportModal.tsx`
- Modify: `apps/web/src/components/UnitDetailsModal.tsx`, `apps/web/src/components/OrphanQcCard.tsx`, `apps/web/src/routes/stock/UnitEditModal.tsx` (field; the inbound QC draft carries `neverServiced` through `applyQcDraft`), `apps/web/src/routes/stock/InventoryTable.tsx` (line action *Listing links*), `apps/web/src/routes/stock/InventoryPage.tsx` (header *Import listing links*), `apps/web/src/i18n/locales/id.ts`
- Test: `apps/web/test/listingImport.test.ts`, `apps/web/test/listingLinks.test.tsx`, `apps/web/test/neverServiced.test.tsx`

**Interfaces — Produces:** `parseListingSheet(rows: string[][]): ListingRow[]` (header row finds columns by `/produk|product|unit|nama/i`, `/shopee/i`, `/tokopedia|tokped/i`, `/instagram|\big\b/i`); `matchListings(rows, skus): { matched: Array<{ skuId; changes: Partial<Record<"shopeeUrl"|"tokopediaUrl"|"instagramUrl", string>> }>; unmatched: ListingRow[]; invalid: Array<{ row: ListingRow; field: string }>; unchanged: number }` — match by `Sku.code` or `name + " " + variantLabel` normalised the way `lib/priceImport.ts` does, live skus only (`isLiveSku`); blank cell = no change; non-`https://` = invalid.

- [ ] Step 1: tests — parse + match a three-row sheet (one by code, one by export text, one unknown, one `http://` cell); the links dialog saves three urls to the variant and rejects `shopee.co.id/x`; the QC popup's field writes `neverServiced: true`; i18n test.
- [ ] Step 2–4: fail → implement → `npx vitest run --maxWorkers=2 --testTimeout=90000 test/listing test/neverServiced test/i18n` PASS.
- [ ] Step 5: commit `feat(web): never-serviced at QC, listing links per variant, link import`.

### Task 9: Chip guide and docs

**Files:**
- Create: `docs/chatbot/chip-guide-2026-10-28.xlsx` (two columns Question | Answer, ~15 rows, owner's tone, no prices or stock), written with a one-off script under `.context/` using `apps/web/src/lib/xlsxWrite.ts`'s format or `packages/domain` qaSheet's reader as the check.
- Modify: `CLAUDE.md` (one entry for 2026-10-28 summarising the spec and the ⚠️s: the reversal of "most expensive photo", the dropped DP line, functional faults upfront).

- [ ] Step 1: generate, then read it back with `parseQaSheet` (packages/domain) → 15 pairs.
- [ ] Step 2: commit `docs: chip & spec guide for the knowledge base; CLAUDE.md entry`.

### Task 10: Verify and deploy

- [ ] `pnpm -r typecheck` → clean.
- [ ] `pnpm --filter @nusantara/domain test -- --coverage` (100%), `pnpm --filter @nusantara/agent test`, `pnpm --filter @nusantara/api test`, `TEST_DATABASE_URL=… pnpm --filter @nusantara/db test`, `pnpm --filter @nusantara/worker test`, web suite → all PASS.
- [ ] Merge the branch onto the newest `v*` tag's line (it is based on `v2026.10.27.10`), push, tag `v2026.10.28`, push the tag; watch the run and confirm `/api/health` names the new release (a green run has hidden a rollback before).

# Conventions

Everything here is a default. Deviating is fine; deviating silently is not —
write the reason in the file that deviates.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node ≥ 20, ESM only | `process.loadEnvFile`, native test runner, no CJS interop tax |
| Package manager | pnpm 9 + Turborepo | Already the repo's shape; workspace protocol keeps packages honest |
| Database | PostgreSQL 16 + Prisma | Schema is the source of truth (`packages/db/prisma/schema.prisma`) |
| API | Express + Zod | Thin handlers, schema-validated input, no framework magic |
| Front end | Vite + React 19 + TypeScript | Fast HMR; no SSR requirement for an internal tool |
| Data fetching | TanStack Query | Cache invalidation, optimistic mutations, retry policy in one place |
| Routing | React Router | File-per-route under `src/routes/<section>/` |
| Tables | TanStack Table (headless) | Column sizing, multi-select filters and keyboard nav are ours to control |
| Overlays / menus | Radix primitives | Focus trapping and dismiss semantics that are correct by default |
| Styling | CSS Modules + design tokens | No utility-class sprawl, no runtime CSS-in-JS cost |
| Charts | Recharts | Already understood; keep chart count low |
| Tests | Vitest + Testing Library + Supertest | One runner across web, api, packages |

### On the component library

**Recommendation: build on headless primitives, not Ant Design Pro.**

The current build uses antd v6 + Ant Design Pro. Pro is excellent at producing a
complete admin shell quickly, and that is exactly the problem here: the shell,
the table density, the filter affordances and the form rhythm all arrived as
defaults rather than decisions, and the interaction gaps this rebuild exists to
fix (multi-select filters, column sizing, serial-level pickers, undo instead of
confirm, scanner focus) are all fights against those defaults.

Headless primitives cost more up front — you write the table, the toolbar and
the drawer once, in [Increment 1](04-increments.md#increment-1--interaction-kit).
After that every screen is cheap and every interaction is yours.

**If you keep Ant Design Pro instead** (a defensible call if the timeline is
short), then Increment 1 changes from "build the kit" to "constrain the kit":
replace `ProTable`'s filter dropdowns with multi-select, set explicit
`ellipsis` + column widths globally, override the `ProLayout` chrome, and add
the command palette and undo toasts yourself. Budget the same time either way.

---

## 2. Repo layout

```
apps/
  api/                 Express REST API                    :4000
  web/                 Vite + React SPA                    :3000
  whatsapp-webhook/    Meta webhook receiver + agent       :3001
  worker/              Outbox sender + scheduled jobs      (no port)
  monitor/             Log + integrity viewer (read-only)  :4100
packages/
  db/                  Prisma schema, client, txn helpers
  domain/              Pure business logic — no I/O, no Prisma
  logging/             pino setup + request middleware + redaction
  whatsapp/            Graph API client for WhatsApp
  instagram/           Graph API client for Instagram
docs/
  erd-pos-chatbot.drawio
  rebuild/             this plan
secrets/
  webhook-credentials.env.example   committed template
  webhook-credentials.env           gitignored — see 07-credentials.md
```

`packages/marketplace` is deleted with the ecommerce scope.

**Rules.**

- `packages/domain` must stay import-free of Prisma, Express and React. It is
  where the unit state machine, margin guides, PO fee allocation, money
  formatting and the reconciliation checks live, and it is the only code that is
  trivially unit-testable. If a rule is worth a test, it belongs here.
- An app never imports from another app. Shared code goes to `packages/`.
- `packages/db` exports the Prisma client plus the transaction helpers
  (`withRetry`, `withUnitLocks`, the outbox claim). No query helpers — those
  belong to the app that owns the use case.
- `apps/worker` is the only process allowed to call an external API as a
  consequence of a database write. See
  [08 §5](08-data-integrity.md#5-crossing-the-boundary-outbox-not-fire-and-forget).

---

## 3. Naming

- **Routes and UI copy are Indonesian**, matching the staff who use it:
  `/penjualan/riwayat`, "Simpan PO", "Nilai Produk". The bilingual toggle
  (ID/EN) translates labels; it does not translate URLs.
- **Code identifiers are English**: `purchaseOrder`, `gradingRecord`, `unit`.
  The database already mixes the two (`produk`, `harga`, `lokasi`, `whenText`) —
  do not "fix" existing column names, just don't add new mixed ones.
- **Files**: `PascalCase.tsx` for components, `camelCase.ts` for modules,
  `kebab-case` for route segments.
- **Page vs Client split**: `XPage.tsx` owns data fetching and layout;
  `XClient.tsx` owns interaction state. Keep it — it makes the fetch boundary
  visible and the interaction layer testable without a server.

---

## 4. API contract

- Base path `/api`. Public: `/api/health`, `/api/auth/*`. Everything else sits
  behind `requireAuth` (JWT in an HttpOnly cookie, `nusantara_token`).
- One router per section, mounted in `apps/api/src/routes/index.ts`. Longer
  prefixes mount first.
- Handlers are thin: validate with Zod `safeParse` → call domain/Prisma → return.
  No business logic in a route file longer than a screen.
- **Money is `BigInt` whole rupiah** everywhere, serialized as a JSON string.
  Never `number` — cumulative report sums exceed `Number.MAX_SAFE_INTEGER`'s
  comfortable range in rupiah, and float cents do not exist in IDR.
- Errors return `{ error: { code, message, field? } }`. `message` is written for
  a human staff member in Indonesian, because it is shown verbatim.
- Mutations that a user can regret return enough state to undo them (see
  [02 §6](02-interaction.md#6-undo-over-confirm)).
- Every response carries `x-request-id`; the SPA echoes it back on the next
  request as `x-correlation-id`. See [05-logging.md](05-logging.md).

### Endpoint surface to carry over

Sections from the current API that survive the rebuild:

```
/api/auth        login, logout, me, sessions (revoke one / all)
/api/bootstrap   shell payload: staff, locations, store name, counters
/api/penjualan   kasir, checkout, pembayaran, riwayat, retur, void, refund,
                 trade-in, pelanggan, pengiriman, reservasi, garansi
/api/inbound     purchase-order, kedatangan, retur-supplier
/api/katalog     models, categories, category-attributes, skus, inventori,
                 harga, unit/:serial (lifecycle), unit/:serial/catatan, transfer
/api/kontrol     log transaksi, log harga, diskon, opname, lokasi, audit
/api/laporan     arus kas, insight, supplier
/api/pesan       WhatsApp threads, reply, status, ringkasan, catatan
/api/komentar    Instagram comments, reply, dm, settings, sync
/api/wilayah     postal code lookup
```

Dropped: `/api/katalog/kompetitor/*`, `/api/katalog/marketplace/*`,
`/api/katalog/import-shopee`, `/api/penjualan/trade-in-market`,
`/api/inbound/grading`, `/api/inbound/grading-config`.

New: `/api/katalog/unit/:serial` (the lifecycle timeline — the highest-value
endpoint in the rebuild), `/api/katalog/transfer`, `/api/penjualan/pembayaran`,
`/api/kontrol/lokasi`, `/api/kontrol/audit`.

---

## 5. Front-end conventions

**State ownership.**

| Kind of state | Lives in |
|---|---|
| Server data | TanStack Query, keyed `[section, resource, params]` |
| Filters, sort, pagination, open drawer | The URL (`?grade=A,B&lokasi=gudang-1`) |
| Unsaved drafts (cart, PO lines, grading session) | `localStorage`, keyed by user + entity |
| Ephemeral (hover, focus, menu open) | Component state |

Putting filters in the URL is not a nicety: it is how a staff member sends a
colleague "the twelve units that failed opname" without describing it in words.

**Query rules.**

- `staleTime` defaults to 30s for lists, 0 for anything money-related.
- Mutations invalidate by section key, never `queryClient.clear()`.
- Every mutation defines `onMutate` (optimistic), `onError` (rollback + toast)
  and `onSettled` (invalidate). If optimism is wrong for that mutation, write
  why in a comment rather than omitting the hooks.

**Component rules.**

- No component fetches its own data more than one level below a `*Page.tsx`.
- Never call a toast/notification inside a state updater or a render — schedule
  it in an effect or the mutation callback. (React 19 will warn; antd's message
  API silently no-ops.)
- Any list of more than ~200 rows virtualizes. Inventory routinely exceeds this.
- Every interactive element has a visible focus ring. No `outline: none` without
  a replacement.

**Design tokens.** One `tokens.css` holds colour, spacing, radius, type scale and
elevation. Components read tokens; they never hardcode a hex value. This is what
makes a later visual change a token edit rather than a rewrite.

---

## 6. Database conventions

The full contract is [08-data-integrity.md](08-data-integrity.md). These are the
rules you need in your head while writing a query.

- Schema changes go through `prisma migrate dev`, never `db push`. A recorded-
  but-unapplied migration is the single nastiest failure mode in this repo:
  `migrate status` will claim everything is fine while the table is missing.
  After any migration, **verify with an actual query**, not with `migrate status`.
- Constraints Prisma cannot express — `CHECK`, partial unique indexes, table
  grants — are hand-written into a `--create-only` migration. If an invariant
  matters, it lives in the database, not in a service layer.
- **No new loose links.** Every relation is a declared foreign key with an
  explicit `onDelete`. If a link is genuinely optional, the column is nullable —
  it is never a string that happens to match.
- **No new JSON columns.** The only permitted JSON in the schema is data whose
  shape we do not own: `WaRawEvent.payload`, `IgRawEvent.payload`,
  `WaMessage.entities`, `AgentCache.value`, `AppleDbCache.models`. Anything the
  application defines gets a table.
- `BigInt` for money, `String` cuid for ids, `DateTime` for instants,
  `String` `YYYY-MM-DD` for calendar days (Asia/Jakarta). Never `Float` for money.
- **Every unit state change is a `UnitEvent`**, appended in the same transaction
  as the projection it updates. Never update `Unit.status` alone.
- Codes (`Order.code`, `PurchaseOrder.code`, …) come from a Postgres sequence,
  never from application-side counting.
- Nothing is hard-deleted. `Unit` and `Sku` archive. `AuditLog` and `UnitEvent`
  cannot be deleted at all — the app's DB role has no grant for it.
- Reads that matter are ordered and paginated by an indexed key. An unbounded
  `findMany` on `Unit` is a bug waiting for the inventory to grow.

---

## 7. Testing

| Layer | Tool | What must be covered |
|---|---|---|
| Domain | Vitest | Unit state machine, margin guides, PO fee allocation, money formatting, reconciliation checks — 100% of branches |
| Database | Vitest + a real Postgres | Every invariant in [08 §2](08-data-integrity.md#2-invariants-and-what-enforces-each), provoked directly and asserted by error code |
| Concurrency | Vitest | Two transactions racing for one serial; ordered locking under deadlock pressure; idempotency-key replay |
| API | Vitest + Supertest | Every mutation endpoint: happy path, auth failure, authz failure, validation failure |
| Webhook | Vitest + Supertest | Handshake, signature reject, dedup, fail-closed with no secret |
| Web | Vitest + Testing Library | Interaction contracts from [02](02-interaction.md), not snapshots |
| E2E | Playwright (Inc 10) | Three journeys: sell a unit, receive a PO, answer a chat thread |

Database and concurrency tests run against a real Postgres (a throwaway
container), never a mock. A mocked constraint proves nothing about the
constraint.

Fail-closed tests must not read the developer's `.env` — inject config
explicitly. (This repo has already been bitten by that once; see commit
`d6f18dd`.)

---

## 8. Git

- Branch per increment: `rebuild/inc-3-cashier`.
- Conventional commits: `feat(web):`, `fix(api):`, `docs(rebuild):`.
- One increment = one PR. The PR description links its section in
  [04-increments.md](04-increments.md) and ticks its Definition of Done.
- `secrets/` is gitignored. Verify with `git check-ignore -v <path>` before any
  commit that touches it — never rely on it "looking ignored".

---

## 9. References

**Data model**
- [`docs/erd-pos-chatbot.drawio`](../erd-pos-chatbot.drawio) — the ERD this plan builds against
- [`08-data-integrity.md`](08-data-integrity.md) — invariants, transactions, migration, security
- `packages/db/prisma/schema.prisma` — the **pre-rebuild** schema, kept as the migration source

**Existing implementation worth reading before rewriting**
- `apps/whatsapp-webhook/src/app.ts` — the fail-closed webhook contract
- `apps/whatsapp-webhook/src/signature.ts` — raw-bytes HMAC, constant-time compare
- `apps/whatsapp-webhook/src/persist.ts` — dedup via a unique constraint, not a pre-check
- `apps/whatsapp-webhook/src/agent/pipeline.ts` — categorize → tool → handoff
- `apps/whatsapp-webhook/src/agent/debounce.ts` — per-sender quiet window
- `packages/logging/src/redact.ts` — what never reaches the log sink

**External**
- [PostgreSQL — Transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html) · [Explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html)
- [Prisma — Transactions and batch queries](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- [WhatsApp Cloud API — Set up webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)
- [Instagram Platform — Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)
- [TanStack Table](https://tanstack.com/table) · [TanStack Query](https://tanstack.com/query)
- [Radix Primitives](https://www.radix-ui.com/primitives) · [pino](https://getpino.io)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) — the security bar
- [WCAG 2.2 AA](https://www.w3.org/WAI/WCAG22/quickref/) — the a11y bar for Increment 10

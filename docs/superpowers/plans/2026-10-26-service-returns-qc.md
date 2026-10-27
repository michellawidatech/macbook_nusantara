# Build plan — service, supplier refunds, unpaid returns, QC finder

Spec: `docs/superpowers/specs/2026-10-26-service-returns-qc-design.md` (owner-approved 2026-10-26).

Each task is built on its own branch in its own git worktree cut from
`michellawidatech/faktur-b2soft-template` at the spec commit, then merged back.
Wave 1 runs in parallel (disjoint files except `apps/web/src/i18n/locales/id.ts`,
which merges by hand). Wave 2 runs in order, on top of wave 1's foundation.

## Wave 1 (parallel)

| Task | Spec part | Touches |
|---|---|---|
| A — `ops/purge-unit` | §1 | `deploy/macmini/ops/purge-unit`, `build-release.mjs` if ops files are listed |
| B — Unpaid, returned | §5 | `lib/saleStatus.ts`, `TransactionsPage.tsx`, `CashflowPage.tsx`, tests |
| C — Waiting for QC | §6 | `routes/inbound/InboundPage.tsx`, new `lib/qcWaiting.ts`, nav badge, tests |
| D — Schema + store foundation | §7, server side of §2/§3 | prisma schema + migration, `packages/store` schemas, `packages/db` adapters, fixture/seed payment method, mock types, db tests |

## Wave 2 (in order, after D merges)

| Task | Spec part | Touches |
|---|---|---|
| E — Service | §2, §4 (send-to-service half, Stock out) | `ServicePage.tsx`, `lib/service.ts`, new `components/SendToServiceModal.tsx`, `InboundDetailPage.tsx`, `InventoryPage.tsx` (+ ⋯ menu), `CustomerReturnPage.tsx`, CashflowPage category, tests |
| F — Supplier return money | §3, §4 (return half) | new `components/SupplierReturnModal.tsx`, `SupplierReturnPage.tsx`, return history Mark received, `lib/supplierReturn.ts` (rule C), InboundDetailPage QC reject + reopen, Inventory ⋯ menu, `lib/accounts.ts`, tests |

## Every task

- TDD: the pure rule first, with its test, then the screen.
- Every user-facing string through `t("key", "English")` with Indonesian in
  `apps/web/src/i18n/locales/id.ts`; "unit", never "machine"/"mesin"; empty
  cells say `fmtNone()`.
- Before handing back: `pnpm -r typecheck` (or the touched packages'), the
  touched test files, `apps/web/test/i18n.test.ts`; db tests on a PRIVATE
  throwaway database.
- Commit on the task branch, files staged by name.
- CLAUDE.md gets one dated entry per task, in the file's voice.

## After both waves

Full web suite (`npx vitest run --maxWorkers=2 --testTimeout=90000`), db suite,
typecheck, lint; then hand the user the deploy steps (tag) and the
`purge-unit` run.

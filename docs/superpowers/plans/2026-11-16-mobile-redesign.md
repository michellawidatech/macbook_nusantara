# Mobile redesign — plan (2026-11-16)

Spec: `docs/superpowers/specs/2026-11-16-mobile-redesign-design.md`.
Branch `michellawidatech/mobile-redesign` from `v2026.11.16.4`. Every change is
gated on `compact` (`useLayoutMode`); desktop unchanged. One commit per phase,
files staged by name.

Test commands (apps/web):
- affected: `npx vitest run <files> --maxWorkers=2 --testTimeout=120000`
- full (end of every phase, in the background, ~10 min):
  `npx vitest run --maxWorkers=2 --testTimeout=180000 --hookTimeout=60000`
- `pnpm -r typecheck`, `npx prettier --check <files>`, `npx eslint <files>`.

## Phase 0 — spec and plan
Commit the two documents.

## Phase 1 — the shell
1. `layouts/BottomTabBar.tsx`: five `<Link>` tabs, `aria-current`, the chat
   badge, finance-aware (`navSectionsFor`). `activeTab(pathname)` exported and
   unit-tested.
2. `routes/MorePage.tsx` + `/more` in `pages.tsx`: account card, sections
   from `navSectionsFor` minus the tab leaves, preferences (appearance,
   language), scanner chip, sign out, chat health notice. The account
   controls move out of `AppLayout` into a shared hook/component so the two
   cannot drift.
3. `AppLayout`: on `compact`, no header, tab bar under Content,
   `--nusantara-content-bottom` published; 768–991 untouched.
4. `FooterToolbar` reads `--nusantara-content-bottom`.
5. `components/ActionSheet.tsx`: bottom Drawer of text rows.
6. `PageContainer` compact app bar: sticky, back, title, labelled primary,
   More ▾ → ActionSheet (`actions` + new `menu`). FloatButton removed.
7. `test/pageActions.ts` follows; `stockOneForm.test.tsx` updated.
8. Tests: `bottomTabBar.test.tsx`, `morePage.test.tsx`, `pageAppBar.test.tsx`;
   `navColumn.test.tsx` kept on desktop.

## Phase 2 — lists and cards
1. `components/FilterSheet.tsx` (facet chips with counts, date presets,
   draft, Reset / Show n) and `components/SortSheet.tsx`; `lib/datePresets.ts`
   (Today, 7 days, This month as `DayRange`s, and which preset a range is).
2. `ProTable` compact toolbar: search + Filters (n) + Sort, chip row with
   horizontal scroll; the selects/pickers removed. Same state.
3. `DataTable`: `card` model + chevron; `cardGroup` sticky headings;
   expandable-in-card; treeData children-in-card; ProTable stops forcing
   `cards: false` for treeData.
4. Update the tests that drove the phone selects (inventoryToolbar,
   stockHistoryPage, inventoryPage, …) to the sheet.
5. Tests: `filterSheet.test.tsx`, `datePresets.test.ts`,
   `dataTableCards.test.tsx`.

## Phase 3 — dialogs and inputs
1. `ThemeProvider`: on compact, `modal`/`drawer` class
   `nusantara-sheet-full` and `controlHeight` 44 / LG 48 / SM 32.
2. `global.css`: the full-screen sheet layout (✕ left, sticky header, body
   scroll, pinned footer, primary full width), `.ant-modal-confirm` excluded;
   `EmbeddedFooter` pinned in such a sheet.
3. `inputMode="numeric"` on MoneyInput / CommitMoneyInput / CountInput.
4. `components/ScanButton.tsx` (+ camera dialog when `BarcodeDetector`
   exists, otherwise focus + hint); wired beside serial boxes with a scan
   target (till search, Stock In/Out batch, service batch, QC popup serial).
5. Tests: `fullScreenDialogs.test.tsx`, `scanButton.test.tsx`, money input
   inputMode.

## Phase 4 — screens
1. Inventory: Stock In / Stock Out buttons under the app bar, Export and
   movement history in More, line cards, the line detail full screen with unit
   cards and Set price / Print label / Edit unit.
2. Stock In / Out: type tiles on compact.
3. Transaction History: day-grouped cards, sale detail full screen with
   pinned Edit transaction / Print invoice, More: Record payment, Delete.
4. Chat: list header (search, category chips with counts, waiting first),
   conversation strips and composer chips.
5. Till: Scan beside search, tile/visual alignment.
6. Inbound QC popup: grade as four big buttons on compact, Scan by serial.
7. Remaining sideways grids: Income & Expense, Profit & Loss tables, inbound
   purchase lines, Inbound list — cards.
Tests for each screen's phone path; existing phone tests updated.

## Phase 5 — finish
CLAUDE.md entry before "⚠️ **The web suite needs room.**"; screenshots at
390×844 into `.context/mobile-build-screenshots/` from a throwaway
`vite --mode test` harness (not committed); full suite, typecheck, prettier,
eslint.

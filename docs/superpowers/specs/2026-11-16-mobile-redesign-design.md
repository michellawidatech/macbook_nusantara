# The phone layout, redesigned — 2026-11-16

Owner-approved mockup: `.context/mobile-design/index.html` and its screenshots
(`a1`…`g1`, `annotated/`), approved as drawn on 2026-11-16, including: the
Stock In / Stock Out type tiles scroll with the form; the bottom tabs are
**Sell · Stock · Sales · Chat · More**, with Inventory under Stock,
Transaction History under Sales, and Inbound & QC and everything else under
More. Built on `v2026.11.16.4`, branch `michellawidatech/mobile-redesign`.

## Scope

"Phone" is `compact` from `useLayoutMode` (below antd `md`, 768px) — the one
boundary the app already uses. **Nothing above it changes**: the desktop sider,
the tablet drawer (768–991) and every desktop table, header and dialog are as
they were. Every change below is gated on `compact`.

The mockup's sample data, colours and type are illustrative; the app keeps its
own tokens (`theme/tokens.ts`), antd 6 components, bilingual copy and the
behaviour every screen already has. Where the mockup and a screen's behaviour
disagree, the behaviour stays and the difference is listed at the end.

## 1. Navigation (a1, g1)

- **Bottom tab bar** (`layouts/BottomTabBar.tsx`), on a phone only, under the
  content — a flex sibling of `Layout.Content`, not `position: fixed`, so
  nothing has to know its height except `FooterToolbar`, which reads
  `--nusantara-content-bottom` the way it already reads
  `--nusantara-content-left`.
  - Sell → `/stock/out` (the till), Stock → `/stock/inventory`,
    Sales → `/finance/transactions`, Chat → `/chat` (the waiting count, the
    same `NavBadge kind="chatWaiting"`), More → `/more`.
  - Icon **and** a text label on every tab; the active one carries
    `aria-current="page"` and the selection pill. Every tab is a real
    `<Link>` (2026-09-21: a place can be long-pressed into a new tab).
  - Which tab is lit: the four named paths and anything under them; every
    other page — Inbound, Service, Settings… — lights More, because that is
    where it was reached from.
  - **Finance access is respected**: Sales is drawn only for
    `canViewFinance` (an account without it has 4 tabs). Owner-only and
    approver-only leaves follow `navSectionsFor` as on the desktop.
- **More** (`routes/MorePage.tsx`, route `/more`, every viewport): the account
  card (name, role), then the desktop menu's own sections — Today (approver),
  Stock, Product, Financial & Report, Customer, Supplier, Settings — as rows of
  icon + word + chevron with the nav's badges, **minus the four leaves that are
  tabs**. Then Preferences: Appearance (Light / Dark / System) and Language
  spelled out, the scanner status, and Sign out. The chatbot health notice sits
  at the top while it has something to say.
- On a phone the 56px header with the hamburger, brand, scanner chip and bell
  is gone (the tab bar replaces the drawer; the Chat tab carries the count).
  768–991 keeps it unchanged.

## 2. The app bar and page actions (a1, a3, c1, c3)

`PageContainer` on a phone renders its title row as an **app bar**, pinned to
the top of the scroll area: back arrow (when `backTo`), the title (one line,
ellipsis), then **one labelled primary action** and a **"More ▾"** button.

- The primary is the first action with `type: "primary"`; a page with exactly
  one action shows that one whatever its type. Every other action is a TEXT
  row (icon + word) in an `ActionSheet` — a bottom sheet (antd `Drawer`,
  `placement="bottom"`), opened by More ▾. No icon-only control anywhere.
- The `FloatButton` fan and its 88px spacer are gone. `test/pageActions.ts`
  presses the labelled button, else opens **More actions** and presses the row.
- A page may also hand the app bar a `menu` of extra text rows (export, print,
  movement history) — what the mockup puts behind More on Inventory and
  Transaction History.

## 3. Lists — search, Filters, Sort (a1, a2, c1, c2)

`ProTable` on a phone draws **one row**: the search box, **Filters (n)** and
**Sort**. The stacked full-width selects and range pickers are gone.

- **Filters** opens a bottom sheet: each facet column is a heading ("2
  picked"), and its values are tap-to-select chips (`aria-pressed`), each with
  a count — the rows it would leave given the other filters and the search; a
  zero is dimmed, never hidden. A date column is presets — **Any date, Today,
  7 days, This month, Custom** — and Custom opens two date fields. The sheet
  edits a draft; the footer is pinned: **Reset** and **Show n results**, the
  number following every tap. Nothing applies until Show.
- **Sort** opens a sheet listing each sortable column both ways
  ("Date — newest first / oldest first", "Price — high to low / low to
  high"…) and *Default order*. A pick applies and closes.
- What is on shows as removable chips in a horizontally scrolling row, with
  *Clear all* once two or more are on.
- **Same state as the desktop headers.** The sheet writes the very `filters`,
  `ranges` and `sort` the column headers write (and `persistKey` keeps), so a
  filter picked on one survives a rotation to the other.

## 4. Cards (a1, c1)

`DataTable`'s phone card gets one anatomy, used by every list:

```
[lead tile]  Title                         [status tag]
             subtitle
             fact · fact · fact
             meta (date, time)              Amount (bold)   ›
```

- A caller passes `card={(row) => ({ title, subtitle, lead, tag, facts,
  amount, amountNote, meta })}` to build it. Without it the generic card
  stays (first titled column as heading, label/value lines), now with the
  chevron when the row opens something.
- **Nothing scrolls sideways at 390px.** An `expandable` table — which kept
  its grid on a phone until now — draws cards whose expansion opens INSIDE the
  card (Inventory's units, Service's serials); a `treeData` table (Payable,
  Receivable) draws the group card with its documents as cards beneath a
  "Show n" toggle. `cards={false}` is still honoured where a caller set it
  for an input grid; those grids are `EditableTable`s and already stack.
- Day groups: a list may pass `cardGroup={(row) => ({ key, label, total })}`
  and get sticky day headings with a running figure (Transaction History).

## 5. Dialogs (b1, b3)

Every `Modal` on a phone is **full screen**: a header with ✕ on the left and
the title, a body that scrolls, and the footer pinned to the bottom with the
primary button taking the width. Done centrally: `ThemeProvider` gives antd's
`ConfigProvider` a `modal` and `drawer` class (`nusantara-sheet-full`) while
`compact`, and `global.css` lays it out. Confirmation dialogs
(`Modal.confirm`, `.ant-modal-confirm`) stay small and centred. Desktop
widths are untouched. A form dialog whose buttons live in its body
(`EmbeddedFooter`) pins that footer the same way.

## 6. Inputs

- antd's `controlHeight` is 44 on a phone (48 large, 32 small) — set in the
  phone theme, so every Input, Select, Picker and Button is a thumb-sized
  target without per-page styling. Input text stays 16px (iOS zoom).
- Money boxes (`MoneyInput`, `CommitMoneyInput`, `CountInput`) carry
  `inputMode="numeric"` — the number pad.
- **Scan** beside a serial box that has a scanner target (the till's search,
  Stock In / Out, the service batch, QC): a labelled button. With the
  browser's `BarcodeDetector` it opens the camera and puts what it reads into
  the box; without one it focuses the box, where a paired handheld types, and
  says so.

## 7. Screens

- **Inventory (a1–a3).** Under the app bar, **Stock In** and **Stock Out** as
  two labelled half-width buttons (the footer bar of 2026-11-16 goes); Export
  stock and the movement history behind More. Lines are cards (grade tile,
  product, variant, warehouse, units, price range); a tap opens the line full
  screen — the summary (grade, code, warehouse, units, sell price) and one card
  per serial (serial, price, rack · photos, battery, Never serviced, the hold,
  description) with **Set price · Print label · Edit unit** in words. Counted
  products list their moves as today.
- **Stock In / Stock Out (b1–b3).** Full screen. The type is a 2×2 grid of
  labelled tiles (icon + word, `role="radio"`) that scrolls with the form; the
  rest of each form is unchanged, its serial boxes get Scan, and the primary
  button says what will happen.
- **Transaction History (c1–c3).** Cards grouped by day under sticky
  headings with the day's received total: order number, payment state in
  words, channel dot + customer, the units, the time, what was received on the
  right. Filters sheet: date presets, channel, payment status. A tap opens the
  sale full screen: status (still owed, promised by), customer, units, the
  money, payments, with **Edit transaction** and **Print invoice** pinned at
  the bottom; Record payment and Delete behind More.
- **Chat (d1, d2).** The existing phone flow (list, then the conversation)
  restyled: search, category chips with counts, *Waiting for you* first with
  the amber edge and category tag; the conversation's app bar (back, name,
  phone, More), the auto-reply switch strip, the waiting strip with Mark
  handled, the outlined waiting message, and the composer's tool chips in
  words with Send.
- **The till (e1, e2).** Its 2026-09-01 phone layout stays; visuals align —
  Scan beside the catalogue search, the grade tile, the dark total bar.
- **Inbound & QC (f1).** The unit popup on a phone is the full-screen QC
  card: product + COGS, serial with Scan, grade as four big buttons, battery,
  description phrases, Accept pinned with what is missing said above it.
- **More (g1)** as section 1.

## Testing

`test/setup.ts` answers "no" to every media query, so every test renders the
phone layout. Existing tests that drove the toolbar selects or the float fan
are updated to the sheet and the app bar — the assertion is kept, the gesture
changes. New: `bottomTabBar.test.tsx`, `morePage.test.tsx`,
`filterSheet.test.tsx`, `pageAppBar.test.tsx`, `fullScreenDialogs.test.tsx`,
`dataTableCards.test.tsx`.

## Deviations from the mockup (behaviour kept)

- **Sales is hidden** for an account without finance access (the mockup has
  one user, the owner). Such an account sees four tabs.
- **Grade "Like new / Good / Fair"** captions under the QC buttons are not
  added: the app's grades are New / A / B / C with no official wording, and
  inventing one is an owner decision.
- **Payment status chips** use the app's own statuses (`salePaymentStatus`),
  which are more than the mockup's five.
- **The till's payment step** keeps its own layout (2026-09-01) and the tab
  bar: the mockup hides the tabs on that step, which the till cannot know
  about without coupling the shell to one page.
- **QC "unit 3 of 8" progress** is the popup's own list; the mockup's single
  card stepping through units would replace the grid the bench uses.
- **Camera scanning** needs `BarcodeDetector` (Chrome on Android); on iPhone
  Safari the Scan button focuses the box for a handheld.

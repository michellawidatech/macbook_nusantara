# Interaction principles

This is the standard every screen is held to. It is deliberately about
*interaction*, not appearance: a beautiful screen that makes a cashier type a
serial number twice has failed, and a plain screen that never does has not.

Use it as a checklist. An increment is not done until its screens pass §16.

---

## 0. Who this is for

Three operators, all of them repeat users, none of them reading the UI carefully
after week one:

| Operator | Session shape | What kills them |
|---|---|---|
| **Cashier** | 30 s – 3 min, customer waiting, one hand on a scanner | Anything that needs the mouse; a dialog between them and the total |
| **Warehouse / inbound** | 20–90 min, 50–200 serials in a sitting | Losing a half-entered batch; re-typing a serial the scanner already read |
| **Owner / admin** | 5–20 min, reading and deciding | Numbers they can't trace back to rows; filters that can't express the question |

Design for the second visit, not the first. Discoverability matters once;
throughput matters every day.

---

## 1. Latency budgets

Perceived speed is a feature with a number attached. These are budgets, not
aspirations — Increment 10 measures them.

| Interaction | Budget | Technique |
|---|---|---|
| Keystroke → visible feedback | **< 50 ms** | Local state only; never round-trip a keystroke |
| Scan → line appears in cart | **< 150 ms** | Optimistic insert, reconcile on response |
| Click → screen responds *somehow* | **< 100 ms** | Disabled+spinner on the control itself, not a page overlay |
| Route change → useful content | **< 300 ms** | Prefetch on nav hover; render the shell + skeleton immediately |
| List filter/sort | **< 100 ms** | Client-side for < 2 000 rows; server-side above, debounced 250 ms |
| Checkout submit → receipt | **< 1.5 s** | One request; show progress if it exceeds 800 ms |

**Rule: never block the whole screen for a partial operation.** Loading state
belongs to the smallest region that is actually changing.

---

## 2. Keyboard first, mouse optional

Every screen has a **primary key path** — the sequence that completes its main
job without touching the mouse. Write it in the page's file header comment as a
one-line contract, and test it.

Global bindings (registered once, in the shell):

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette — go to page, find SKU, find order, find serial |
| `/` | Focus the page's primary search field |
| `Esc` | Close topmost overlay; if none, clear the focused field |
| `⌘Enter` | Submit the current form or drawer |
| `⌘S` | Save draft (PO, grading session) |
| `?` | Keyboard help sheet, listing this page's shortcuts |
| `Alt+1…5` | Jump to nav section |

Page-level:

| Screen | Primary key path |
|---|---|
| Kasir | `/` → scan/type → `Enter` (adds line) → `⌘Enter` (checkout) → `Enter` (confirm) |
| Inventori | `/` → filter → `↑↓` → `Enter` (open unit drawer) → `Esc` |
| Riwayat Serial | scan anywhere → history opens → `n` adds a note → `⌘Enter` saves |
| Kedatangan | scan → row appears → scan again; `⌘Enter` posts the whole arrival |
| PO | `Tab` through line fields, `Enter` adds a new line, `⌘S` saves draft |
| Opname | scan continuously; `Esc` opens the unknown-serial review list |
| Pesan | `↑↓` threads, `Enter` opens, `r` focuses reply, `⌘Enter` sends |

Rules:

- **`Enter` never navigates away from an in-progress entry.** In the cart,
  `Enter` adds a line. Checkout is `⌘Enter`. Losing a cart to a stray `Enter` is
  the single most expensive UI bug a POS can have.
- Every actionable row is reachable by `↑`/`↓` and actionable with `Enter`.
- A shortcut that only works when a specific element has focus is not a
  shortcut. Register on the page, not the input.
- Never bind a bare letter key while a text input has focus.

### Barcode scanners

A scanner is a keyboard that types very fast and ends with `Enter`. Treat it as
a first-class input:

- The scan target field is **focused on mount and re-focused after every
  successful scan**. If the user clicks elsewhere, a visible "Scanner ready"
  chip in the toolbar reclaims focus on click.
- Detect scans by inter-keystroke timing (< 30 ms between characters) so a
  scanned serial can skip validation debounce and commit immediately.
- **Unknown serial is a recoverable state, not an error dialog.** Show the value
  inline with two actions: *Cari manual* and *Tambah sebagai unit baru*. Keep
  focus in the field so the next scan works.
- Duplicate scan of a serial already in the cart increments nothing and does not
  error — it highlights the existing line for 600 ms and keeps going. Serials
  are unique units; a double scan is a hand slip, not an intent to buy two.

---

## 3. Focus discipline

Focus is state. Manage it explicitly, everywhere:

| Event | Focus goes to |
|---|---|
| Overlay opens | First focusable control, or the first *invalid* field if reopening after an error |
| Overlay closes | The control that opened it |
| Row deleted | The next row; the previous if it was last; the table if empty |
| Form submit fails | The first field with an error, and announce the error |
| Async content arrives | Nowhere — never steal focus from a typing user |
| Toast appears | Nowhere; toasts are `aria-live="polite"`, never focus traps |

Overlays trap focus and close on `Esc` and on outside click **unless they hold
unsaved input**, in which case outside click is ignored and `Esc` asks once.

---

## 4. Optimistic by default, honest on failure

Every write applies to the UI immediately and reconciles after.

The failure path is what actually matters, and it has three parts:

1. **Roll the row back visibly** — animate it back rather than snapping, so the
   user sees which row failed.
2. **Say what happened in one sentence, naming the row.** "Serial `C02X1234`
   sudah terjual — tidak bisa ditambahkan." Not "Gagal menyimpan."
3. **Offer the next action inline**: *Coba lagi*, or the fix. A failure toast
   with no action is a dead end.

Do not be optimistic about: checkout, PO submission, grading finish, stock
opname posting, or anything that sends a WhatsApp message. Those show real
progress and a real result, because the user's next physical action depends on
the true outcome.

---

## 5. Errors that name the row and the fix

An error message has three jobs: what failed, which record, what to do next.

| Bad | Good |
|---|---|
| "Gagal menyimpan" | "PO tidak tersimpan — 2 serial ganda: `C02X1234`, `C02X9876`. Hapus atau ubah lalu simpan lagi." |
| "Terjadi kesalahan" | "Koneksi ke server terputus. Draft tersimpan otomatis. Coba lagi." |
| "Harga tidak valid" | "Harga Rp 4.200.000 di bawah COGS Rp 4.800.000. Butuh persetujuan owner." |

Rules:

- **Validate at the field, on blur, not on every keystroke.** Show the error
  under the field, keep the value, never clear the input.
- Server errors that map to a field render at that field, not in a toast.
- A form with errors scrolls to and focuses the first one.
- Errors never blame the user ("Anda salah") and never expose stack traces or
  status codes to staff — those go to the log with a request id, and the UI
  shows a short reference the operator can quote.

---

## 6. Undo over confirm

Confirmation dialogs are a tax on every correct action to prevent a rare wrong
one. Prefer undo.

| Action | Pattern |
|---|---|
| Remove cart line | Undo toast, 8 s |
| Archive SKU | Undo toast, 8 s |
| Change price | Undo toast + a `PriceLog` row either way |
| Mark comment handled | Undo toast, 8 s |
| Delete a PO draft | Confirm — it has no server record to restore |
| Checkout below COGS/margin | Confirm, with the numbers in the dialog body |
| Post stock opname | Confirm, with the variance counts in the body |
| Send a WhatsApp reply | No confirm, no undo — send is send. Make the button unambiguous instead |

When a confirm is genuinely required, its body carries **the specific numbers**,
its primary button carries **the verb** ("Posting selisih 3 unit", not "OK"),
and the destructive option is never the default focus.

Inventory is never deleted. The bulk action on selected rows is *Edit harga &
stok* and *Lihat unit* — not *Hapus*.

---

## 7. State that survives

Nothing a user typed is lost to a reload, a crash, or a wrong click.

- **Cart, PO lines and grading sessions autosave to `localStorage`** on every
  change, keyed by staff id. On mount, if a draft exists, show a quiet inline
  bar: "Draft dari 14:32 — Pulihkan / Buang." Never auto-restore silently;
  never discard silently either.
- **Filters, sort, page and open-drawer id live in the URL.** A shared link
  reproduces the exact view.
- **Scroll position is restored** on back navigation within a session.
- A background tab that reconnects refetches; it does not blow away local edits.

---

## 8. Tables — where this app lives

Most screens are a table. Get these right once, in the shared component:

- **Column widths are explicit and resizable**, persisted per user per table.
  Text truncates with an ellipsis and a title tooltip. Nothing wraps to three
  lines. Wrapping is opt-in per column, never the default.
- **Filters are multi-select by default.** "Lokasi" with three warehouses must
  be answerable as "gudang-1 OR gudang-3". Single-select is the exception and
  must be justified.
- Active filters render as removable chips above the table with a "Reset" that
  clears all. The user must be able to see, at a glance, why a row count is low.
- **Numbers are right-aligned and tabular-figure**; currency shows `Rp` once in
  the header, not on every cell.
- Sort is stable, indicated by an arrow, and multi-column with `Shift+click`.
- Selection: `Space` toggles, `Shift+click` ranges, header checkbox is
  tri-state and says what it will select ("Pilih 47 baris terlihat").
- **Bulk actions appear in a docked bar** with the count and a clear-selection
  affordance. They never appear in a menu the user must hunt for.
- Row density is a user preference (compact / normal), persisted. Warehouse
  staff want compact; the owner wants normal.
- Empty state distinguishes **no data** ("Belum ada unit — Tambah stok") from
  **no matches** ("Tidak ada yang cocok — Reset filter"). These are different
  problems with different fixes.

---

## 9. Money and numbers

- Display `Rp 4.200.000` — dot thousands separator, no decimals, non-breaking
  space after `Rp`.
- **Money inputs accept what people type**: `4200000`, `4.200.000`, `4,2jt`,
  `4200rb`. Normalize on blur and show the formatted result. Rejecting `4.200.000`
  because of dots is the kind of small cruelty that makes staff hate a tool.
- All arithmetic is `BigInt` rupiah end to end. Never `parseFloat` money.
- Negative and zero states are visually distinct (loss, free) — not just a minus
  sign in the same colour.
- Margins show **both** the rupiah and the percentage, because staff reason in
  rupiah and owners reason in percent.
- Any derived number (margin, COGS, landed cost, variance, `paidTotal`) is
  **traceable**: hovering or clicking shows the inputs that produced it. Landed
  cost in particular must show the buy price and each allocated fee — an opaque
  cost figure is an argument waiting to happen.

---

## 10. Payments

An order is paid by a **list** of payments, not by a dropdown. Cash now plus
transfer tomorrow, a DP against tempo, a refund against a return — all of it is
rows, and the UI has to make the arithmetic obvious without making the common
case slow.

- **The common case stays one keystroke.** Full amount, one method, `Enter`. The
  payment panel opens pre-filled with the outstanding balance and the last-used
  method focused. Splitting is what costs the extra interaction, not paying
  normally.
- **A running balance is always visible**: total, paid, **remaining**, in that
  order, with remaining the largest. It updates as each row is added, before any
  request is sent.
- Adding a row never re-sorts the ones above it. New rows append.
- **Overpayment is caught at the field**, naming both numbers: "Rp 5.000.000
  melebihi sisa Rp 4.200.000." Never let the server be the first to say so.
- **Tempo/cicilan need a due date**, and the field appears the moment the method
  is chosen — not in a second dialog.
- A payment is never optimistic. Money is the one place where the cashier's next
  physical action (handing over the device) depends on the true result.
- **Removing a payment on a closed order is an adjustment, not a delete.** It
  creates a reversing row and says so. The list only grows.
- Method-specific fields (transfer reference, card approval code) appear inline
  for that method only, and are optional unless the shop's own rule says
  otherwise.

---

## 11. The serial timeline

`Riwayat Serial` is the screen that justifies the whole data-model rebuild: one
scan, and a staff member holding a device knows everything that ever happened to
it. Treat it as a first-class destination, not a drawer tab.

- **Reachable from everywhere**: `⌘K` → scan, the unit drawer, an order line, a
  claim, an opname discrepancy. A serial rendered anywhere in the app is a link
  to its timeline.
- **Newest first**, one row per `UnitEvent`, each stating **what, when, who, and
  the document** — "Terjual · 12 Agu 14:32 · Rani · INV-2026-0912" where the
  document is a link.
- **Free-text notes are interleaved in the same timeline**, visually distinct
  from state changes. Staff record what they observed in their own words; the app
  must not push them toward a vocabulary it invented. No score, no criteria, no
  computed grade — that was the old grading engine and it is gone.
- **Adding a note is one keystroke (`n`) from anywhere on the screen**, saves with
  `⌘Enter`, and never blocks on choosing a tag. Photos attach by paste, drag or
  file picker.
- **Backfilled history is labelled as backfilled.** Migrated units have a
  synthesised arrival event; it says so plainly. Reconstructed history that looks
  like observed history is a lie the app tells its own staff.
- The current status and location sit at the top as a **summary derived from the
  timeline below**, so the two can never appear to disagree.
- Nothing on this screen is editable except notes. History is not a form.

---

## 12. Loading, empty and error states

Three rules that remove most of the judgement:

1. **Skeleton when you know the shape** (a table, a card grid). **Spinner when
   you don't** (a submit in flight). Never both.
2. **Never move content after it loads.** Reserve the space. Layout shift on a
   screen someone is clicking is a mis-click generator.
3. **Show stale data while refetching**, dimmed slightly, with the refresh
   indicator in the toolbar. Blanking a table the user is reading to show a
   spinner is strictly worse than showing 30-second-old numbers.

Every empty state has a next action. Every error state has a retry. No screen
ever dead-ends.

---

## 13. Chat inbox interaction

The chatbot inbox has interaction requirements the rest of the app does not:

- **The agent's answer and the staff's answer are visually distinct** and always
  labelled with who said it. A staff member must never wonder whether the
  customer already got an answer.
- New messages arrive by polling (5 s while the tab is focused, 30 s when not).
  Arrival **never** re-sorts the list under the user's cursor — new items get a
  "3 pesan baru" pill at the top that the user clicks to bring them in.
- The unanswered/`PERLU_STAF` queue is the default view, sorted oldest first —
  the oldest unanswered customer is the most urgent one.
- The staff **directive** field ("kasih diskon 200rb") is clearly marked as an
  instruction to the agent, shows who last edited it and when, and can never be
  overwritten by the agent. The database enforces this by column ownership;
  the UI must make it legible.
- The agent's rolling **summary** is read-only in the UI, timestamped, and
  labelled as machine-written. Staff must be able to tell at a glance which text
  a human wrote.
- Sending is irreversible: the send button is labelled with the destination
  (`Kirim ke +62 812…`), disabled while empty, and `⌘Enter` sends only when the
  compose box has focus.
- When credentials are missing, the UI says so explicitly — "Mode simulasi:
  balasan disimpan tapi tidak dikirim" — rather than appearing to send.

---

## 14. Accessibility, as interaction

Treated here as ergonomics rather than compliance, though it delivers both:

- Every control reachable and operable by keyboard, in visual order.
- Visible focus ring with ≥ 3:1 contrast against its background.
- Click targets ≥ 32 px on desktop, ≥ 44 px anywhere touch is expected.
- Text contrast ≥ 4.5:1; do not encode meaning in colour alone — grade badges
  carry the letter, status carries a word.
- `aria-live="polite"` for toasts, row-count changes and scan results, so a
  screen reader or a busy user gets the same confirmation.
- Respect `prefers-reduced-motion`: no non-essential animation, but keep the
  undo-toast timer visible some other way.

---

## 15. Anti-patterns — specific things the current build does

Listed so the rebuild does not reproduce them:

| Anti-pattern | Fix |
|---|---|
| Single-select column filters (Lokasi, Grade, Chip) | Multi-select with chips (§8) |
| Values wrapping to 2–3 lines in tables | Explicit widths + ellipsis + tooltip (§8) |
| Cashier selects item/variant, not serial | Serial-level picker; a `Unit` is what is sold |
| "Hapus terpilih" bulk action on inventory | Replace with *Edit harga & stok* / *Lihat unit* (§6) |
| Hardcoded spec columns (CHIP, RAM/SSD, GRADE) | Columns driven by the `CategoryAttribute` table |
| A unit's history reconstructed by hand from three logs | One `UnitEvent` timeline (§11) |
| Confirm dialogs on routine, reversible actions | Undo toasts (§6) |
| Toast fired inside a state updater | Fire in the mutation callback or an effect |
| Free-text `produk` in the trade-in modal | Dropdown from the catalog |
| Free-text `lokasi` on units | `Location` table, constrained picker |
| One payment method per order, split payments untrackable | `Payment` rows with a running balance (§10) |
| Layout chrome inherited from the component library | Own the shell (§ [01](01-conventions.md#on-the-component-library)) |

---

## 16. Per-screen checklist

No screen ships until every line is true:

- [ ] Primary key path documented in the file header, and it works end to end
- [ ] Every action reachable by keyboard; `?` lists the page's shortcuts
- [ ] Focus destinations correct for open / close / delete / error (§3)
- [ ] Filters multi-select, shown as chips, resettable, mirrored in the URL
- [ ] Table columns sized, truncating, resizable, persisted
- [ ] Loading = skeleton, no layout shift, stale-while-revalidate (§12)
- [ ] Empty and no-match states distinguished, each with a next action
- [ ] Every error names the record and the fix (§5)
- [ ] Reversible actions use undo; confirms carry real numbers (§6)
- [ ] Unsaved input survives reload (§7)
- [ ] Money formatted and input-tolerant; derived numbers traceable (§9)
- [ ] Any serial shown on the screen links to its timeline (§11)
- [ ] Focus ring visible; contrast checked; targets ≥ 32 px (§14)
- [ ] Interaction contract covered by a Testing Library test, not a snapshot

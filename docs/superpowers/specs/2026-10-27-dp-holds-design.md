# DP holds — design

Owner, 2026-10-27: *"They can make DP, they will have to DP 500k for 1 week.
The status would be sold only if paid. The payment status is manually verified
by staff (escalated). After that, back in stock."* — and, on the unpaid hold:
an unpaid booking must never take a unit off sale ("if reservation makes the
stock decrease and reduce sale, it is bad").

## Rules

- **Only a DP holds a unit.** The DP is **Rp 500.000** for **7 days**
  (`AppSetting` `sales.dpAmount` / `sales.dpDays`, owner-editable in Settings,
  defaulting to 500000 / 7).
- **Without a DP nothing is held.** A staff "hold" without DP is a note on the
  unit — it stays TERSEDIA and sellable, tagged *Reserved for Budi, not paid*;
  the till asks before selling it and leaves a task to tell that customer. The
  bot never holds (sales strategy, 2026-10-27).
- **A DP is verified by staff, never by the bot.** A customer who says they
  paid or sends a transfer proof is handed over: `Perlu verifikasi DP — Budi
  kirim bukti transfer Rp 500rb untuk Air M2 8/256`. Staff check the bank and
  record the DP on the reservation in the POS (amount, cash/transfer, date).
  Recording it is what makes the hold firm: the unit goes DIRESERVASI with the
  ledger row, held until DP date + 7 days.
- **Sold only when fully paid.** The sale is finished at the till from the
  reservation; the DP counts toward the payment automatically and the till
  asks only for the rest. Nothing reads SOLD before that.
- **After 7 days without full payment the unit is back in stock**
  automatically (the expiry pass releases the hold with its ledger row), and
  staff get a task: `Perlu putuskan DP — Budi tidak melunasi Air M2, DP Rp
  500rb: kembalikan atau hangus?` — **Refund** writes a refund (money out of
  the pot it came in), **Keep (hangus)** turns it into income ("DP hangus").
  A day before expiry the bot sends one polite reminder (same tone as the
  visit reminder) if the 24-hour/transport rule allows it.
- The bot knows the rule and says it when asked to keep a unit: *"Untuk
  amankan unitnya bisa DP Rp 500rb kak, unit kami tahan 7 hari. Setelah
  transfer, kirim buktinya ya, tim kami cek dulu 🙏"*.

## Schema (needs owner sign-off with this spec)

- `Payment.reservationId String?` (FK → Reservation, Restrict, indexed) — a DP
  is a customer payment MASUK that belongs to a reservation before any sale.
  Invariant 7 widens to allow it as the payment's one parent. At the sale the
  DP payment moves to the order (`orderId` set, `reservationId` kept for
  history — or a mirrored row; decided in the plan against invariant 7).
- `Reservation.heldUntil DateTime?` — the firm hold's end (DP date + days).
- Refund / keep reuse existing rows: a refund `Payment` KELUAR; a kept DP a
  `ManualIncome` with a new `IncomeReason` value `DP_HANGUS`.

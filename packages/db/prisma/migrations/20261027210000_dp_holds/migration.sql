-- ===========================================================================
-- A DP holds a unit (owner, 2026-10-27, "yes to DP" — docs/superpowers/specs/
-- 2026-10-27-dp-holds-design.md). Additive, except invariant 7's CHECK, which
-- is replaced by a wider one.
--
-- *"They can make DP, they will have to DP 500k for 1 week. The status would
-- be sold only if paid. The payment status is manually verified by staff.
-- After that, back in stock."* — and an unpaid hold must never take a unit
-- off sale.
--
-- 1. `Payment.reservationId` — the reservation a payment is the DP of, or the
--    refund of one. Before the sale the reservation is the DP's ONE parent;
--    at the sale the SAME row gains `orderId` and keeps `reservationId` as
--    history. One row, so the money is counted once: when it came in.
--
-- 2. `Reservation.heldUntil` — the end of a FIRM hold (DP date + the
--    `sales.dpDays` setting). Null is a hold nobody has paid for, which
--    holds nothing.
--
-- 3. Invariant 7, widened. It was "exactly one of orderId / poId /
--    customerId" (20260924160000). A payment naming a reservation may now
--    have no other parent (a DP before the sale, a refund of one) or the sale
--    alone (the DP applied); it is never a supplier's or an old debt's.
--
-- Not used, deliberately: `IncomeReason` DP_HANGUS. A kept DP is the DP
-- payment itself with its reservation closed — the money arrived once and is
-- already in the balance, so a second income row would count it twice.
-- `sales.dpAmount` / `sales.dpDays` are `AppSetting` keys; the table is
-- key/value, so they need no column.
--
-- No GRANT: both tables are granted at TABLE level, which covers a new
-- column. The worker's expiry pass runs as nusantara_agent, which reads
-- Reservation and Payment and writes Reservation, ReservationItem and the
-- ledger — and must never write money, which the check below asserts.
-- ===========================================================================

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "reservationId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "heldUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Payment_reservationId_idx" ON "Payment"("reservationId");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariant 7: with no reservation, exactly one of the three parents, as
-- before; with one, never a supplier's invoice or an old debt — the sale is
-- optional (null before it, set once the DP is applied).
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_one_parent_check";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_parent_check"
  CHECK (
    CASE WHEN "reservationId" IS NULL
      THEN num_nonnulls("orderId", "poId", "customerId") = 1
      ELSE "poId" IS NULL AND "customerId" IS NULL
    END
  );

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
  -- The till and /reservations write the DP, its refund and the hold.
  IF NOT has_column_privilege('nusantara_app', '"Payment"', 'reservationId', 'INSERT')
     OR NOT has_column_privilege('nusantara_app', '"Payment"', 'reservationId', 'UPDATE')
     OR NOT has_column_privilege('nusantara_app', '"Reservation"', 'heldUntil', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"Payment"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"Reservation"', 'DELETE') THEN
    RAISE EXCEPTION 'DP grants for nusantara_app are not what 20261027210000 says they are';
  END IF;
  -- The expiry pass reads a firm hold and releases it; the refund / keep
  -- decision is staff's, so the agent may never write a payment.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent')
     AND (NOT has_column_privilege('nusantara_agent', '"Reservation"', 'heldUntil', 'SELECT')
          OR NOT has_column_privilege('nusantara_agent', '"Payment"', 'reservationId', 'SELECT')
          OR has_table_privilege('nusantara_agent', '"Payment"', 'INSERT')
          OR has_table_privilege('nusantara_agent', '"Payment"', 'UPDATE')
          OR has_table_privilege('nusantara_agent', '"Payment"', 'DELETE')) THEN
    RAISE EXCEPTION 'DP grants for nusantara_agent are not what 20261027210000 says they are';
  END IF;
END
$check$;

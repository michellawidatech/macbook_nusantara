-- ===========================================================================
-- S2 — the constraints Prisma cannot express.
--
-- Specification: docs/rebuild/08-data-integrity.md §2, all fifteen rows.
-- Each section below names the invariant it enforces. An invariant that lives
-- only in application code is a wish.
--
-- PREREQUISITE: packages/db/prisma/roles.sql must have been run once on this
-- cluster, as a superuser. This migration deliberately RAISEs if the roles are
-- missing rather than silently skipping the grants — invariants 13 and 14 ARE
-- the grants, so a database without them has not satisfied this migration.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Invariant 10 — document codes come from the database, never from the app.
--
-- Format: SI-2026/07-000094 = the 94th sales invoice of July 2026. The counter
-- resets monthly per document type, which a single sequence cannot express, so
-- each (prefix, year, month) gets its own sequence, created on first use.
--
-- SECURITY DEFINER: the application role has no DDL rights and must not have
-- any. The function is owned by the migration role, so the app can obtain a
-- number without ever being able to create anything itself.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION next_doc_code(p_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_local timestamp := (now() AT TIME ZONE 'Asia/Jakarta');
  v_seq   text;
  v_n     bigint;
BEGIN
  -- The prefix reaches a dynamic statement, so it is validated, not trusted.
  IF p_prefix IS NULL OR p_prefix !~ '^[A-Z]{2,4}$' THEN
    RAISE EXCEPTION 'invalid document prefix: %', p_prefix
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_seq := format('doccode_%s_%s', lower(p_prefix), to_char(v_local, 'YYYY_MM'));

  BEGIN
    EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_n;
  EXCEPTION WHEN undefined_table THEN
    -- First document of this type this month. Two sessions can race here;
    -- IF NOT EXISTS plus the retry below makes either order correct.
    BEGIN
      EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', v_seq);
    EXCEPTION WHEN duplicate_table OR unique_violation THEN
      NULL;
    END;
    EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_n;
  END;

  RETURN format('%s-%s-%s',
                p_prefix,
                to_char(v_local, 'YYYY"/"MM'),
                lpad(v_n::text, 6, '0'));
END
$fn$;

COMMENT ON FUNCTION next_doc_code(text) IS
  'Invariant 10 (08 §2): monthly-reset document numbering, e.g. SI-2026/07-000094.';

-- Prefixes are the shop's own, confirmed by the owner:
--   PI inbound (purchase)   SI sales   SP supplier return   SG product change
-- SO and RV are aliases for documents the shop does not yet number by hand.
-- Shipment.code has no default on purpose: the owner does not number surat
-- jalan. TX (stock transfer) has no default either — a transfer is a
-- UnitEvent(DIPINDAH) row and the ERD gives it no code column to fill.

-- AlterTable
ALTER TABLE "OpnameSession" ALTER COLUMN "code" SET DEFAULT next_doc_code('SO'::text);

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "code" SET DEFAULT next_doc_code('SI'::text);

-- AlterTable
ALTER TABLE "PurchaseOrder" ALTER COLUMN "code" SET DEFAULT next_doc_code('PI'::text);

-- AlterTable
ALTER TABLE "Reservation" ALTER COLUMN "code" SET DEFAULT next_doc_code('RV'::text);

-- AlterTable
ALTER TABLE "SupplierReturn" ALTER COLUMN "code" SET DEFAULT next_doc_code('SP'::text);

-- AlterTable
ALTER TABLE "WarrantyClaim" ALTER COLUMN "code" SET DEFAULT next_doc_code('SG'::text);


-- ---------------------------------------------------------------------------
-- Invariant 3 — a unit is sold at most once at a time.
--
-- Partial unique index. A returned line releases the unit (returnedAt set), so
-- the same serial can legitimately appear on a later order. NULL unitId rows
-- (non-serialised lines) never conflict: btree treats NULLs as distinct.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "OrderItem_unitId_unreturned_key"
  ON "OrderItem" ("unitId")
  WHERE "returnedAt" IS NULL;


-- ---------------------------------------------------------------------------
-- Invariant 5 — order arithmetic. The client's total is never trusted.
-- ---------------------------------------------------------------------------

ALTER TABLE "Order" ADD CONSTRAINT "Order_total_arithmetic_check"
  CHECK ("total" = "subtotal" - "discount" + "extra");


-- ---------------------------------------------------------------------------
-- Invariant 7 — a payment belongs to exactly one parent.
-- ---------------------------------------------------------------------------

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_parent_check"
  CHECK (("orderId" IS NULL) <> ("poId" IS NULL));


-- ---------------------------------------------------------------------------
-- Invariants 6 and 8 — money is never negative where it cannot be.
--
-- Deliberately NOT constrained:
--   PettyCashEntry.amount  the ERD marks it signed
--   Shift.variance         a till can be short
--   Order.extra            an "extra" line may be a negative adjustment
-- ---------------------------------------------------------------------------

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_qty_positive_check"
  CHECK ("qty" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_price_nonneg_check"
  CHECK ("price" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sub_nonneg_check"
  CHECK ("sub" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_cogs_nonneg_check"
  CHECK ("cogs" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_returnedQty_range_check"
  CHECK ("returnedQty" >= 0 AND "returnedQty" <= "qty");

ALTER TABLE "Order" ADD CONSTRAINT "Order_money_nonneg_check"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0
     AND "paidTotal" >= 0 AND "cogs" >= 0 AND "tradeCredit" >= 0);

ALTER TABLE "Sku" ADD CONSTRAINT "Sku_money_nonneg_check"
  CHECK ("price" >= 0 AND "landed" >= 0);

ALTER TABLE "Unit" ADD CONSTRAINT "Unit_money_nonneg_check"
  CHECK ("buy" >= 0 AND "landed" >= 0);
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_version_positive_check"
  CHECK ("version" > 0);

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_money_nonneg_check"
  CHECK ("subtotal" >= 0 AND "feesTotal" >= 0 AND "total" >= 0 AND "feesTaxPct" >= 0);

ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_qty_positive_check"
  CHECK ("qty" > 0);
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_money_nonneg_check"
  CHECK ("unitCost" >= 0 AND "lineTotal" >= 0 AND "allocatedFee" >= 0);

ALTER TABLE "PurchaseOrderFee" ADD CONSTRAINT "PurchaseOrderFee_amount_nonneg_check"
  CHECK ("amount" >= 0);

ALTER TABLE "PurchaseOrderPackage" ADD CONSTRAINT "PurchaseOrderPackage_qty_positive_check"
  CHECK ("qty" > 0);
ALTER TABLE "PurchaseOrderPackage" ADD CONSTRAINT "PurchaseOrderPackage_weight_positive_check"
  CHECK ("weightGram" IS NULL OR "weightGram" > 0);

ALTER TABLE "SupplierReturnItem" ADD CONSTRAINT "SupplierReturnItem_amount_nonneg_check"
  CHECK ("amount" >= 0);

ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_value_nonneg_check"
  CHECK ("value" >= 0);

ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_amount_nonneg_check"
  CHECK ("amount" >= 0);

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_cost_nonneg_check"
  CHECK ("cost" >= 0);
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_qty_positive_check"
  CHECK ("qty" > 0);

ALTER TABLE "ReservationItem" ADD CONSTRAINT "ReservationItem_qty_positive_check"
  CHECK ("qty" > 0);

ALTER TABLE "Category" ADD CONSTRAINT "Category_margin_range_check"
  CHECK ("marginMin" >= 0 AND "marginMax" >= 0 AND "marginMin" <= "marginMax");

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_money_nonneg_check"
  CHECK ("openFloat" >= 0 AND "expected" >= 0 AND "declared" >= 0);

ALTER TABLE "FinSettings" ADD CONSTRAINT "FinSettings_money_nonneg_check"
  CHECK ("cash" >= 0 AND "equipment" >= 0);

ALTER TABLE "PettyCash" ADD CONSTRAINT "PettyCash_opening_nonneg_check"
  CHECK ("opening" >= 0);

ALTER TABLE "OpexItem" ADD CONSTRAINT "OpexItem_amount_nonneg_check"
  CHECK ("amount" >= 0);

ALTER TABLE "PriceLog" ADD CONSTRAINT "PriceLog_money_nonneg_check"
  CHECK ("before" >= 0 AND "after" >= 0);

ALTER TABLE "PriceReq" ADD CONSTRAINT "PriceReq_money_nonneg_check"
  CHECK ("before" >= 0 AND "after" >= 0);

ALTER TABLE "DailyQuota" ADD CONSTRAINT "DailyQuota_count_nonneg_check"
  CHECK ("count" >= 0);

ALTER TABLE "AgentCache" ADD CONSTRAINT "AgentCache_hits_nonneg_check"
  CHECK ("hits" >= 0);


-- ---------------------------------------------------------------------------
-- Invariant 2 — the ledger is ordered. seq is assigned MAX(seq)+1 under the
-- unit's row lock (S4); the database guarantees it is at least well-formed.
-- ---------------------------------------------------------------------------

ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_seq_positive_check"
  CHECK ("seq" > 0);


-- ---------------------------------------------------------------------------
-- Invariant 9 — a discount cannot be used past its limit.
--
-- The live mechanism is `UPDATE … SET used = used + 1 WHERE used < usageLimit`
-- (the WHERE is the lock). This CHECK is the backstop that makes a bug in that
-- statement a loud error instead of a quiet over-issue.
-- ---------------------------------------------------------------------------

ALTER TABLE "Discount" ADD CONSTRAINT "Discount_within_usage_limit_check"
  CHECK ("usageLimit" IS NULL OR "used" <= "usageLimit");
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_used_nonneg_check"
  CHECK ("used" >= 0 AND ("usageLimit" IS NULL OR "usageLimit" > 0));
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_pct_range_check"
  CHECK ("pct" >= 0 AND "pct" <= 100);
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_rp_nonneg_check"
  CHECK (("maxRp" IS NULL OR "maxRp" >= 0) AND ("minRp" IS NULL OR "minRp" >= 0));


-- ---------------------------------------------------------------------------
-- Invariants 13 and 14 — privileges.
--
-- 14: the app role may INSERT into AuditLog and UnitEvent and nothing else.
--     This is the difference between "we don't delete audit rows" and
--     "we can't" (08 §9).
-- 13: two writers share WaThreadMemory with disjoint column sets (08 §7).
--     Column-level UPDATE is what makes "the agent can never overwrite a staff
--     directive" structural rather than conventional.
-- ---------------------------------------------------------------------------

DO $grants$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ')
    INTO v_missing
    FROM unnest(ARRAY['nusantara_app', 'nusantara_agent', 'nusantara_readonly']) AS r
   WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'missing database role(s): %. Run packages/db/prisma/roles.sql as a superuser first — invariants 13 and 14 are these grants.',
      v_missing;
  END IF;
END
$grants$;

GRANT USAGE ON SCHEMA public TO nusantara_app, nusantara_agent, nusantara_readonly;

-- Business tables: read and write, never delete.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public
  TO nusantara_app, nusantara_agent;
GRANT SELECT ON ALL TABLES IN SCHEMA public
  TO nusantara_readonly;

-- No DELETE was granted above; say so explicitly so a future reader cannot
-- mistake the omission for an oversight.
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
  FROM nusantara_app, nusantara_agent, nusantara_readonly;

-- Invariant 14: append-only. INSERT and SELECT only, for every writer.
REVOKE UPDATE ON "AuditLog", "UnitEvent"
  FROM nusantara_app, nusantara_agent;

-- Invariant 13: disjoint column ownership on WaThreadMemory.
REVOKE UPDATE ON "WaThreadMemory" FROM nusantara_app, nusantara_agent;

-- POS staff own the directive. They cannot touch a summary.
GRANT UPDATE ("directive", "directiveAt", "directiveById", "updatedAt")
  ON "WaThreadMemory" TO nusantara_app;

-- The webhook summarizer owns the summary, what it has covered, and the
-- clarification counters. It cannot touch a directive.
GRANT UPDATE ("summary", "summaryAt", "summaryTurns",
              "coveredThroughAt", "coveredThroughId",
              "clarifyCount", "clarifyAt", "customerId", "updatedAt")
  ON "WaThreadMemory" TO nusantara_agent;

-- Document numbering is reachable by the writers, and by nobody else.
REVOKE ALL ON FUNCTION next_doc_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_doc_code(text)
  TO nusantara_app, nusantara_agent;

-- Reporting stays readable as the schema grows. Read-only privileges are the
-- only ones safe to hand out by default: a future append-only table must not
-- silently inherit UPDATE, so app/agent grants stay explicit, per migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO nusantara_readonly;

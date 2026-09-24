-- A counted product can go back to its supplier (owner ask 2026-09-19:
-- "the accessories has to be able to be returned for supplier").
--
-- A move, not a document (owner decision the same day): the pieces leave on
-- the stock ledger with the SP code in "refCode", the reason in "reasonId",
-- and the invoice they came in on in "purchaseOrderId" — which is what names
-- the supplier. No supplier column and no expected credit: a unit's supplier
-- return is a `UnitReturn`, and this deliberately is not one.
--
-- Additive: one enum value, no row changes. The release before this one never
-- writes it and reads the column as text only through Prisma's enum, which is
-- why this ships before anything that writes the value.

ALTER TYPE "StockMoveType" ADD VALUE 'RETUR_SUPPLIER';

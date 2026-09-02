-- Inbound & QC, revised 2026-08-27. Four changes, all of them owner decisions
-- made while working the intake screen, and all of them things the web build
-- had been carrying in its mock store with no column behind them.
--
-- 1. An invoice can be CLOSED.
-- 2. A supplier payment says which part of the bill it settles.
-- 3. QC descriptions come from a vocabulary the shop grows itself.
-- 4. A QC decision can be taken back, and the ledger says so.

-- ── 1. Closing a purchase invoice ───────────────────────────────────────────
--
-- Separate from `status`, which is about the GOODS. An order can be fully
-- received and still open because the ongkir has not been settled, and it can
-- be closed with a line the supplier never sent. Nullable rather than a
-- POStatus member for exactly that reason: closing is orthogonal to how far
-- the goods have got, and folding it into the status enum would make every
-- closed order forget whether it had arrived.
--
-- Reversible on purpose — reopening sets this back to NULL. It is a filing
-- decision, not a state change, and an intake screen must never make a mistake
-- permanent.

ALTER TABLE "PurchaseOrder" ADD COLUMN "closedAt" TIMESTAMP(3);

-- ── 2. What a payment settles ───────────────────────────────────────────────
--
-- Shipping is usually a different party from the supplier — a forwarder paid
-- on its own day — and tax is a third. One undifferentiated "paid" figure
-- could not answer the only question the Purchase card is ever asked, which is
-- whether the ongkir has been settled.
--
-- NOT NULL with a default rather than nullable, because there is no such thing
-- as a payment that settles nothing. BARANG is the honest reading of every row
-- that already exists rather than a placeholder: shipping and tax were
-- separate figures on an order long before anyone could pay them separately,
-- so a transfer recorded before today was against the goods. Sale-side
-- payments are BARANG too — the buckets only differ on the supplier side.

CREATE TYPE "PayTarget" AS ENUM ('BARANG', 'ONGKIR', 'PAJAK');

ALTER TABLE "Payment"
  ADD COLUMN "appliedTo" "PayTarget" NOT NULL DEFAULT 'BARANG';

-- ── 3. The QC description vocabulary ────────────────────────────────────────
--
-- Three people typing the same six phrases all day spelled them six ways —
-- "fullset dus", "Fullset Dus", "fullset, dus lengkap" — which reads fine and
-- searches terribly. The Description field picks from this list and anything
-- typed that is not on it JOINS it, so the vocabulary is the staff's own
-- rather than one somebody guessed in advance.
--
-- No foreign key points here, and that is deliberate rather than a breach of
-- 01 §6. `Unit.description` is free text and has to stay free text: a machine
-- turns up with a mark nobody has seen before and the person grading it has to
-- be able to say so. This is the suggestion list that field offers, joined by
-- the application with ", " into the sentence the column stores.
--
-- `label` is UNIQUE, which is what stops the six spellings coming back. The
-- application matches case-insensitively before inserting; the constraint is
-- the backstop under that, not the whole of it.

CREATE TABLE "QcDescription" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QcDescription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QcDescription_label_key" ON "QcDescription"("label");

-- The shop's own words, seeded so the field is useful on the first machine
-- somebody grades rather than on the twentieth. One fact per row and no commas
-- in any of them — a description is a LIST of these, so a phrase carrying its
-- own comma would come back as two.
INSERT INTO "QcDescription" ("id", "label", "sortOrder", "createdAt") VALUES
    ('qcd_mulus',      'Mulus',                 1,  NOW()),
    ('qcd_normal',     'Normal',                2,  NOW()),
    ('qcd_lecethalus', 'Lecet halus',           3,  NOW()),
    ('qcd_lecetbawah', 'Lecet di casing bawah', 4,  NOW()),
    ('qcd_dentsudut',  'Dent di sudut',         5,  NOW()),
    ('qcd_layargaris', 'Layar ada garis',       6,  NOW()),
    ('qcd_keyboardaus','Keyboard aus',          7,  NOW()),
    ('qcd_baterailemah','Baterai lemah',        8,  NOW()),
    ('qcd_engsel',     'Engsel longgar',        9,  NOW()),
    ('qcd_gantissd',   'Sudah ganti SSD',       10, NOW()),
    ('qcd_fullset',    'Fullset dus',           11, NOW()),
    ('qcd_chargerori', 'Charger original',      12, NOW()),
    ('qcd_unitonly',   'Unit only',             13, NOW()),
    ('qcd_tanpacharger','Tanpa charger',        14, NOW());

-- The same three grants every table in this database carries. A table the
-- application role cannot read is a table the application does not have, and
-- `prisma migrate` creates tables owned by the migration role with no grants
-- at all — so a table without these lines is a table that works for exactly
-- one connection string.
GRANT SELECT, INSERT, UPDATE ON "QcDescription" TO "nusantara_app";
GRANT SELECT ON "QcDescription" TO "nusantara_readonly";
GRANT SELECT ON "QcDescription" TO "nusantara_agent";

-- ── 4. Taking a QC decision back ────────────────────────────────────────────
--
-- Staff accept the wrong machine into stock, or send the wrong one back to the
-- supplier. Until now the only remedy was a stock adjustment, which files the
-- correction as a different KIND of event from the mistake and leaves the
-- timeline reading "arrived, passed QC, mysteriously adjusted out".
--
-- Its own event type rather than KOREKSI, for two reasons. A timeline reading
-- "Adjustment" does not tell the next person what happened; and KOREKSI
-- already has an arrow out of both QC and TERSEDIA — to KOREKSI_KELUAR — so a
-- second meaning for the same (from, type) pair would make the state machine's
-- `statusAfter` ambiguous about where the unit lands.
--
-- The arrows this enables live in packages/domain/src/unitState.ts:
--   TERSEDIA       --QC_DIBUKA--> QC
--   RETUR_SUPPLIER --QC_DIBUKA--> QC
-- and RETUR_SUPPLIER stops being terminal to allow the second one. Nothing is
-- rewritten by either: the QC_SELESAI or RETUR_SUPPLIER that was wrong stays on
-- the ledger, because it was really recorded and somebody may need to know it
-- was.

ALTER TYPE "UnitEventType" ADD VALUE 'QC_DIBUKA' AFTER 'KOREKSI';

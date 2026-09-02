-- Reservations, step 1 of the POS backend migration (owner decisions 2026-08-28).
--
-- Two additions, both of which the mock has been carrying in the browser:
--
--  1. `ReservationSource` — the channel a hold came in over. The mock's
--     `db.reservationSources` had no home in the schema at all: `Reservation.source`
--     is `ResSource` (STAF | AGEN), which answers "person or bot", an entirely
--     different question. Deliberately NOT `ReferralSource` either — that one
--     answers "which ad drove this", and "Walk-in" is never an answer to it.
--
--  2. `UnitEvent.reservationId` — which hold a DIRESERVASI or RESERVASI_BATAL
--     event belongs to. Without it the S/N timeline re-joins by serial and takes
--     the first match, so a machine held, released, then held again by a different
--     customer narrates the wrong person on both events. It is also what lets a
--     release know it is releasing its OWN hold's unit rather than one some other
--     hold has since taken.

CREATE TABLE "ReservationSource" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReservationSource_name_key" ON "ReservationSource"("name");

-- The shop's six, with the ids the mock already used so seeded fixtures and the
-- web tests keep resolving across the cutover.
INSERT INTO "ReservationSource" ("id", "name", "sortOrder", "createdAt") VALUES
    ('rsv-src-ig',        'Instagram', 1, NOW()),
    ('rsv-src-wa',        'WhatsApp',  2, NOW()),
    ('rsv-src-tiktok',    'TikTok',    3, NOW()),
    ('rsv-src-shopee',    'Shopee',    4, NOW()),
    ('rsv-src-tokopedia', 'Tokopedia', 5, NOW()),
    ('rsv-src-walkin',    'Walk-in',   6, NOW());

ALTER TABLE "Reservation" ADD COLUMN "reservationSourceId" TEXT;

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_reservationSourceId_fkey"
    FOREIGN KEY ("reservationSourceId") REFERENCES "ReservationSource"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UnitEvent" ADD COLUMN "reservationId" TEXT;

ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- `Reservation` has carried exactly one index since the first migration (the
-- unique on `code`) and `ReservationItem` had none at all, not even on its FK —
-- Prisma does not index foreign keys on Postgres. Every hold read traverses
-- items, and the agent's duplicate guard hits (phone, status) on every booking.
CREATE INDEX "Reservation_reservationSourceId_idx" ON "Reservation"("reservationSourceId");
CREATE INDEX "Reservation_phone_status_idx"        ON "Reservation"("phone", "status");
CREATE INDEX "ReservationItem_reservationId_idx"   ON "ReservationItem"("reservationId");
CREATE INDEX "UnitEvent_reservationId_idx"         ON "UnitEvent"("reservationId");

-- 08 §9: the app writes and edits the channel list; the agent and the reporting
-- role only read it. DELETE stays revoked — a channel is switched off, never
-- removed, because holds point at it.
GRANT SELECT, INSERT, UPDATE ON "ReservationSource" TO nusantara_app;
GRANT SELECT ON "ReservationSource" TO nusantara_agent;
GRANT SELECT ON "ReservationSource" TO nusantara_readonly;

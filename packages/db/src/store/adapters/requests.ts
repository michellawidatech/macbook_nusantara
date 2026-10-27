/**
 * The bot's reservation REQUESTS (2026-10-27) — `ReservationProposal` rows,
 * projected read-only. Staff approve or reject one through
 * `/api/reservations/requests` (packages/db `reservationRequests.ts`), which
 * books the reservation in the same transaction; a commit never writes one.
 *
 * Two facts are derived here because the browser cannot see what they are
 * derived from:
 *
 * - `replaced` — the customer asked again before anybody answered. The bot
 *   cancels the earlier request at the very instant it files the newer one,
 *   so a `cancelledAt` equal to a later request's `createdAt` on the same
 *   thread is a replacement, and any other `cancelledAt` is a person's no.
 * - `dpProofAt` — the thread has a `Perlu verifikasi DP` task raised or
 *   refreshed since the request was filed: the customer says they paid.
 */
import { DP_PROOF_PREFIX } from "../../reservationRequests.js";
import { type Adapter, isoOf, optionalIso } from "../context.js";
import { StoreValidationError } from "../errors.js";

const readOnly = async () => {
  throw new StoreValidationError(
    "Permintaan reservasi hanya diubah lewat Setujui / Tolak.",
  );
};

export const reservationRequests: Adapter<"reservationRequests"> = {
  collection: "reservationRequests",
  async project(tx, _ctx, keys) {
    const rows = await tx.reservationProposal.findMany({
      where: keys === undefined ? {} : { id: { in: [...keys] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        items: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { unit: { select: { serial: true } } },
        },
      },
    });
    if (rows.length === 0) return [];
    const froms = [...new Set(rows.map((r) => r.from))];
    const [siblings, proofs] = await Promise.all([
      tx.reservationProposal.findMany({
        where: { from: { in: froms } },
        select: { from: true, createdAt: true },
      }),
      tx.chatAction.findMany({
        where: {
          from: { in: froms },
          summary: { startsWith: DP_PROOF_PREFIX },
        },
        select: { from: true, updatedAt: true },
      }),
    ]);
    const filedAt = new Set(
      siblings.map((s) => `${s.from}|${s.createdAt.getTime()}`),
    );
    return rows.map((r) => {
      const proof = proofs
        .filter(
          (p) =>
            p.from === r.from && p.updatedAt.getTime() >= r.createdAt.getTime(),
        )
        .map((p) => p.updatedAt.getTime())
        .sort((a, b) => a - b)[0];
      return {
        id: r.id,
        phone: r.from,
        custName: r.custName,
        when: isoOf(r.scheduledFor),
        createdAt: isoOf(r.createdAt),
        expiresAt: isoOf(r.expiresAt),
        confirmedAt: optionalIso(r.confirmedAt),
        cancelledAt: optionalIso(r.cancelledAt),
        replaced:
          r.cancelledAt !== null &&
          filedAt.has(`${r.from}|${r.cancelledAt.getTime()}`),
        reservationId: r.reservationId ?? undefined,
        items: r.items.map((i) => ({ id: i.id, serial: i.unit.serial })),
        dpProofAt: proof === undefined ? undefined : isoOf(new Date(proof)),
      };
    });
  },
  lock: async () => undefined,
  write: readOnly,
};

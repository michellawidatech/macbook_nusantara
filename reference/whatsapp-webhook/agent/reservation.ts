/**
 * Reservation write path for the conversational agent — the bot's one
 * write-access action. Mirrors the load-bearing rules of the POS route
 * (`apps/api/src/routes/penjualan.ts` → POST /reservasi/save):
 *
 *   resolve the SKU → hold ONE available unit (TERSEDIA → DIRESERVASI) →
 *   create a Reservation (code `RSV-<base36>`, status TERJADWAL).
 *
 * Everything runs in a single `prisma.$transaction` so a unit is never held
 * without a reservation row (or vice-versa). The customer's phone comes from the
 * WhatsApp sender (never the model), and we upsert a `Customer` by phone so
 * repeat customers accrue a durable per-phone profile.
 *
 * The resolution is deliberately STRICT: it proceeds only when the product
 * narrows to exactly one available SKU. Anything ambiguous returns `candidates`
 * so the agent asks which variant — we must not hold the wrong unit.
 */

import { prisma, type Grade, type Prisma } from "@nusantara/db";
import { formatRp, type Money } from "@nusantara/domain";
import { skuWhere } from "./catalog.js";
import { resolveDate } from "./clock.js";

/** Conversation context threaded from the pipeline (sender identity). */
export interface ReservationCtx {
  /** WhatsApp sender id (phone). Authoritative — never taken from the model. */
  from: string;
  /** Profile name from the webhook, if any. */
  name?: string | null;
}

/** Model-supplied reservation arguments (phone is NOT here — it's in ctx). */
export interface ReservationArgs {
  product?: string;
  chip?: string;
  storage?: string;
  grade?: string;
  custName?: string;
  /** Preferred YYYY-MM-DD; relative words ("besok") are resolved, see ./clock.ts. */
  date?: string;
  time?: string;
  email?: string;
  note?: string;
}

/** Outcome of a reservation attempt — a JSON-safe object for the agent to phrase. */
export type ReservationResult =
  | { ok: true; code: string; model: string; variant: string; whenText: string; date: string; time?: string }
  | { needProduct: true }
  | { needName: true }
  | { needDate: true }
  | { ambiguous: true; candidates: string[] }
  | { unavailable: true; product: string; note?: string; alternatives?: string[] }
  | { error: string };

/**
 * What the agent is told when nothing matched. It once turned an empty result
 * into "unit-nya baru sold tadi" — a reason the tool never gave it — so the
 * result now says outright that the reason is unknown, and carries real
 * alternatives so there is nothing left to invent.
 */
const UNAVAILABLE_NOTE =
  "Tidak ada unit tersedia yang cocok dengan kriteria ini. Kamu TIDAK tahu kenapa, " +
  "jangan bilang 'baru sold', 'baru habis', atau 'baru diambil orang'. Bilang saja belum " +
  "ketemu unit yang cocok, lalu tawarkan alternatif di bawah kalau ada.";

const variantLabel = (s: { chip: string | null; storage: string | null; grade: Grade }): string =>
  [s.chip, s.storage, `Grade ${s.grade}`].filter(Boolean).join(" ");

/** A SKU as far as {@link optionLabel} needs it. */
type OptionSku = {
  name: string;
  price: Money;
  chip: string | null;
  storage: string | null;
  grade: Grade;
  model?: { name: string } | null;
};

/**
 * One option as the agent should SAY it: `MacBook Air 13" M2 256GB Grade A,
 * harganya Rp 15.000.000`. Candidates and alternatives are quoted almost
 * verbatim into the reply, so they carry no dashes, middle dots, or parentheses
 * (see `AGENT_PERSONA`).
 */
const optionLabel = (s: OptionSku): string =>
  `${s.model?.name ?? s.name} ${variantLabel(s)}, harganya ${formatRp(s.price)}`;

/**
 * Available units of the same model when the exact variant didn't match — the
 * agent gets real options to offer instead of improvising a consolation. Drops
 * capacity and grade but keeps the model name and chip (see `relaxed` in
 * ./catalog.ts).
 */
async function nearbyAvailable(args: ReservationArgs): Promise<string[]> {
  const skus = await prisma.sku.findMany({
    where: { ...skuWhere(args, true), units: { some: { status: "TERSEDIA" } } },
    include: { model: { select: { name: true } } },
    orderBy: [{ price: "asc" }],
    take: 5,
  });
  return skus.map(optionLabel);
}

/** Indonesian day/date label for a YYYY-MM-DD string; echoes the input if unparseable. */
function fmtWhenText(date: string): string {
  const d = new Date(date + "T00:00:00");
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" });
}

/**
 * Create a reservation and hold one available unit. Never throws — validation
 * and not-found paths return a structured result the agent turns into a reply.
 */
export async function createReservation(
  ctx: ReservationCtx,
  args: ReservationArgs,
): Promise<ReservationResult> {
  const product = args.product?.trim();
  // Fall back to the WhatsApp profile name — we already know who this is, so a
  // booking never stalls on a name (the agent still confirms it in its reply).
  const custName = args.custName?.trim() || ctx.name?.trim();
  // The agent is given today's date in its system prompt, but a relative word
  // ("besok") must never land in the row: resolve it here, and treat anything
  // unrecognizable as missing so the agent asks instead of storing free text.
  const date = resolveDate(args.date);
  if (!product) return { needProduct: true };
  if (!custName) return { needName: true };
  if (!date) return { needDate: true };

  // Candidate SKUs: the SAME matcher the stock/price tools use (./catalog.ts),
  // narrowed to SKUs with at least one available unit. Sharing it is the whole
  // point — the bot used to quote "stok 4 unit" from one filter and then fail to
  // book it with another. Live query, so stock is never stale.
  const skus = await prisma.sku.findMany({
    where: { ...skuWhere(args), units: { some: { status: "TERSEDIA" } } },
    include: { model: { select: { name: true } } },
    orderBy: [{ price: "asc" }],
    take: 25,
  });

  if (skus.length === 0) {
    const alternatives = await nearbyAvailable(args);
    return {
      unavailable: true,
      product,
      note: UNAVAILABLE_NOTE,
      ...(alternatives.length ? { alternatives } : {}),
    };
  }
  if (skus.length > 1) {
    // Ambiguous — more than one available variant. Ask which one rather than
    // guessing and holding the wrong unit.
    const candidates = skus.map(optionLabel);
    return { ambiguous: true, candidates };
  }

  const sku = skus[0]!;
  const model = sku.model?.name ?? sku.name;
  const variant = variantLabel(sku);
  const code = `RSV-${Date.now().toString(36).toUpperCase()}`;
  const whenText = fmtWhenText(date);
  const email = args.email?.trim() || null;
  const note = args.note?.trim() || null;
  const time = args.time?.trim() || null;

  try {
    await prisma.$transaction(async (tx) => {
      // Claim one available unit inside the transaction (guards against a race
      // with another reservation / a sale grabbing the last unit).
      const unit = await tx.unit.findFirst({
        where: { skuId: sku.id, status: "TERSEDIA" },
        select: { id: true, lokasi: true },
      });
      if (!unit) throw new UnavailableError();
      await tx.unit.update({ where: { id: unit.id }, data: { status: "DIRESERVASI" } });

      // Durable per-phone profile: link/refresh the customer by their WA number.
      const customer = await tx.customer.upsert({
        where: { phone: ctx.from },
        update: { name: custName, ...(email ? { email } : {}) },
        create: { phone: ctx.from, name: custName, ...(email ? { email } : {}) },
        select: { id: true },
      });

      const items = [
        { unit: model, variant, lokasi: unit.lokasi ?? sku.lokasi ?? null, skuId: sku.id, unitId: unit.id },
      ];
      await tx.reservation.create({
        data: {
          code,
          customerId: customer.id,
          custName,
          phone: ctx.from,
          email,
          date,
          time,
          whenText,
          note,
          status: "TERJADWAL",
          items: items as unknown as Prisma.InputJsonValue,
        },
      });
    });
  } catch (err) {
    // This one IS a genuine race: the outer query saw stock, then the last unit
    // went inside the transaction. Here "baru diambil" is true, so say so.
    if (err instanceof UnavailableError)
      return {
        unavailable: true,
        product,
        note: "Unit terakhir baru saja diambil transaksi lain, tepat saat reservasi dibuat.",
        ...(await nearbyAvailable(args).then((a) => (a.length ? { alternatives: a } : {}))),
      };
    console.error("[webhook] createReservation failed:", err);
    return { error: "Gagal menyimpan reservasi. Coba lagi sebentar ya." };
  }

  return { ok: true, code, model, variant, whenText, date, ...(time ? { time } : {}) };
}

/** Internal signal: the last available unit was taken before we could hold it. */
class UnavailableError extends Error {}

/** Model-supplied cancel argument (phone comes from ctx, never the model). */
export interface CancelArgs {
  /** Reservation code (RSV-XXXX) the customer wants to cancel, if they gave one. */
  code?: string;
}

/** Outcome of a cancel attempt — JSON-safe for the agent to phrase. */
export type CancelResult =
  | { ok: true; code: string }
  | { none: true }
  | { notFound: true; code: string }
  | { ambiguous: true; codes: string[] }
  | { error: string };

/**
 * Cancel one of the SENDER's own scheduled reservations (TERJADWAL → BATAL) and
 * release the held unit (DIRESERVASI → TERSEDIA), mirroring the POS "Batal"
 * action. Scoped strictly to `ctx.from`, so the bot can only touch reservations
 * belonging to this WhatsApp number. It never marks a reservation SELESAI — that
 * stays a staff-only action. Never throws.
 */
export async function cancelReservation(
  ctx: ReservationCtx,
  args: CancelArgs,
): Promise<CancelResult> {
  const code = args.code?.trim();
  const active = await prisma.reservation.findMany({
    where: { phone: ctx.from, status: "TERJADWAL" },
    orderBy: { createdAt: "desc" },
    select: { id: true, code: true, items: true },
  });
  if (active.length === 0) return { none: true };

  let target: (typeof active)[number] | undefined;
  if (code) {
    target = active.find((r) => (r.code ?? "").toUpperCase() === code.toUpperCase());
    if (!target) return { notFound: true, code };
  } else if (active.length === 1) {
    target = active[0]!;
  } else {
    return { ambiguous: true, codes: active.map((r) => r.code ?? "").filter(Boolean) };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const unitIds = ((target!.items as Array<{ unitId?: string }>) ?? [])
        .map((i) => i.unitId)
        .filter((id): id is string => !!id);
      if (unitIds.length)
        await tx.unit.updateMany({
          where: { id: { in: unitIds }, status: "DIRESERVASI" },
          data: { status: "TERSEDIA" },
        });
      await tx.reservation.update({ where: { id: target!.id }, data: { status: "BATAL" } });
    });
  } catch (err) {
    console.error("[webhook] cancelReservation failed:", err);
    return { error: "Gagal membatalkan reservasi. Coba lagi sebentar ya." };
  }
  return { ok: true, code: target.code ?? "" };
}

/**
 * List a sender's reservations (newest first) — a read tool so "cek reservasi
 * saya" works, keyed on the WhatsApp phone. JSON-safe.
 */
export async function listReservations(ctx: ReservationCtx): Promise<object> {
  const rows = await prisma.reservation.findMany({
    where: { phone: ctx.from },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { code: true, whenText: true, date: true, time: true, status: true, items: true },
  });
  const reservations = rows.map((r) => ({
    code: r.code,
    when: [r.whenText ?? r.date, r.time].filter(Boolean).join(" "),
    status: r.status,
    units: ((r.items as Array<{ unit?: string; variant?: string }>) ?? []).map((i) =>
      [i.unit, i.variant].filter(Boolean).join(" "),
    ),
  }));
  return { reservations };
}

/**
 * The parts of the store that are not lists, and the collections carried
 * read-only.
 *
 * - `settings` is key/value rows in `AppSetting` — the table was made for
 *   exactly this (schema.prisma), so the keys are dotted and namespaced and
 *   the values are text the reader parses. The marketplace fees are one key
 *   per channel rather than one key holding a map: a JSON document in a text
 *   column would be a JSON column by another name.
 * - `appleDbHidden` is `AppleDbHiddenModel`. Unhiding keeps the row.
 * - `myWarehouseId` belongs to the signed-in person: `Staff.defaultLocationId`.
 * - `personas`, `activePersonaId` and `corrections` are read from the chatbot's
 *   own tables; `/chat` edits them through `/api/chat`. `chats` is always
 *   empty — the inbox reads `/api/inbox`.
 */
import type { Tx } from "../../client.js";
import { StoreValidationError } from "../errors.js";
import {
  type Adapter,
  type ProjectContext,
  type SingletonOf,
  type WriteContext,
  isoOf,
} from "../context.js";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTING_KEYS = {
  batteryGoodMin: "battery.goodMin",
  batteryFairMin: "battery.fairMin",
  cycleGoodMax: "battery.cycleGoodMax",
  cycleFairMax: "battery.cycleFairMax",
  marketplaceMarkupPct: "marketplace.markupPct",
  openingCash: "finance.openingCash",
  openingBank: "finance.openingBank",
  openingBalanceAt: "finance.openingBalanceAt",
  booksClosedAt: "finance.booksClosedAt",
  shopName: "shop.name",
  shopTagline: "shop.tagline",
  shopAddress: "shop.address",
  shopContact: "shop.contact",
} as const;

const FEE_PREFIX = "marketplace.fee.";

type Settings = SingletonOf<"settings">;

export async function projectSettings(tx: Tx): Promise<Settings> {
  const rows = await tx.appSetting.findMany();
  const values = new Map(rows.map((r) => [r.key, r.value]));
  const num = (key: string): number | undefined => {
    const v = values.get(key)?.trim();
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const money = (key: string): bigint | undefined => {
    const v = values.get(key)?.trim();
    return v === undefined || !/^-?\d+$/.test(v) ? undefined : BigInt(v);
  };
  const text = (key: string): string | undefined => {
    const v = values.get(key);
    return v === undefined || v === "" ? undefined : v;
  };
  const fees: Record<string, number> = {};
  for (const r of rows) {
    if (!r.key.startsWith(FEE_PREFIX) || r.value.trim() === "") continue;
    const n = Number(r.value);
    if (Number.isFinite(n)) fees[r.key.slice(FEE_PREFIX.length)] = n;
  }
  return {
    batteryGoodMin: num(SETTING_KEYS.batteryGoodMin) ?? 80,
    batteryFairMin: num(SETTING_KEYS.batteryFairMin) ?? 76,
    cycleGoodMax: num(SETTING_KEYS.cycleGoodMax),
    cycleFairMax: num(SETTING_KEYS.cycleFairMax),
    marketplaceMarkupPct: num(SETTING_KEYS.marketplaceMarkupPct),
    marketplaceFees: Object.keys(fees).length === 0 ? undefined : fees,
    openingCash: money(SETTING_KEYS.openingCash),
    openingBank: money(SETTING_KEYS.openingBank),
    openingBalanceAt: text(SETTING_KEYS.openingBalanceAt),
    booksClosedAt: text(SETTING_KEYS.booksClosedAt),
    shopName: text(SETTING_KEYS.shopName),
    shopTagline: text(SETTING_KEYS.shopTagline),
    shopAddress: text(SETTING_KEYS.shopAddress),
    shopContact: text(SETTING_KEYS.shopContact),
  };
}

export async function writeSettings(
  ctx: WriteContext,
  base: Settings | undefined,
  next: Settings,
): Promise<void> {
  const { tx } = ctx;
  const wanted = new Map<string, string>();
  const put = (key: string, value: string | number | bigint | undefined) =>
    wanted.set(key, value === undefined ? "" : String(value));
  for (const [field, key] of Object.entries(SETTING_KEYS) as [
    keyof typeof SETTING_KEYS,
    string,
  ][]) {
    put(key, next[field]);
  }
  const channels = new Set([
    ...Object.keys(base?.marketplaceFees ?? {}),
    ...Object.keys(next.marketplaceFees ?? {}),
  ]);
  for (const channel of channels) {
    put(`${FEE_PREFIX}${channel}`, next.marketplaceFees?.[channel]);
  }
  const existing = new Map(
    (await tx.appSetting.findMany()).map((r) => [r.key, r.value]),
  );
  for (const [key, value] of wanted) {
    const had = existing.get(key);
    if (had === value || (had === undefined && value === "")) continue;
    await tx.appSetting.upsert({
      where: { key },
      create: { key, value, updatedAt: ctx.now },
      update: { value, updatedAt: ctx.now },
    });
  }
  ctx.touchSingleton("settings");
}

// ---------------------------------------------------------------------------
// Hidden AppleDB models
// ---------------------------------------------------------------------------

export async function projectAppleDbHidden(tx: Tx): Promise<string[]> {
  const rows = await tx.appleDbHiddenModel.findMany({
    where: { hidden: true },
    orderBy: [{ updatedAt: "asc" }, { key: "asc" }],
    select: { key: true },
  });
  return rows.map((r) => r.key);
}

export async function writeAppleDbHidden(
  ctx: WriteContext,
  next: readonly string[],
): Promise<void> {
  const { tx } = ctx;
  const hiddenNow = new Set(await projectAppleDbHidden(tx));
  const wanted = new Set(next);
  for (const key of wanted) {
    if (hiddenNow.has(key)) continue;
    await tx.appleDbHiddenModel.upsert({
      where: { key },
      create: { key, hidden: true, updatedAt: ctx.now },
      update: { hidden: true, updatedAt: ctx.now },
    });
  }
  for (const key of hiddenNow) {
    if (wanted.has(key)) continue;
    await tx.appleDbHiddenModel.update({
      where: { key },
      data: { hidden: false, updatedAt: ctx.now },
    });
  }
  ctx.touchSingleton("appleDbHidden");
}

// ---------------------------------------------------------------------------
// The signed-in person's warehouse
// ---------------------------------------------------------------------------

export async function projectMyWarehouse(
  tx: Tx,
  ctx: ProjectContext,
): Promise<string> {
  const staff = await tx.staff.findUnique({
    where: { id: ctx.staffId },
    select: { defaultLocationId: true },
  });
  if (staff?.defaultLocationId) return staff.defaultLocationId;
  const shop =
    (await tx.location.findFirst({
      where: { active: true, kind: "TOKO" },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    })) ??
    (await tx.location.findFirst({
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    }));
  return shop?.id ?? "";
}

export async function writeMyWarehouse(
  ctx: WriteContext,
  next: string,
): Promise<void> {
  const { tx } = ctx;
  if (next !== "") {
    const exists = await tx.location.findUnique({
      where: { id: next },
      select: { id: true },
    });
    if (exists === null) {
      throw new StoreValidationError(
        `Gudang ${next} tidak ditemukan.`,
        "warehouses",
        next,
      );
    }
  }
  await tx.staff.update({
    where: { id: ctx.staffId },
    data: { defaultLocationId: next === "" ? null : next },
  });
  ctx.touchSingleton("myWarehouseId");
}

// ---------------------------------------------------------------------------
// The chatbot's rows, read-only here
// ---------------------------------------------------------------------------

export async function projectActivePersona(tx: Tx): Promise<string> {
  const row = await tx.persona.findFirst({
    where: { active: true },
    select: { id: true },
  });
  return row?.id ?? "";
}

const readOnly = (name: string) => async () => {
  throw new StoreValidationError(
    `${name} diubah lewat halaman Chatbot, bukan di sini.`,
  );
};

export const personas: Adapter<"personas"> = {
  collection: "personas",
  async project(tx, _ctx, keys) {
    const rows = await tx.persona.findMany({
      where: keys === undefined ? {} : { id: { in: [...keys] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      blurb: p.blurb ?? "",
      prompt: p.prompt,
      builtIn: p.builtIn,
    }));
  },
  lock: async () => undefined,
  write: readOnly("Persona"),
};

export const corrections: Adapter<"corrections"> = {
  collection: "corrections",
  async project(tx, _ctx, keys) {
    const rows = await tx.agentCorrection.findMany({
      where: keys === undefined ? {} : { id: { in: [...keys] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        message: { select: { from: true } },
        createdBy: { select: { name: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      threadPhone: c.message?.from ?? "",
      messageId: c.messageId ?? "",
      original: c.original,
      corrected: c.corrected,
      note: c.note ?? undefined,
      at: isoOf(c.createdAt),
      staff: c.createdBy.name,
    }));
  },
  lock: async () => undefined,
  write: readOnly("Koreksi"),
};

export const chats: Adapter<"chats"> = {
  collection: "chats",
  project: async () => [],
  lock: async () => undefined,
  write: readOnly("Percakapan"),
};

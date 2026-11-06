/**
 * A fake shelf for the replay suite, in the shape of the shop's stock on
 * 27–29 Oct 2026 (the rated chats). It answers the rules bot's POS calls the
 * way `searchStock` (tools.ts) does: every query word must appear in the
 * unit's category, model or variant; a budget filters on the asking price;
 * `sort` orders the result; and the first result's variant leads with its
 * cheapest unit (`offerLadder`).
 *
 * Not a copy of the tool: it is the smallest stand-in that reproduces the
 * audit's findings (newest-first leads, "air" matching an iPad Air). A
 * finding that depends on the database's real behaviour belongs in a
 * db-backed test, not here.
 */

export interface ShelfUnit {
  readonly serial: string;
  readonly category: string;
  readonly model: string;
  readonly variant: string;
  readonly grade: "NEW" | "A" | "B" | "C";
  /** Whole rupiah. */
  readonly price: number;
  /** Higher is taken in more recently. */
  readonly intake: number;
  readonly batteryHealth?: number;
  readonly cycleCount?: number;
}

export const SHELF: readonly ShelfUnit[] = [
  { serial: "GAIRM2A01", category: "MacBook Air", model: 'MacBook Air 13" M2', variant: "8/256", grade: "B", price: 10_900_000, intake: 1, batteryHealth: 86 },
  { serial: "GAIRM2A02", category: "MacBook Air", model: 'MacBook Air 13" M2', variant: "8/256", grade: "A", price: 11_500_000, intake: 2, batteryHealth: 90 },
  { serial: "GAIRM2A03", category: "MacBook Air", model: 'MacBook Air 13" M2', variant: "8/256", grade: "A", price: 12_000_000, intake: 3, batteryHealth: 92 },
  { serial: "GAIRM2A04", category: "MacBook Air", model: 'MacBook Air 13" M2', variant: "8/256", grade: "A", price: 12_900_000, intake: 4, batteryHealth: 95 },
  { serial: "GAIRM2B01", category: "MacBook Air", model: 'MacBook Air 13" M2', variant: "16/512", grade: "A", price: 14_250_000, intake: 9, batteryHealth: 97 },
  { serial: "GAIRM1A01", category: "MacBook Air", model: 'MacBook Air 13" M1', variant: "8/256", grade: "B", price: 8_800_000, intake: 5, batteryHealth: 84 },
  { serial: "GAIRM3A01", category: "MacBook Air", model: 'MacBook Air 13" M3', variant: "8/256", grade: "A", price: 16_000_000, intake: 6, batteryHealth: 98 },
  { serial: "GPROM1A01", category: "MacBook Pro", model: 'MacBook Pro 13" M1', variant: "8/256", grade: "A", price: 12_500_000, intake: 7, batteryHealth: 88 },
  { serial: "GPROMPA01", category: "MacBook Pro", model: 'MacBook Pro 14" M1 Pro', variant: "16/512", grade: "A", price: 17_500_000, intake: 8, batteryHealth: 91 },
  { serial: "GPROI5A01", category: "MacBook Pro", model: 'MacBook Pro 13" 2020', variant: "i5 8/256", grade: "B", price: 9_500_000, intake: 3, cycleCount: 471 },
  { serial: "GIPADA01", category: "iPad", model: "iPad Air 5 M1", variant: "64GB", grade: "A", price: 7_000_000, intake: 10, batteryHealth: 93 },
];

const STOP = new Set(["inch", "inci", "ram", "ssd", "unit", "dan", "yang", "ada", "kak"]);

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,/|·]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function shown(u: ShelfUnit, all: readonly ShelfUnit[]) {
  return {
    serial: u.serial,
    model: u.model,
    variant: u.variant,
    grade: u.grade,
    price: rupiah(u.price),
    ...(u.batteryHealth !== undefined ? { batteryHealth: u.batteryHealth } : {}),
    ...(u.cycleCount !== undefined ? { cycleCount: u.cycleCount } : {}),
    left: all.filter((x) => x.model === u.model && x.variant === u.variant).length,
    photos: 0,
  };
}

export function searchShelf(
  args: Record<string, unknown>,
  shelf: readonly ShelfUnit[] = SHELF,
) {
  const words = tokens(String(args["query"] ?? ""));
  const min = typeof args["minPrice"] === "number" ? args["minPrice"] : undefined;
  const max = typeof args["maxPrice"] === "number" ? args["maxPrice"] : undefined;
  const sort = String(args["sort"] ?? "newest");
  let units = shelf.filter((u) => {
    const hay = `${u.category} ${u.model} ${u.variant}`.toLowerCase();
    return (
      words.every((w) => hay.includes(w)) &&
      (min === undefined || u.price >= min) &&
      (max === undefined || u.price <= max)
    );
  });
  units = [...units].sort((a, b) =>
    sort === "cheapest"
      ? a.price - b.price
      : sort === "priciest"
        ? b.price - a.price
        : b.intake - a.intake,
  );
  const first = units[0];
  if (first) {
    const lead = units
      .filter((u) => u.model === first.model && u.variant === first.variant)
      .sort((a, b) => a.price - b.price)[0]!;
    units = [lead, ...units.filter((u) => u !== lead)];
  }
  const live = shelf;
  return {
    matched: units.length,
    units: units.slice(0, 5).map((u) => shown(u, live)),
  };
}

/** The rules bot's POS dispatcher, answered from the shelf. */
export function shelfDispatch(shelf: readonly ShelfUnit[] = SHELF) {
  const asked: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    asked,
    dispatch: async (name: string, raw: unknown) => {
      const args = (raw ?? {}) as Record<string, unknown>;
      asked.push({ name, args });
      if (name === "search_stock") return searchShelf(args, shelf);
      if (name === "unit_photos" || name === "find_unit_photos")
        return { found: false };
      if (name === "check_serial") {
        const u = shelf.find((x) => x.serial === args["serial"]);
        return u ? { found: true, available: true, ...shown(u, shelf) } : { found: false };
      }
      return { error: "not on the fake shelf" };
    },
  };
}

/**
 * How a warehouse is named on screen: its number, then its name.
 *
 * *"For warehouse I feel like we should use the number like 01 02 03 04 as
 * well, not the string, but maybe add both, since they have been using the
 * 01 02 03 04 for like 6 years"* (owner ask 2026-10-08). The number is
 * `Location.code`, which B2Soft's Master Gudang carries; the name is what
 * somebody new to the shop can find.
 *
 * Every screen that prints a warehouse goes through here, so "01 · Gudang
 * Utama" reads the same on the inbound header, the stock count and the
 * export, and a warehouse with no number yet reads as its name alone.
 */

/** What a warehouse label needs. */
export interface LabelledWarehouse {
  readonly id: string;
  readonly code?: string | undefined;
  readonly name: string;
}

/**
 * The warehouse's own number, or undefined when it has none.
 *
 * A code equal to the id is not a number anybody chose: the store filled the
 * column with the id for a warehouse made without one (see the warehouses
 * adapter in packages/db), and printing `wh-7` beside a name would be noise.
 */
export function warehouseCode(w: LabelledWarehouse): string | undefined {
  const code = w.code?.trim();
  return code && code !== w.id ? code : undefined;
}

/** "01 · Gudang Utama", or the name alone when there is no number. */
export function warehouseLabel(w: LabelledWarehouse): string {
  const code = warehouseCode(w);
  return code ? `${code} · ${w.name}` : w.name;
}

/** The label of the warehouse with this id, or undefined when none has it. */
export function warehouseLabelOf(
  warehouses: readonly LabelledWarehouse[],
  id: string | null | undefined,
): string | undefined {
  const w = warehouses.find((x) => x.id === id);
  return w ? warehouseLabel(w) : undefined;
}

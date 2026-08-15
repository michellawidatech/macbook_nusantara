/**
 * Purchase-order fee allocation — docs/rebuild/08-data-integrity.md §3
 * ("allocate PO fees across lines → Unit.landed").
 *
 * The whole point of this file is that the allocations sum **exactly** to the
 * fee total. A naive `round(total * weight / sum)` per line loses or invents
 * rupiah, and the difference surfaces months later as a landed cost nobody can
 * reproduce. This uses the largest-remainder method, which is exact by
 * construction and deterministic in its tie-breaking.
 *
 * Pure: no I/O, no float.
 */

/**
 * Split `total` across `weights`, proportionally, with no drift.
 *
 * Returns one amount per weight; the amounts always sum to exactly `total`.
 * When every weight is zero the split is as even as possible, so a fee on a
 * zero-value PO still lands somewhere rather than vanishing.
 *
 * Leftover rupiah go to the largest remainders first, ties broken by position,
 * so the same inputs always produce the same allocation.
 *
 * @throws RangeError on an empty list, a negative weight, or a negative total.
 */
export function allocateFees(
  weights: readonly bigint[],
  total: bigint,
): bigint[] {
  if (weights.length === 0) {
    throw new RangeError("allocateFees: butuh minimal satu baris");
  }
  if (total < 0n) {
    throw new RangeError("allocateFees: total biaya tidak boleh negatif");
  }
  for (const w of weights) {
    if (w < 0n)
      throw new RangeError("allocateFees: bobot baris tidak boleh negatif");
  }

  const n = weights.length;
  let basis: readonly bigint[] = weights;
  let sum = weights.reduce((a, b) => a + b, 0n);

  if (sum === 0n) {
    basis = new Array<bigint>(n).fill(1n);
    sum = BigInt(n);
  }

  const parts = basis.map((weight, index) => {
    const exact = total * weight;
    const share = exact / sum;
    return { index, share, rem: exact - share * sum };
  });

  let leftover = total - parts.reduce((a, p) => a + p.share, 0n);

  // Every remainder is smaller than `sum`, so there are strictly fewer
  // leftover rupiah than lines and one pass always places them all.
  const byRemainder = [...parts].sort((a, b) =>
    a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1,
  );
  for (const p of byRemainder) {
    if (leftover === 0n) break;
    p.share += 1n;
    leftover -= 1n;
  }

  return parts.map((p) => p.share);
}

/**
 * What a unit actually cost, kept as its parts.
 *
 * 02 §9: "Landed cost in particular must show the buy price and each allocated
 * fee — an opaque cost figure is an argument waiting to happen."
 */
export interface LandedCost {
  readonly buy: bigint;
  readonly fees: readonly bigint[];
  readonly total: bigint;
}

export function landedCost(buy: bigint, fees: readonly bigint[]): LandedCost {
  return { buy, fees, total: fees.reduce((a, b) => a + b, buy) };
}

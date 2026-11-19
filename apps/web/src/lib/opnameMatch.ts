/**
 * A mistyped serial, found by a stock take (owner ask 2026-11-19).
 *
 * > *"There might be wrong SN input. In that case they will detect the wrong
 * > number as missing and the real number as not in warehouse, but they're
 * > actually the same. This means that we should merge them into 1 and match
 * > them in SO."*
 *
 * ## The two halves of one typo
 *
 * A serial keyed wrong at intake (`C02XC2F8JG5N` for `C02XC2F8JG5M`) is one
 * unit on the shelf and TWO rows in a count: the system's serial is never
 * scanned, so it reads *not scanned* (and missing once posted), and the serial
 * read off the case matches no unit, so it reads *not in system*. Posting it
 * as it stands would mark a unit the shop holds as lost and offer to take a
 * second one into stock.
 *
 * Only that pairing is a typo. A scanned serial that *belongs elsewhere* is a
 * different unit the shop also holds — two real units, and the remedy is to
 * move one, not merge them — so it is never offered as a match.
 *
 * ## Which of the two is right
 *
 * Either half can be the typo, so a match asks:
 *
 * - **the scanned serial is on the unit** (the usual case — it was read off
 *   the case or its barcode): the unit's record is corrected to it, history
 *   and all, as Inventory's *Edit unit* corrects one. The unit is then the
 *   serial the count scanned, so it reads Found and both rows become one.
 * - **the system's serial is right** (the counter keyed the case wrong): the
 *   scan is replaced by the system's serial. Nothing in the store changes.
 *
 * Correcting a record mid-count does not break the rule that a draft count
 * writes nothing that moves stock: the unit is expected before the correction
 * and after it, so no figure moves under the counter but the two that were
 * one typo.
 *
 * ## The suggestion
 *
 * `suggestMatches` pairs each *not in system* scan with the *not scanned*
 * unit whose serial is closest — an edit distance that counts a swapped pair
 * of neighbours as one slip, reads `O`/`0` and `I`/`1` as the same character
 * (a person copying a case cannot tell them apart), and ignores the barcode's
 * leading `S` marker. Two characters at most on a serial of eight or more,
 * one on a shorter one: further than that it is a different unit, and a
 * suggestion that is usually wrong teaches people to press it without
 * looking. A suggestion is only that — nothing is matched until somebody
 * presses Match.
 *
 * Pure: no React, no store. `test/opnameMatch.test.ts` is the spec.
 */

/** `O` reads as `0` and `I` as `1` — the two a person copying a case confuses. */
const fold = (s: string) =>
  s.toUpperCase().replace(/O/g, "0").replace(/I/g, "1");

/**
 * Optimal-string-alignment distance: insertions, deletions, substitutions and
 * a transposition of neighbours each cost one.
 */
function osa(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[m]!;
}

const withoutMarker = (s: string) => (s.startsWith("S") ? s.slice(1) : s);

/** How many slips apart two serials are. See the docblock for what is free. */
export function serialDistance(a: string, b: string): number {
  const x = fold(a.trim());
  const y = fold(b.trim());
  return Math.min(
    osa(x, y),
    osa(withoutMarker(x), y),
    osa(x, withoutMarker(y)),
  );
}

/** The furthest two serials may be and still be offered as one typo. */
export function matchLimit(a: string, b: string): number {
  return Math.min(a.length, b.length) >= 8 ? 2 : 1;
}

/** Close enough to be offered as the same unit. */
export function isLikelyTypo(a: string, b: string): boolean {
  const d = serialDistance(a, b);
  return d > 0 && d <= matchLimit(a, b);
}

/**
 * Which characters of `serial` differ from `other`, position by position —
 * for highlighting. Only when the two are the same length, which is what a
 * mis-keyed character is; an inserted or dropped one shifts everything after
 * it, and highlighting the whole tail says less than highlighting nothing.
 */
export function differingPositions(serial: string, other: string): boolean[] {
  if (serial.length !== other.length) return serial.split("").map(() => false);
  const a = fold(serial);
  const b = fold(other);
  return serial.split("").map((_, i) => a[i] !== b[i]);
}

export interface MatchSuggestion {
  /** The serial read off the unit — on no unit in the system. */
  readonly scanned: string;
  /** The expected unit nobody scanned, filed under this serial. */
  readonly expected: string;
  readonly distance: number;
}

/**
 * The likely typos among a count's two lists, one expected unit per scan.
 *
 * Paired closest first, so when two scans are near one unit the nearer gets
 * it, and a tie goes to the order the lists were handed in.
 */
export function suggestMatches(
  unregistered: readonly string[],
  notScanned: readonly string[],
): MatchSuggestion[] {
  const candidates: MatchSuggestion[] = [];
  for (const scanned of unregistered) {
    for (const expected of notScanned) {
      const distance = serialDistance(scanned, expected);
      if (distance > 0 && distance <= matchLimit(scanned, expected)) {
        candidates.push({ scanned, expected, distance });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const usedScan = new Set<string>();
  const usedExpected = new Set<string>();
  const out: MatchSuggestion[] = [];
  for (const c of candidates) {
    if (usedScan.has(c.scanned) || usedExpected.has(c.expected)) continue;
    usedScan.add(c.scanned);
    usedExpected.add(c.expected);
    out.push(c);
  }
  return out;
}

/**
 * The not-scanned units a match dialog offers for one scan, closest first.
 * Every one of them, not only the likely ones — the counter may know better —
 * with the distance so the list can say how close each is.
 */
export function rankCandidates(
  scanned: string,
  notScanned: readonly string[],
): { serial: string; distance: number }[] {
  return notScanned
    .map((serial, i) => ({
      serial,
      distance: serialDistance(scanned, serial),
      i,
    }))
    .sort((a, b) => a.distance - b.distance || a.i - b.i)
    .map(({ serial, distance }) => ({ serial, distance }));
}

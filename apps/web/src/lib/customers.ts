/**
 * What it takes to be a customer, and what to call one on screen.
 *
 * ## The owner's ask (2026-09-24)
 *
 * > *"When we record a new transaction and the user owe something, they need
 * > to add names or phone number (either is fine)."*
 *
 * A debt is money somebody has to go and collect, and a name or a telephone
 * number is enough to find the person. So a customer record needs ONE of the
 * two, not both — the form used to demand both at the till, which is what made
 * "just put the number down" impossible on a queue — and a customer recorded
 * by number alone is shown BY that number wherever a name would have been.
 * The store contract holds the same rule (`packages/store`: a customer with
 * neither is refused), so a nameless, numberless row cannot reach Postgres
 * from any screen.
 *
 * The B2Soft customers arrived the other way round — a name and no number
 * (owner answer 2026-09-13) — and they pass the same test.
 *
 * Pure: no React, no store. `test/customers.test.ts` is the spec.
 */

/** The two things that find a person. Either may be missing; not both. */
export interface CustomerContact {
  readonly name?: string | null;
  readonly phone?: string | null;
}

const clean = (s: string | null | undefined): string => (s ?? "").trim();

/** Is there a name or a number to reach this person by? */
export function hasContact(c: CustomerContact): boolean {
  return clean(c.name) !== "" || clean(c.phone) !== "";
}

/**
 * The name, or the number when no name was given.
 *
 * Empty only for a record that has neither, which no form writes any more;
 * a caller with a fallback word (walk-in, none) checks the record exists
 * rather than this string.
 */
export function customerLabel(c: CustomerContact): string {
  return clean(c.name) || clean(c.phone);
}

/**
 * "Name · phone", from whichever parts there are — for a picker's option,
 * where the number tells two Budis apart. A part that is missing is left
 * out, and a name that IS the number (a label already resolved by
 * `customerLabel`) is not printed twice.
 */
export function customerLine(c: CustomerContact): string {
  const name = clean(c.name);
  const phone = clean(c.phone);
  if (name === "" || name === phone) return phone || name;
  return phone === "" ? name : `${name} · ${phone}`;
}

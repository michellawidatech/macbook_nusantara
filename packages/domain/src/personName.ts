/**
 * Is this a person's name, or a placeholder somebody — usually a model —
 * wrote where a name goes (owner report 2026-10-27: the chat header and the
 * profile panel said "unknown")?
 *
 * `remember_customer` let a model fill every field it was offered, and a
 * model that does not know a name writes "unknown", "-" or "tidak tahu"
 * rather than leaving it out. Saved, that became the customer's name on
 * /chat and, through the Customer row it creates, on every till. So a name is
 * refused on the way in and ignored on the way out by this one reading:
 *
 *  - nothing, or nothing but punctuation;
 *  - a telephone number — a number is what we fall back TO, never a name;
 *  - every word a placeholder: "unknown", "n/a", "null", "tidak tahu",
 *    "anonim", "customer", "kak"… — "Unknown Customer" is two of them. A
 *    name with one real word in it ("Kak Budi") stays a name.
 *
 * Pure.
 */

const PLACEHOLDER_WORDS = new Set([
  "unknown",
  "unknow",
  "unkown",
  "n/a",
  "na",
  "nil",
  "null",
  "undefined",
  "none",
  "nobody",
  "no",
  "name",
  "noname",
  "nama",
  "tidak",
  "tdk",
  "gak",
  "ga",
  "nggak",
  "belum",
  "blm",
  "ada",
  "tahu",
  "tau",
  "diketahui",
  "anonim",
  "anonymous",
  "anon",
  "tanpa",
  "customer",
  "pelanggan",
  "pembeli",
  "buyer",
  "user",
  "guest",
  "tamu",
  "kak",
  "kakak",
  "ka",
  "sis",
  "gan",
  "bro",
  "min",
  "test",
  "tes",
  "xxx",
  "?",
]);

/** Whether `v` is a placeholder rather than somebody's name. */
export function isPlaceholderName(v: string | null | undefined): boolean {
  const t = (v ?? "").trim().toLowerCase();
  if (!/\p{L}/u.test(t)) return true; // empty, "-", "?", a phone number
  const words = t
    .split(/[\s,.;:()[\]{}"'`_-]+/)
    .filter((w) => w !== "" && w !== "/");
  return words.every((w) => PLACEHOLDER_WORDS.has(w));
}

/** The name, trimmed, or null when it is no name at all. */
export function realName(v: string | null | undefined): string | null {
  return isPlaceholderName(v) ? null : v!.trim();
}

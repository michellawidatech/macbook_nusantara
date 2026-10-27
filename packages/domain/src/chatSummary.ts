/**
 * The chat summary as staff read it (owner, 2026-10-27: *"only summarize the
 * user intent and what needs to be done next"*).
 *
 * `WaThreadMemory.summary` is two things in one column. Its first two lines
 * are for staff — what the customer wants and what happens next:
 *
 *     Mau: Mau beli MacBook Pro 14" M1 Pro 16/512, mau reservasi
 *     Selanjutnya: Konfirmasi unit yang dipilih + jam datang
 *
 *     Nama Rina, budget 20jt, buat edit video. Dikasih harga Pro 14" …
 *
 * and after a blank line the rest is the bot's long-term memory of the
 * customer, which the bot reads whole and the profile panel never shows. The
 * summariser (packages/agent summarize.ts) writes that shape; this is the one
 * reading of it, so the writer and the screen cannot drift.
 *
 * A note written before the shape (a paragraph retelling the chat) has
 * neither line: its opening is shown instead, clipped.
 *
 * Pure.
 */

/** The label of the line that says what the customer wants. */
export const SUMMARY_WANTS_LABEL = "Mau";
/** The label of the line that says what has to happen next. */
export const SUMMARY_NEXT_LABEL = "Selanjutnya";
/** How much of an old-format note the panel shows. */
export const SUMMARY_EXCERPT_CHARS = 160;

export interface StaffSummary {
  /** What the customer wants, one line; null when the note does not say. */
  readonly wants: string | null;
  /** What staff or the bot must do next; null when the note does not say. */
  readonly next: string | null;
  /** An old-format note (neither line): its opening, clipped with "…". */
  readonly excerpt: string | null;
}

const lineOf = (lines: readonly string[], label: string): string | null => {
  const pattern = new RegExp(`^${label}\\s*:\\s*(.*)$`, "i");
  for (const line of lines) {
    const m = pattern.exec(line);
    if (m && m[1]!.trim() !== "") return m[1]!.trim();
  }
  return null;
};

/** `text` on one line, clipped to `max` at a word boundary, with "…". */
export function clipSummary(text: string, max = SUMMARY_EXCERPT_CHARS): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The staff half of a summary, or null when there is no summary at all.
 * The two lines are found wherever they are, the first of each winning, so a
 * model that put a blank line between them is still read.
 */
export function staffSummary(
  note: string | null | undefined,
): StaffSummary | null {
  const text = (note ?? "").trim();
  if (text === "") return null;
  const lines = text.split("\n").map((l) => l.trim());
  const wants = lineOf(lines, SUMMARY_WANTS_LABEL);
  const next = lineOf(lines, SUMMARY_NEXT_LABEL);
  if (wants === null && next === null)
    return { wants: null, next: null, excerpt: clipSummary(text) };
  return { wants, next, excerpt: null };
}

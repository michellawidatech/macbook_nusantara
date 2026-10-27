/**
 * Answered turns, read back from `WaMessage` rows — every line of a burst
 * with the reply that answered it (2026-10-22).
 *
 * A reply lands on ONE row: the draft pass writes `replyText` onto the
 * batch's anchor (its newest row) and only stamps the others answered; a
 * staff reply does the same with the newest row of the thread. Read row by
 * row, as the history and the summariser used to, a customer who wrote
 * "halo" / "mau tanya" / "Air M2 16/512 ada?" was remembered as having said
 * only the last line.
 *
 * What ties the lines of one turn together is `answeredAt`: one claim writes
 * the same instant onto every row it answers (draft.ts, the inbox's reply
 * and "handled"). Within one instant the rows are walked in the order they
 * were sent (`ts`, then `id` — the same order the batch was frozen in), and
 * each row carrying a reply closes the turn that the lines before it opened.
 * A staff reply that also re-stamps an earlier hand-over row (PERLU_STAF,
 * whose holding line is already on it) therefore yields two turns, the bot's
 * holding line and then the person's answer, in that order.
 *
 * Lines with no reply after them in their instant ("handled" without an
 * answer) are not a turn and are dropped, as they always were.
 *
 * Pure: no database, no clock.
 */

/** One inbound row, as much of it as a turn needs. */
export interface AnsweredRow {
  readonly id: string;
  readonly ts: Date;
  readonly answeredAt: Date | null;
  readonly text: string | null;
  readonly msgType: string;
  readonly replyText: string | null;
}

/** One answered burst. */
export interface AnsweredTurn {
  /** Every line the customer sent in the burst, oldest first, joined by "\n". */
  readonly customer: string;
  readonly reply: string;
  /** The first row of the burst and the row carrying the reply. */
  readonly firstId: string;
  readonly replyId: string;
  readonly answeredAt: Date;
  /** When the customer sent the reply row (`ts`), for a dated recall line. */
  readonly ts: Date;
}

/** A row's words, or a marker for a photo or voice note with no caption. */
export function lineOf(row: {
  readonly text: string | null;
  readonly msgType: string;
}): string | null {
  const text = row.text?.trim();
  if (text) return text;
  return row.msgType && row.msgType !== "text"
    ? `(the customer sent a ${row.msgType})`
    : null;
}

const byTsThenId = (a: AnsweredRow, b: AnsweredRow) =>
  a.ts.getTime() - b.ts.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Group answered rows into turns, oldest turn first.
 *
 * Any mix of rows may be passed — reply rows and the lines answered with
 * them; rows with no `answeredAt` are ignored.
 */
export function answeredTurns(rows: readonly AnsweredRow[]): AnsweredTurn[] {
  const byInstant = new Map<number, AnsweredRow[]>();
  for (const r of rows) {
    if (!r.answeredAt) continue;
    const k = r.answeredAt.getTime();
    const list = byInstant.get(k);
    if (list) list.push(r);
    else byInstant.set(k, [r]);
  }
  const turns: AnsweredTurn[] = [];
  for (const [, group] of [...byInstant].sort((a, b) => a[0] - b[0])) {
    let lines: string[] = [];
    let firstId: string | null = null;
    for (const r of [...group].sort(byTsThenId)) {
      firstId ??= r.id;
      const line = lineOf(r);
      if (line) lines.push(line);
      const reply = r.replyText?.trim();
      if (!reply) continue;
      turns.push({
        customer: lines.join("\n"),
        reply,
        firstId,
        replyId: r.id,
        answeredAt: r.answeredAt!,
        ts: r.ts,
      });
      lines = [];
      firstId = null;
    }
  }
  return turns;
}

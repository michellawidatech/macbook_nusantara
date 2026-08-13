/**
 * The inbound agent pipeline: answer a sender's pending BURST of messages with
 * the conversational agent and record the outcome on the rows.
 *
 * Messages are debounced per phone number (see ./debounce.ts) — WhatsApp
 * customers type several short lines, so instead of one agent run per line we
 * wait for a content-aware quiet window and then process the whole burst at once.
 *
 * `runConversation(from)` flow:
 *  1. load the sender's pending `BARU` rows (the burst), oldest→newest.
 *  2. all non-text / empty → human handoff (PERLU_STAF) + polite ack.
 *  3. no Anthropic credential → handoff (the inbox still works without a key).
 *  4. load this thread's memory (./memory.ts) and build the chat history: the
 *     last few answered turns verbatim + the burst joined into one user turn.
 *     Older context rides in the system prompt as a summary, not as transcript.
 *  5. sanitize the reply to plain text (no bold / minimal emoji) and send once.
 *  6. stamp every burst row DIJAWAB_AGEN (PERLU_STAF on escalation) — where a
 *     handoff PROMISED in the reply counts as an escalation, see ./handoff.ts,
 *     and so does a SECOND consecutive clarifying question (MAX_CLARIFY).
 *  7. refresh the rolling summary if enough turns have piled up, after the reply
 *     is already sent so the customer never waits on it.
 *
 * `buildHistory` is pure and unit-tested (alternation / unanswered-row skipping)
 * without a DB.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { prisma, type WaMessage } from "@nusantara/db";
import { stripFormatting } from "@nusantara/domain/agent";
import { sendText } from "../send.js";
import { converse } from "./converse.js";
import { hasAnthropicCredential } from "./anthropic.js";
import {
  AMBIGUOUS,
  ambiguousHandoff,
  asksClarification,
  handoffAck,
  handoffLine,
  promisesHandoff,
} from "./handoff.js";
import { loadMemory, saveClarify } from "./memory.js";
import { refreshSummaryIfDue } from "./summarize.js";

/**
 * How many prior answered turns to send verbatim once a summary exists. The rest
 * of the conversation arrives through the rolling summary in the system prompt
 * (see ./summarize.ts), which is what replaced the old flat 10-turn window.
 * Four keeps the exact wording of the live exchange, where a price or a spec is
 * still being negotiated and a paraphrase would not do.
 */
export const HISTORY_LIMIT = 4;

/**
 * The window before any summary exists — the old behaviour, unchanged. Turns 1-2
 * of a conversation, and any thread whose summarizer is failing, keep the full
 * ten, so this change can never make the agent remember LESS than it used to.
 */
export const HISTORY_LIMIT_COLD = 10;

/**
 * Clarifying questions the agent may ask before the thread goes to a human. One
 * is a fair question; two in a row means it is not going to get there.
 */
export const MAX_CLARIFY = 2;

/** A prior message row projected to what `buildHistory` needs. */
export interface HistoryRow {
  text: string | null;
  replyText: string | null;
}

/**
 * Build a strictly-alternating chat transcript for the Anthropic API from prior
 * rows (oldest→newest) plus the current customer message. Only rows that were
 * actually answered contribute a user+assistant pair, so turns always alternate
 * and the transcript starts with a user turn even when earlier messages were
 * left unanswered.
 */
export function buildHistory(
  prior: HistoryRow[],
  currentText: string,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const row of prior) {
    const q = row.text?.trim();
    const a = row.replyText?.trim();
    if (!q || !a) continue; // skip unanswered / empty rows to keep alternation
    messages.push({ role: "user", content: q });
    messages.push({ role: "assistant", content: a });
  }
  messages.push({ role: "user", content: currentText });
  return messages;
}

/**
 * Load the recent answered turns for a sender, oldest→newest. Only rows with
 * both `text` and `replyText` are returned, so the sender's still-pending `BARU`
 * burst (no `replyText` yet) is naturally excluded — no id filter needed.
 */
async function loadHistory(from: string, take: number): Promise<HistoryRow[]> {
  const rows = await prisma.waMessage.findMany({
    where: { from, direction: "IN", replyText: { not: null }, text: { not: null } },
    orderBy: { ts: "desc" },
    take,
    select: { text: true, replyText: true },
  });
  return rows.reverse();
}

/**
 * Ack the customer and route the whole burst to staff. Like {@link stampBatch},
 * the ack lands on the LAST row only: `replyText` is what marks a row as one
 * answered turn, so fanning it across the burst would replay a 3-line handoff as
 * three identical user→assistant pairs and inflate the turn count the summary
 * refresh is scheduled on (see ./summarize.ts).
 */
async function handoffBatch(from: string, batch: WaMessage[], reason: string): Promise<void> {
  const ack = handoffAck();
  await sendText(from, ack);
  await prisma.waMessage.updateMany({
    where: { id: { in: batch.map((m) => m.id) } },
    data: { status: "PERLU_STAF", answeredAt: new Date() },
  });
  await prisma.waMessage.update({
    where: { id: batch[batch.length - 1]!.id },
    data: { replyText: ack },
  });
  console.info(`[webhook] handoff ${from} x${batch.length} (${reason})`);
}

/**
 * Stamp a whole burst as answered by the agent. The reply text lands on the last
 * row only, so history reconstruction keeps one clean user→assistant pair for
 * the burst (earlier rows have no `replyText` and are skipped by `loadHistory`).
 */
async function stampBatch(
  batch: WaMessage[],
  reply: string,
  status: "DIJAWAB_AGEN" | "PERLU_STAF",
): Promise<void> {
  const ids = batch.map((m) => m.id);
  const now = new Date();
  await prisma.waMessage.updateMany({
    where: { id: { in: ids } },
    data: { status, answeredBy: "agent", answeredAt: now },
  });
  await prisma.waMessage.update({
    where: { id: batch[batch.length - 1]!.id },
    data: { replyText: reply },
  });
}

/**
 * Answer a sender's pending burst end-to-end. Never throws — a failure is logged
 * and leaves the rows `BARU` so the sweeper retries them.
 */
export async function runConversation(from: string): Promise<void> {
  try {
    const batch = await prisma.waMessage.findMany({
      where: { from, status: "BARU" },
      orderBy: { ts: "asc" },
    });
    if (batch.length === 0) return;

    const name = batch.find((m) => m.name)?.name ?? null;
    const textRows = batch.filter((m) => m.msgType === "text" && m.text?.trim());

    if (textRows.length === 0) {
      await handoffBatch(from, batch, "non-text");
      return;
    }
    if (!hasAnthropicCredential()) {
      await handoffBatch(from, batch, "no-credential");
      return;
    }

    // The burst becomes one customer turn (lines joined) so the agent sees the
    // full thought, not fragments.
    const combined = textRows.map((m) => m.text!.trim()).join("\n");
    const memo = await loadMemory(from);
    const prior = await loadHistory(from, memo.summary ? HISTORY_LIMIT : HISTORY_LIMIT_COLD);
    const history = buildHistory(prior, combined);

    const out = await converse(history, { from, name }, memo);
    if (!out || !out.reply.trim()) {
      await handoffBatch(from, batch, out ? "empty-reply" : "converse-null");
      return;
    }

    const reply = stripFormatting(out.reply);
    // A handoff must be TRUE the moment we say it. The model can drift either
    // way, so neither direction is left to it (see ./handoff.ts):
    //  - promised a human but skipped the tool → escalate anyway, otherwise the
    //    burst reads DIJAWAB_AGEN and nobody ever picks the thread up;
    //  - escalated silently → tell the customer, with the only timing we know.
    const promised = promisesHandoff(reply);

    // Asking for clarification is not an escalation the first time — that IS the
    // "ask instead of guessing" behaviour. But a second consecutive ask means the
    // agent is not going to get there, so the cap is enforced here rather than
    // trusted to the model, exactly like promisesHandoff above. Any turn it
    // answers normally is progress and resets the streak.
    //
    // The reply is read as well as the tool call, for the same reason
    // promisesHandoff reads it: the model routinely asks "maksudnya yang mana ya
    // kak" in prose without calling ask_clarification, and a streak counted only
    // from tool calls then RESETS on the very turn that should have tripped it.
    const clarified = Boolean(out.clarify) || asksClarification(reply);
    const clarifyCount = clarified ? memo.clarifyCount + 1 : 0;
    const exhausted = clarified && clarifyCount >= MAX_CLARIFY;

    const escalate =
      out.escalate ?? (exhausted ? AMBIGUOUS : promised ? "promised-in-reply" : undefined);

    // On the exhausted path the model's third question is dropped, not appended:
    // "which did you mean?" plus "a human will take over" in one message is worse
    // than simply handing over.
    const text = exhausted
      ? ambiguousHandoff()
      : escalate && !promised
        ? `${reply}\n\n${handoffLine()}`
        : reply;

    await sendText(from, text);
    await stampBatch(batch, text, escalate ? "PERLU_STAF" : "DIJAWAB_AGEN");
    // A thread a human now owns starts the streak over.
    await saveClarify(from, escalate ? 0 : clarifyCount);
    if (escalate) console.info(`[webhook] escalate ${from} (${escalate})`);

    // After the reply is on the wire, so it costs the customer no latency, and
    // isolated so a summarizer fault can never turn a delivered reply into a
    // failed run that the sweeper retries.
    try {
      await refreshSummaryIfDue(from, memo);
    } catch (err) {
      console.error(`[webhook] summary refresh failed for ${from}:`, err);
    }
  } catch (err) {
    console.error(`[webhook] runConversation failed for ${from}:`, err);
  }
}

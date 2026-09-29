/**
 * `pnpm --filter @nusantara/api knowledge <file>` — load the owner's answer
 * sheet into the chatbot's knowledge base (owner ask 2026-09-18).
 *
 *   pnpm --filter @nusantara/api knowledge docs/chatbot/knowledge-2026-09-18.md --by ersen
 *   sudo -u _nusantara /opt/nusantara/current/ops/run knowledge /tmp/knowledge.md --by ersen
 *
 * The same reading of the same text as /chat → Knowledge → "Import from a
 * document" (`parseQaText`, packages/domain), for the first load of a fresh
 * database, where nobody has signed in yet to paste anything. After that the
 * Knowledge tab is where answers are added, edited and switched off.
 *
 * A question already in the knowledge base — same words, whatever the case,
 * spacing or emoji — is skipped, so running it twice adds nothing. Every row it
 * writes is recorded as a store change in the same transaction, so a till
 * already open sees the answers on its next poll (CLAUDE.md: anything in the
 * database the store projects must call `recordStoreChanges`).
 */

import { readFile } from "node:fs/promises";
import {
  db,
  disconnect,
  recordStoreChanges,
  type PrismaClient,
} from "@nusantara/db";
import { parseQaText, questionKey } from "@nusantara/domain";

const USAGE = "usage: knowledge <file> [--by <username>] [--dry-run]";

interface Args {
  readonly file: string;
  readonly by?: string;
  readonly dryRun: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let file: string | undefined;
  let by: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--by") {
      by = argv[i + 1];
      if (by === undefined || by.startsWith("--"))
        throw new Error("--by butuh nama pengguna");
      i += 1;
    } else if (arg.startsWith("--")) throw new Error(`argumen asing: ${arg}`);
    else if (file === undefined) file = arg;
    else throw new Error(`argumen asing: ${arg}`);
  }
  if (file === undefined) throw new Error("file wajib disebut");
  return { file, by, dryRun };
}

export interface ImportResult {
  readonly added: number;
  readonly skipped: readonly string[];
  readonly unanswered: readonly string[];
}

/** The import itself, apart from the terminal, so a test can drive it. */
export async function importKnowledge(
  client: PrismaClient,
  text: string,
  opts: { staffId: string; dryRun?: boolean; now?: Date },
): Promise<ImportResult> {
  const { pairs, unanswered } = parseQaText(text);
  const existing = await client.agentKnowledge.findMany({
    select: { question: true },
  });
  const known = new Set(existing.map((k) => questionKey(k.question)));

  const fresh: (typeof pairs)[number][] = [];
  const skipped: string[] = [];
  for (const p of pairs) {
    const key = questionKey(p.question);
    if (known.has(key)) skipped.push(p.question);
    else {
      known.add(key);
      fresh.push(p);
    }
  }

  if (!opts.dryRun && fresh.length > 0) {
    const now = opts.now ?? new Date();
    await client.$transaction(async (tx) => {
      const ids: string[] = [];
      // One at a time, a millisecond apart: the knowledge base orders its
      // handles by creation (packages/agent knowledge.ts), and the owner's
      // order is the order the sheet was written in.
      for (const [i, p] of fresh.entries()) {
        const at = new Date(now.getTime() + i);
        const row = await tx.agentKnowledge.create({
          data: {
            question: p.question,
            answer: p.answer,
            active: true,
            createdById: opts.staffId,
            createdAt: at,
            updatedAt: at,
          },
          select: { id: true },
        });
        ids.push(row.id);
      }
      await recordStoreChanges(
        tx,
        ids.map((id) => ["knowledge", id] as [string, string]),
      );
    });
  }
  return { added: fresh.length, skipped, unanswered };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const text = await readFile(args.file, "utf8");
  const client = db();

  const author = args.by
    ? await client.staff.findUnique({
        where: { username: args.by },
        select: { id: true, username: true },
      })
    : await client.staff.findFirst({
        where: { role: "OWNER", active: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, username: true },
      });
  if (author === null) {
    throw new Error(
      args.by
        ? `tidak ada akun ${args.by}`
        : "belum ada pemilik yang aktif — sebutkan penulisnya dengan --by <username>",
    );
  }

  const result = await importKnowledge(client, text, {
    staffId: author.id,
    dryRun: args.dryRun,
  });
  for (const q of result.skipped) console.log(`sudah ada: ${q}`);
  for (const q of result.unanswered)
    console.log(`tanpa jawaban (dilewati): ${q}`);
  console.log(
    `${args.dryRun ? "(dry run) akan ditambah" : "ditambah"}: ${result.added} jawaban, ` +
      `atas nama ${author.username}. Dilewati: ${result.skipped.length}.`,
  );
}

if (
  process.argv[1]?.includes("import-knowledge") ||
  process.argv[1]?.endsWith("knowledge.mjs")
) {
  main()
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      console.error(USAGE);
      process.exitCode = 1;
    })
    .finally(() => void disconnect());
}

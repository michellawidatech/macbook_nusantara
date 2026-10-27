/**
 * `pnpm --filter @nusantara/api staff` — create a staff account, or set the
 * password of one that already exists.
 *
 * The door that needs no session: the first owner of a fresh database, and an
 * owner who has forgotten their own password. Everything else — adding people,
 * resetting theirs — is the owner's account screen (routes/staff.ts), and
 * giving every seeded person a first password is `accounts` (seed-accounts.ts).
 *
 * The password is read from stdin, never from argv: an argument is visible in
 * `ps` and lands in shell history.
 *
 *   printf '%s' 'the-password' | pnpm --filter @nusantara/api staff \
 *     --username admin --name 'Administrator' --role OWNER --approve
 *
 * Or `--initial` instead of a password on stdin: the shop's initial password
 * (`INITIAL_PASSWORD`), which the person must replace at their next sign-in.
 *
 *   pnpm --filter @nusantara/api staff --username ersen --name Ersen --role OWNER --initial --finance
 *
 * `--finance` opens Financial & Report to the account (2026-10-16). It is not
 * implied by OWNER, and leaving it off an existing account switches it off.
 *
 * Either way every session of the account ends: whoever was signed in as it
 * before this ran is signed in with a password that no longer exists.
 */

import { createInterface } from "node:readline/promises";
import { db, disconnect, isServiceAccount } from "@nusantara/db";
import { INITIAL_PASSWORD } from "@nusantara/domain";
import { hashPassword } from "../auth/credentials.js";

interface Args {
  readonly username: string;
  readonly name: string;
  readonly role: "OWNER" | "STAFF";
  readonly canApprove: boolean;
  /** May read the shop's money — Financial & Report. */
  readonly canViewFinance: boolean;
  /** Use the shop's initial password and require a change at next sign-in. */
  readonly initial: boolean;
}

const USAGE = `usage: staff --username <name> [--name <full name>] [--role OWNER|STAFF] [--approve] [--finance] [--initial]
       the password is read from stdin, unless --initial gives the account the
       shop's initial password (changed at the next sign-in)`;

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  let canApprove = false;
  let canViewFinance = false;
  let initial = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--approve") {
      canApprove = true;
      continue;
    }
    if (arg === "--finance") {
      canViewFinance = true;
      continue;
    }
    if (arg === "--initial") {
      initial = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`argumen asing: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`${arg} butuh nilai`);
    flags.set(arg.slice(2), value);
    i += 1;
  }

  const username = flags.get("username");
  if (username === undefined || username.length === 0)
    throw new Error("--username wajib diisi");
  if (isServiceAccount(username))
    throw new Error(
      `${username} adalah akun sistem — tidak bisa diberi kata sandi`,
    );

  const role = flags.get("role") ?? "STAFF";
  if (role !== "OWNER" && role !== "STAFF")
    throw new Error("--role harus OWNER atau STAFF");

  return {
    username,
    name: flags.get("name") ?? username,
    role,
    // An owner who cannot approve is a contradiction in 03 §Settings; every
    // approval gate there is "owner or canApprove".
    canApprove: canApprove || role === "OWNER",
    canViewFinance,
    initial,
  };
}

/**
 * Read the password from stdin. Piped input is taken whole (minus a trailing
 * newline the shell added); an interactive run prompts instead of hanging on a
 * pipe that will never close.
 */
async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return (await rl.question("kata sandi: ")).trim();
    } finally {
      rl.close();
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const password = args.initial ? INITIAL_PASSWORD : await readPassword();

  // The API's own login schema is the floor; anything it would reject at the
  // form is not worth storing.
  if (password.length === 0) throw new Error("kata sandi kosong");
  if (password.length > 256) throw new Error("kata sandi terlalu panjang");

  const client = db();
  const existing = await client.staff.findUnique({
    where: { username: args.username },
    select: { id: true },
  });

  // Hash outside the transaction: Argon2id is ~100 ms of deliberate work and
  // has no business holding a row lock.
  const passwordHash = await hashPassword(password);
  const now = new Date();

  const staff = await client.$transaction(async (tx) => {
    const row =
      existing === null
        ? await tx.staff.create({
            data: {
              username: args.username,
              name: args.name,
              role: args.role,
              canApprove: args.canApprove,
              canViewFinance: args.canViewFinance,
              active: true,
              passwordHash,
              mustChangePassword: args.initial,
              createdAt: now,
            },
          })
        : await tx.staff.update({
            where: { id: existing.id },
            data: {
              name: args.name,
              role: args.role,
              canApprove: args.canApprove,
              canViewFinance: args.canViewFinance,
              active: true,
              passwordHash,
              mustChangePassword: args.initial,
            },
          });

    // A new password ends every old session, whoever was holding it (08 §9:
    // rotate on a credential change).
    await tx.staffSession.updateMany({
      where: { staffId: row.id, revokedAt: null },
      data: { revokedAt: now },
    });

    // 08 §9: a credential change is auditable. staffId stays null — this ran
    // from a terminal, not from a session, and inventing an actor would be a
    // lie in the one table that exists to be believed. Never the hash itself.
    await tx.auditLog.create({
      data: {
        at: now,
        staffId: null,
        entity: "Staff",
        entityId: row.id,
        action: existing === null ? "CREATE" : "UPDATE",
        field: "passwordHash",
      },
    });

    return row;
  });

  console.log(
    `${existing === null ? "dibuat" : "diperbarui"}: ${staff.username} (${staff.id}) role=${staff.role} canApprove=${String(staff.canApprove)} canViewFinance=${String(staff.canViewFinance)}` +
      (args.initial
        ? ` — kata sandi awal "${INITIAL_PASSWORD}", wajib diganti saat masuk`
        : ""),
  );
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    console.error(USAGE);
    process.exitCode = 1;
  })
  .finally(() => void disconnect());

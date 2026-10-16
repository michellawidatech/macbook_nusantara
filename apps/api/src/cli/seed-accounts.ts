/**
 * `pnpm --filter @nusantara/api accounts` — give the shop's people their
 * first sign-in (owner ask 2026-09-18: "seed the account and the password,
 * initially all will be 'password', then in the first time login need to
 * change their password and Ersen can manage all the password account").
 *
 *   pnpm --filter @nusantara/api accounts --owner ersen [--dry-run]
 *   sudo -u _nusantara /opt/nusantara/current/ops/run accounts --owner ersen
 *
 * What it does, in order, and nothing else:
 *
 *  1. Every active salesperson with no account of the same name gets one:
 *     username from their first name (`usernameFor`: "Ersen" → `ersen`),
 *     role STAFF. The salesperson list is the staff master data the B2Soft
 *     import brings; the two lists are the same humans (fixture/shop.ts says
 *     the same about the demo shop).
 *  2. Every human account that has never had a password — the seed's
 *     placeholder hash — is given one. The seed stays locked on purpose; this
 *     is the deliberate step that opens it.
 *  3. `--owner <username>` makes that account an OWNER who can approve,
 *     creating it if no salesperson produced it (`--owner-name` names it).
 *
 * Everything it creates or opens is on the shop's initial password with
 * `mustChangePassword`, so each person chooses their own at first sign-in and
 * nobody — the owner included — ever learns it.
 *
 * What it never does: touch an account that already has a password (use the
 * owner's account screen, or `staff`, to reset one), touch a service account,
 * or delete anything. Run it twice and the second run changes nothing.
 */

import {
  db,
  disconnect,
  isServiceAccount,
  UNUSABLE_PASSWORD_HASH,
  type PrismaClient,
} from "@nusantara/db";
import {
  INITIAL_PASSWORD,
  USERNAME_PATTERN,
  usernameFor,
} from "@nusantara/domain";
import { hashPassword } from "../auth/credentials.js";

const USAGE = `usage: accounts [--owner <username>] [--owner-name <name>] [--dry-run]`;

interface Args {
  readonly owner?: string;
  readonly ownerName?: string;
  readonly dryRun: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let owner: string | undefined;
  let ownerName: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    const value = argv[i + 1];
    if (arg !== "--owner" && arg !== "--owner-name")
      throw new Error(`argumen asing: ${arg}`);
    if (value === undefined || value.startsWith("--"))
      throw new Error(`${arg} butuh nilai`);
    if (arg === "--owner") owner = value.trim().toLowerCase();
    else ownerName = value.trim();
    i += 1;
  }
  if (owner !== undefined && !USERNAME_PATTERN.test(owner))
    throw new Error(`--owner ${owner} bukan nama pengguna yang valid`);
  if (owner !== undefined && isServiceAccount(owner))
    throw new Error(`${owner} adalah akun sistem`);
  return { owner, ownerName, dryRun };
}

type Action =
  "dibuat" | "diberi kata sandi awal" | "dijadikan pemilik" | "tetap";

interface Line {
  username: string;
  name: string;
  role: "OWNER" | "STAFF";
  action: Action;
}

function titleCase(username: string): string {
  return username.charAt(0).toUpperCase() + username.slice(1);
}

export async function seedAccounts(
  client: PrismaClient,
  args: Args,
  passwordHash: string,
): Promise<Line[]> {
  const now = new Date();
  const staff = await client.staff.findMany({
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      active: true,
      passwordHash: true,
    },
  });
  const humans = staff.filter((s) => !isServiceAccount(s.username));
  const taken = new Set(staff.map((s) => s.username));
  const names = new Set(humans.map((s) => s.name.trim().toLowerCase()));

  const salespeople = await client.salesperson.findMany({
    where: { active: true },
    select: { name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const lines: Line[] = [];
  const toCreate: Array<{
    username: string;
    name: string;
    role: "OWNER" | "STAFF";
  }> = [];

  // 1. A login for every salesperson who has none.
  for (const sp of salespeople) {
    const name = sp.name.trim();
    if (name === "" || names.has(name.toLowerCase())) continue;
    const username = usernameFor(name, taken);
    taken.add(username);
    names.add(name.toLowerCase());
    toCreate.push({
      username,
      name,
      role: username === args.owner ? "OWNER" : "STAFF",
    });
  }

  // 3a. The owner, when no salesperson produced the account.
  if (
    args.owner !== undefined &&
    !humans.some((h) => h.username === args.owner) &&
    !toCreate.some((c) => c.username === args.owner)
  ) {
    toCreate.push({
      username: args.owner,
      name: args.ownerName ?? titleCase(args.owner),
      role: "OWNER",
    });
    taken.add(args.owner);
  }

  // 2. Human accounts that never had a password.
  const toOpen = humans.filter(
    (h) => h.active && h.passwordHash === UNUSABLE_PASSWORD_HASH,
  );

  // 3b. An existing account named as the owner.
  const toPromote = humans.filter(
    (h) => h.username === args.owner && h.role !== "OWNER",
  );

  if (!args.dryRun) {
    await client.$transaction(async (tx) => {
      for (const c of toCreate) {
        const row = await tx.staff.create({
          data: {
            username: c.username,
            name: c.name,
            role: c.role,
            canApprove: c.role === "OWNER",
            // The owner can see the money from the start, or nobody could
            // switch it on for anybody else (Settings → Staff accounts).
            canViewFinance: c.role === "OWNER",
            active: true,
            passwordHash,
            mustChangePassword: true,
            createdAt: now,
          },
          select: { id: true },
        });
        // staffId null: this ran from a terminal, not a session, and inventing
        // an actor would be a lie in the one table that exists to be believed.
        await tx.auditLog.create({
          data: {
            at: now,
            staffId: null,
            entity: "Staff",
            entityId: row.id,
            action: "CREATE",
            after: `${c.username} ${c.role}`,
          },
        });
      }
      for (const h of toOpen) {
        await tx.staff.update({
          where: { id: h.id },
          data: { passwordHash, mustChangePassword: true },
        });
        await tx.auditLog.create({
          data: {
            at: now,
            staffId: null,
            entity: "Staff",
            entityId: h.id,
            action: "UPDATE",
            field: "passwordHash",
            after: "INITIAL",
          },
        });
      }
      for (const h of toPromote) {
        await tx.staff.update({
          where: { id: h.id },
          data: { role: "OWNER", canApprove: true, canViewFinance: true },
        });
        await tx.auditLog.create({
          data: {
            at: now,
            staffId: null,
            entity: "Staff",
            entityId: h.id,
            action: "UPDATE",
            field: "role",
            before: h.role,
            after: "OWNER",
          },
        });
      }
    });
  }

  for (const c of toCreate)
    lines.push({
      username: c.username,
      name: c.name,
      role: c.role,
      action: "dibuat",
    });
  for (const h of humans) {
    if (toCreate.some((c) => c.username === h.username)) continue;
    const opened = toOpen.includes(h);
    const promoted = toPromote.includes(h);
    lines.push({
      username: h.username,
      name: h.name,
      role: promoted ? "OWNER" : h.role,
      action: opened
        ? "diberi kata sandi awal"
        : promoted
          ? "dijadikan pemilik"
          : "tetap",
    });
  }
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = db();

  const owners = await client.staff.count({
    where: { role: "OWNER", active: true },
  });
  if (owners === 0 && args.owner === undefined) {
    throw new Error(
      "belum ada pemilik yang aktif — sebutkan siapa dengan --owner <username>, " +
        "atau tidak ada yang bisa mengelola akun",
    );
  }

  // One hash for the whole run, hashed with a fresh salt: every account opened
  // here must replace it at first sign-in anyway.
  const passwordHash = await hashPassword(INITIAL_PASSWORD);
  const lines = await seedAccounts(client, args, passwordHash);

  const width = Math.max(8, ...lines.map((l) => l.username.length));
  for (const l of lines) {
    console.log(
      `${l.username.padEnd(width)}  ${l.role.padEnd(5)}  ${l.action.padEnd(22)}  ${l.name}`,
    );
  }
  const changed = lines.filter((l) => l.action !== "tetap").length;
  console.log(
    args.dryRun
      ? `\n(dry run) ${changed} akun akan diubah. Tidak ada yang ditulis.`
      : `\n${changed} akun diubah. Kata sandi awal: "${INITIAL_PASSWORD}" — ` +
          "wajib diganti saat pertama masuk.",
  );
}

// Run only as a script, so a test can import `seedAccounts`.
if (
  process.argv[1]?.includes("seed-accounts") ||
  process.argv[1]?.endsWith("accounts.mjs")
) {
  main()
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      console.error(USAGE);
      process.exitCode = 1;
    })
    .finally(() => void disconnect());
}

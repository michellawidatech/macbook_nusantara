/**
 * `chatbot doctor` — why the bot is not answering.
 *
 *   pnpm --filter @nusantara/api chatbot
 *   sudo -u _nusantara /opt/nusantara/current/ops/run chatbot
 *
 * Owner report, 2026-09-21: *"Make the chatbot works Idk why it did not
 * receive my message."*
 *
 * ## Why a command and not a log line
 *
 * The answer that day was the least visible one there is: the webhook was
 * running, healthy and correct, the knowledge base was loaded, the worker was
 * polling — and `WaRawEvent` had zero rows, because nothing had ever been
 * DELIVERED to it. A message that never arrives leaves no trace anywhere: no
 * error, no failed row, no retry. Every log in the system says everything is
 * fine, because from each component's point of view it is.
 *
 * So this walks the whole path in the order a message travels it and stops
 * being vague about which half is broken:
 *
 *     Meta ──▶ webhook ──▶ WaRawEvent ──▶ WaMessage ──▶ worker draft ──▶ Outbox ──▶ Meta
 *
 * Each check prints OK, a warning, or a line saying what to do. It reads and
 * writes nothing except the rows it counts, so it is safe to run on a shop's
 * live database in the middle of a day.
 *
 * It deliberately does NOT print a secret. Whether one is SET is a diagnosis;
 * what it is, is not.
 */

import { db, disconnect, type PrismaClient } from "@nusantara/db";
import { agentCapabilities } from "@nusantara/agent";

type Level = "ok" | "warn" | "fail";

interface Check {
  readonly level: Level;
  readonly title: string;
  /** What to do about it, when there is something to do. */
  readonly fix?: string;
}

const MARK: Record<Level, string> = { ok: " ok ", warn: "warn", fail: "FAIL" };

/** Is this variable set to something other than a placeholder? */
function isSet(value: string | undefined): boolean {
  const v = value?.trim() ?? "";
  return v !== "" && v !== "CHANGE_ME";
}

const DAY_MS = 86_400_000;

export async function runDoctor(
  prisma: PrismaClient,
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): Promise<Check[]> {
  const out: Check[] = [];
  const since = new Date(now.getTime() - 7 * DAY_MS);

  // --- 1. can Meta reach us at all -----------------------------------------
  const raw = await prisma.waRawEvent.count();
  const rawRecent = await prisma.waRawEvent.count({
    where: { receivedAt: { gte: since } },
  });
  if (raw === 0) {
    out.push({
      level: "fail",
      title: "No webhook delivery has EVER arrived (WaRawEvent is empty)",
      fix:
        "Meta cannot reach this machine, or the 'messages' field is not subscribed.\n" +
        "      Publish the webhook:  sudo /opt/nusantara/current/ops/whatsapp-funnel up\n" +
        "      then paste the URL it prints into Meta → WhatsApp → Configuration,\n" +
        "      press Verify, and SUBSCRIBE to the 'messages' field. A URL that\n" +
        "      verifies with no subscription delivers nothing, silently.",
    });
  } else if (rawRecent === 0) {
    out.push({
      level: "warn",
      title: `${raw} deliveries in total, none in the last 7 days`,
      fix: "Either nobody has messaged the shop, or the callback URL has changed since it last worked.",
    });
  } else {
    out.push({
      level: "ok",
      title: `${rawRecent} webhook deliveries in the last 7 days (${raw} in total)`,
    });
  }

  // --- 2. the endpoint's own fail-closed configuration ----------------------
  for (const [key, why] of [
    ["APP_SECRET", "every inbound event is rejected with 401 without it"],
    ["VERIFY_TOKEN", "the Meta handshake answers 503 without it"],
  ] as const) {
    out.push(
      isSet(env[key])
        ? { level: "ok", title: `${key} is set` }
        : {
            level: "fail",
            title: `${key} is not set — ${why}`,
            fix: "Set it in /opt/nusantara/etc/webhook.env and restart the webhook.",
          },
    );
  }

  // --- 3. did the deliveries become messages -------------------------------
  const messages = await prisma.waMessage.count({
    where: { direction: "IN", ts: { gte: since } },
  });
  if (raw > 0 && messages === 0) {
    out.push({
      level: "fail",
      title: "Deliveries arrived but no inbound message was stored",
      fix: "Look for evt=webhook.inbound.failed in /opt/nusantara/logs/webhook.log.",
    });
  } else if (raw > 0) {
    out.push({
      level: "ok",
      title: `${messages} inbound message(s) stored in the last 7 days`,
    });
  }

  // --- 4. is anything waiting for the bot ----------------------------------
  const waiting = await prisma.waMessage.count({
    where: { direction: "IN", status: "BARU" },
  });
  const stale = await prisma.waMessage.count({
    where: {
      direction: "IN",
      status: "BARU",
      ts: { lt: new Date(now.getTime() - 600_000) },
    },
  });
  if (stale > 0) {
    out.push({
      level: "fail",
      title: `${stale} message(s) have waited more than ten minutes unanswered`,
      fix:
        "The worker is not draining them. Check it is running:\n" +
        "      sudo launchctl print system/local.nusantara.worker | head -5\n" +
        "      and read /opt/nusantara/logs/worker.log for evt=worker.draft.no_reply.",
    });
  } else {
    out.push({
      level: "ok",
      title: `${waiting} message(s) waiting for the bot, none of them stale`,
    });
  }

  // --- 5. can the bot think ------------------------------------------------
  const hasModel =
    isSet(env["ANTHROPIC_API_KEY"]) || isSet(env["ANTHROPIC_AUTH_TOKEN"]);
  out.push(
    hasModel
      ? { level: "ok", title: "An Anthropic credential is set" }
      : {
          level: "fail",
          title: "No Anthropic credential — the draft pass is dormant",
          fix: "Set ANTHROPIC_API_KEY in /opt/nusantara/etc/worker.env.",
        },
  );

  const answers = await prisma.agentKnowledge.count({
    where: { active: true },
  });
  out.push(
    answers > 0
      ? { level: "ok", title: `${answers} approved answers loaded` }
      : {
          level: "fail",
          title: "The knowledge base is empty — every question hands over",
          fix: "sudo -u _nusantara /opt/nusantara/current/ops/run knowledge <file> --by ersen",
        },
  );

  // --- 6. what the bot is allowed to do ------------------------------------
  const can = agentCapabilities(env);
  const mode = env["AGENT_CAPABILITIES"]?.trim().toLowerCase();
  out.push({
    level: "ok",
    title: !can.stock
      ? "AGENT_CAPABILITIES=parallel — the bot answers from the approved sheet and hands every unit question over"
      : can.reserve
        ? "AGENT_CAPABILITIES=live — unless a switch on /chat says otherwise, the bot reads stock and prices, sends unit photos and may book a hold"
        : `${mode ? `AGENT_CAPABILITIES=${mode}` : "AGENT_CAPABILITIES unset"} — the POS is the source of truth: unless a switch on /chat says otherwise, the bot reads stock and prices and sends unit photos; bookings stay off`,
    ...(can.stock
      ? {}
      : {
          fix: "Unset AGENT_CAPABILITIES in /opt/nusantara/etc/worker.env once this database holds the shop's real stock.",
        }),
  });

  // --- 7. can the bot speak ------------------------------------------------
  // Baileys mode (2026-10-22) sends through apps/wa-gateway and has no token;
  // whether the device is LINKED is on /chat → Settings, not in this file.
  const baileys = env["WHATSAPP_TRANSPORT"]?.trim().toLowerCase() === "baileys";
  out.push(
    baileys
      ? isSet(env["WA_GATEWAY_URL"]) && isSet(env["WA_GATEWAY_SECRET"])
        ? {
            level: "ok",
            title:
              "WHATSAPP_TRANSPORT=baileys — replies go through the WhatsApp gateway",
            fix: "Check the device is linked: Chatbot → Settings → WhatsApp connection.",
          }
        : {
            level: "fail",
            title:
              "WHATSAPP_TRANSPORT=baileys without the gateway's URL and secret — replies queue and never send",
            fix: "Set WA_GATEWAY_URL and WA_GATEWAY_SECRET in /opt/nusantara/etc/worker.env (docs/whatsapp-baileys.md).",
          }
      : isSet(env["WHATSAPP_TOKEN"]) && isSet(env["PHONE_NUMBER_ID"])
        ? { level: "ok", title: "A WhatsApp send credential is set" }
        : {
            level: "fail",
            title: "No WhatsApp credential — replies queue and never send",
            fix: "Set WHATSAPP_TOKEN and PHONE_NUMBER_ID in /opt/nusantara/etc/worker.env.",
          },
  );

  const pending = await prisma.outbox.count({ where: { status: "PENDING" } });
  const failedRows = await prisma.outbox.count({ where: { status: "FAILED" } });
  if (failedRows > 0) {
    out.push({
      level: "warn",
      title: `${failedRows} outbox row(s) have exhausted their retries`,
      fix: 'Read their lastError: select kind, "lastError" from "Outbox" where status = \'FAILED\' order by "createdAt" desc limit 5;',
    });
  }
  if (pending > 20) {
    out.push({
      level: "warn",
      title: `${pending} replies are queued and not sending`,
      fix: "Usually a missing or expired WHATSAPP_TOKEN. The queue drains by itself once one is set.",
    });
  } else {
    out.push({ level: "ok", title: `${pending} reply/replies queued` });
  }

  return out;
}

async function main(): Promise<number> {
  const checks = await runDoctor(db(), process.env);
  for (const c of checks) {
    console.log(`[${MARK[c.level]}] ${c.title}`);
    if (c.fix) console.log(`      → ${c.fix}`);
  }
  const bad = checks.filter((c) => c.level === "fail").length;
  console.log(
    bad === 0
      ? "\nNothing is stopping the chatbot from working."
      : `\n${bad} thing(s) are stopping the chatbot from working.`,
  );
  return bad === 0 ? 0 : 1;
}

if (process.argv[1]?.includes("chatbot-doctor")) {
  main()
    .then(async (code) => {
      await disconnect();
      process.exit(code);
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      await disconnect();
      process.exit(1);
    });
}

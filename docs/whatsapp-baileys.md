# WhatsApp through a linked device (Baileys) — 2026-10-22

**Owner decision, 2026-10-22:** the chatbot runs on WhatsApp via Baileys in
production, linked by scanning a QR inside the POS. Only ONE linked session at
a time. The Cloud API path keeps working, unchanged, whenever the transport is
not Baileys.

## What it is

`apps/wa-gateway` is a small process on the Mac mini that is a **linked
device** of the shop's WhatsApp number — the same thing WhatsApp Web on a
laptop is. It speaks WhatsApp Web's protocol through
[Baileys](https://github.com/WhiskeySockets/Baileys) (`baileys@7.0.0-rc14`, the
version `tools/wa-local` already used) and listens on `127.0.0.1:3002` only.

```
phone ─▶ WhatsApp ─▶ wa-gateway ─▶ POST /webhook (signed, as Meta) ─▶ WaMessage ─▶ worker draft
                                                                                       │
phone ◀─ WhatsApp ◀─ wa-gateway ◀─ POST /graph/…/messages (Graph's shape) ◀── worker ◀─ Outbox
```

Only the two ends change. The webhook, its signature check, the worker loop,
routing, the reply check, the outbox and its retries are the code the Cloud
API path runs:

- **Inbound:** each 1:1 message is re-shaped into the delivery Meta would have
  POSTed and signed with the webhook's own `APP_SECRET`. Groups, status
  updates, channels and the number's own messages are never read. A LID is
  resolved to the phone number behind it, and replies go back to the LID.
- **Outbound:** with `WHATSAPP_TRANSPORT=baileys` the worker's Graph requests
  go to the gateway instead of graph.facebook.com (`gatewayFetch` in
  `@nusantara/whatsapp`): same body, the bearer token dropped, the gateway's
  secret added. Each reply shows "typing…" first and is spaced out per chat
  and for the whole number, so it reads as a person.
- **Photos a customer sends** arrive as `type: "image"` with their caption,
  exactly as from Meta, and the bytes are not downloaded — the webhook never
  stored Cloud media either, and a customer's photo goes to a person anyway.
  Staff see it on the shop's phone.

## The risk — read this before linking

**This is not an official WhatsApp API.** Meta does not offer WhatsApp Web's
protocol to businesses, and a number driven this way **can be banned**. What
makes that likely:

- **Linking and unlinking repeatedly.** A number that keeps pairing new
  devices looks like a number being abused. Link once and leave it. The
  gateway allows **three link attempts an hour** and the POS says how many are
  left.
- **Two sessions at once.** Only one gateway may hold the session. The gateway
  refuses to link while a session is connected, stops (rather than fights)
  when the session is opened somewhere else, and refuses to start anywhere but
  prod. Never copy `/opt/nusantara/var/wa-gateway` to another machine, and
  never run `tools/wa-local` with the shop's number.
- **A personal number.** Prefer a dedicated number for the shop.
- **An idle phone.** The phone stays the primary device: keep it switched on
  and online. WhatsApp unlinks a device whose phone has been away for about
  **14 days**.

The screen says all of this, permanently, above the Link button.

## One-time setup on the Mac mini

Done once, as an admin, after a release that contains `apps/wa-gateway` is
live. Every secret is generated on the Mac mini and never leaves it.

1. **Re-run the deploy installer** — it is root-owned and a release can never
   replace it, and installer **3** is the first that restarts and
   health-checks the gateway on a deploy (the pipeline warns until this is
   done):

   ```bash
   scp deploy/macmini/ops/nusantara-deploy deploy/macmini/ops/setup-deploy-access <admin>@nusantara-mini:/tmp/
   ssh -t <admin>@nusantara-mini "sudo zsh /tmp/setup-deploy-access '$(cat ~/nusantara-deploy-key.pub)'"
   ssh -i ~/nusantara-deploy-key nusantara-deploy@nusantara-mini status   # installer=3
   ```

   (Use the deploy key's PUBLIC half as in `docs/deploy-pipeline.md` §2; if
   the private key is only in GitHub, pass the public key line you kept.)

2. **The state directory**, outside the release so a deploy never unlinks the
   number:

   ```bash
   sudo install -d -m 700 -o _nusantara -g staff /opt/nusantara/var/wa-gateway
   ```

3. **The gateway's env file** — copy `ops/env/wa-gateway.env.example`:

   ```bash
   SECRET=$(openssl rand -hex 32)
   F=/opt/nusantara/etc/wa-gateway.env
   sudo cp /opt/nusantara/current/ops/env/wa-gateway.env.example "$F"
   sudo sed -i '' "s|^WA_GATEWAY_SECRET=.*|WA_GATEWAY_SECRET='$SECRET'|" "$F"
   # APP_SECRET: the SAME value as in webhook.env, or every delivery is refused.
   APP=$(sudo sed -n "s/^APP_SECRET=//p" /opt/nusantara/etc/webhook.env)
   sudo sed -i '' "s|^APP_SECRET=.*|APP_SECRET=$APP|" "$F"
   sudo chown _nusantara:staff "$F" && sudo chmod 600 "$F"
   ```

   The webhook must be running (`local.nusantara.webhook`) — it is what
   writes the messages. It needs `APP_SECRET`; `VERIFY_TOKEN` and the Tailscale
   Funnel are only for Meta and are not needed in this mode.

4. **The API and the worker get the same secret** (append to both, mode 600):

   ```bash
   printf "WA_GATEWAY_URL='http://127.0.0.1:3002'\nWA_GATEWAY_SECRET='%s'\n" "$SECRET" \
     | sudo tee -a /opt/nusantara/etc/api.env >/dev/null
   printf "WHATSAPP_TRANSPORT='baileys'\nWA_GATEWAY_URL='http://127.0.0.1:3002'\nWA_GATEWAY_SECRET='%s'\n" "$SECRET" \
     | sudo tee -a /opt/nusantara/etc/worker.env >/dev/null
   unset SECRET APP
   ```

   `WHATSAPP_TOKEN` is not read in this mode (it can stay in worker.env for a
   rollback).

5. **The worker logs in as `nusantara_agent`** — `docs/worker-agent-role.md`,
   all of it, if it has not been done. The worker refuses to start in prod as
   any other role.

6. **An Anthropic Console API key** in worker.env (`ANTHROPIC_API_KEY`). A
   Claude Pro/Max login cannot run the bot. Without a key the rules bot
   answers and the AI fallback is a person (CLAUDE.md, 2026-10-21).

7. **Load the services** — the gateway, then restart the API and (load or
   restart) the worker:

   ```bash
   for s in wa-gateway; do
     sudo install -m 644 -o root -g wheel /opt/nusantara/current/ops/launchd/local.nusantara.$s.plist /Library/LaunchDaemons/
     sudo launchctl bootstrap system /Library/LaunchDaemons/local.nusantara.$s.plist
   done
   sudo launchctl kickstart -k system/local.nusantara.api
   sudo launchctl kickstart -k system/local.nusantara.worker   # or bootstrap it, if never loaded
   curl -fsS http://127.0.0.1:3002/health                      # {"status":"ok","app":"wa-gateway"}
   tail -n 20 /opt/nusantara/logs/wa-gateway.log
   ```

   From then on every deploy restarts it (installer 3). A restart does NOT
   unlink: the session is in the state directory.

## Linking — scanning the QR

1. Sign in to the POS as the owner → **Chatbot → Settings → WhatsApp
   connection**. (Staff do not see the card.)
2. Press **Link WhatsApp**. A QR appears within a few seconds.
3. On the shop's phone: **WhatsApp → Settings → Linked devices → Link a
   device**, and scan it. The QR refreshes itself for about a minute; if
   nobody scans it the card says so and the attempt still counts.
4. The card turns to **Connected**, with the number and the time.
5. Send the shop a message from another phone and see it on /chat.

Check the whole path with `sudo -u _nusantara /opt/nusantara/current/ops/run
chatbot`, which reads the transport from worker.env.

**Disconnect** (behind a confirm) unlinks the device and deletes the session
files. Unlinking from the phone's Linked devices screen does the same from the
other side; the card then says the device was removed.

## Rolling back to the Cloud API

Nothing in the database changes between the two modes, so the switch is
configuration only:

```bash
sudo sed -i '' '/^WHATSAPP_TRANSPORT=/d' /opt/nusantara/etc/worker.env   # back to cloud
# WHATSAPP_TOKEN and PHONE_NUMBER_ID must be in worker.env again
sudo launchctl kickstart -k system/local.nusantara.worker
# Unlink first (POS → Disconnect), then stop the gateway for good:
sudo launchctl bootout system/local.nusantara.wa-gateway
sudo rm /Library/LaunchDaemons/local.nusantara.wa-gateway.plist
sudo /opt/nusantara/current/ops/whatsapp-funnel up    # Meta must reach the webhook again
```

and re-register the callback in Meta (`docs/chatbot-runbook.md` §2–3). Replies
already queued in the Outbox are sent by whichever transport is configured
when the worker claims them.

## Where things are

| | |
|---|---|
| `apps/wa-gateway/src/session.ts` | the one session: link, resume, reconnect, logout, sends, inbound |
| `apps/wa-gateway/src/delivery.ts` | what the webhook receives, and its signature |
| `apps/wa-gateway/src/graph.ts` | the Graph shapes it accepts and answers |
| `apps/wa-gateway/src/limits.ts` | link ration, send pacing, upload store |
| `apps/wa-gateway/src/baileysSocket.ts` | the only file that imports Baileys |
| `packages/whatsapp/src/gateway.ts` | `gatewayFetch` — the worker's rewrite |
| `apps/worker/src/config.ts` | `WHATSAPP_TRANSPORT`, `sendFetchFor` |
| `apps/api/src/routes/whatsapp.ts` | `/api/whatsapp/connection`, owner-only, audited |
| `apps/web/src/routes/chatbot/WhatsAppConnection.tsx` | the card |
| `deploy/macmini/ops/launchd/local.nusantara.wa-gateway.plist` | the service |
| `/opt/nusantara/var/wa-gateway/` | `auth/` (the session) and `jids.json` (number → LID) |
| `/opt/nusantara/logs/wa-gateway.log` | its log; the QR is never written there |

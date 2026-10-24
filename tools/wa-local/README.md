# wa-local — test the chatbot from a real WhatsApp chat, on this laptop

**Local testing only.** Baileys speaks WhatsApp Web's protocol, which Meta does
not offer as an API; an account driven this way can be restricted, so link a
spare number rather than the shop's. Production uses the Cloud API
(`docs/chatbot-runbook.md`). This folder is outside the pnpm workspace on
purpose: it is in no lockfile CI installs and in no release.

## Once

```bash
pnpm install && pnpm --filter @nusantara/db generate
(cd tools/wa-local && pnpm install --ignore-workspace)

export DATABASE_URL=postgresql://nusantara@localhost:5432/nusantara_pos_chatbot
createdb -h localhost -U nusantara nusantara_pos_chatbot
pnpm --filter @nusantara/db exec prisma migrate deploy
pnpm --filter @nusantara/db seed                          # the demo shop
API_ENV_FILE=/dev/null pnpm --filter @nusantara/api accounts --owner ersen
API_ENV_FILE=/dev/null pnpm --filter @nusantara/api knowledge "$PWD/docs/chatbot/knowledge-2026-09-18.md" --by ersen
```

## Every time

```bash
tools/wa-local/up      # POS :3000, API :4000, webhook :3001, link page :3099
tools/wa-local/down
```

1. Open <http://127.0.0.1:3099>, scan the QR from the phone that will play the
   shop (WhatsApp → Linked devices → Link a device).
2. Add the number that will play the customer to the allow-list. **The bot
   answers nobody else** — a linked account receives every chat that account
   receives, and without the list it would answer all of them.
3. Message the linked number from the customer's phone.
4. Sign in to <http://localhost:3000> (`ersen` / `password`, changed on first
   sign-in) and open Chatbot: the four switches, the inbox, the hand-overs and
   the answer sheet are all there.

Never run `pnpm dev` beside it: that starts the ordinary worker, which loads
the real Meta token and would answer the same queue from the shop's number.

## What is real and what is not

Real: the webhook (signature check included), the worker loop, routing,
retrieval, the reply check, hand-overs, the switches, bookings, photos.

Replaced: Meta's delivery to the webhook, and the worker's calls to
`graph.facebook.com`, which `src/main.ts` answers through the worker's
`fetchImpl` seam and turns into Baileys sends. The shop's `WHATSAPP_TOKEN` is
never loaded; only the Anthropic credential is read from the secrets file.

State — the linked session, the allow-list, the local webhook secret, logs —
is in `.state/`, gitignored. Delete `.state/auth` to force a new QR.

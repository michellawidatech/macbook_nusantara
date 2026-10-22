# Getting the chatbot to answer

Owner report, 2026-09-21: *"Make the chatbot works Idk why it did not receive
my message."*

This is the diagnosis, the fix, and what the bot does once it is answering.
The design is [chatbot-rag.md](./chatbot-rag.md); this is the wiring.

> **2026-10-22:** the shop's number can also be a device linked to the POS
> (Baileys, `WHATSAPP_TRANSPORT=baileys`) instead of the Cloud API. In that
> mode Meta, the Funnel and steps 2–3 below do not apply; the webhook still
> does. [whatsapp-baileys.md](./whatsapp-baileys.md) is that runbook.

## What was actually wrong

Nothing in the code. Measured on the development database on 2026-09-21:

| | |
|---|---|
| `WaRawEvent` | **0 rows** |
| `WaMessage` | 0 rows |
| `Outbox` | 0 rows |
| `AgentKnowledge` | 31 rows, loaded |
| webhook on :3001 | running, `/health` answering |

Zero raw events means **no delivery from Meta has ever arrived**. Everything
downstream of that — the persist step, the draft pass, the outbox — had nothing
to do and said so by being silent. That is the failure mode worth naming: a
message that never arrives leaves no error anywhere, because from every
component's point of view the system is idle and healthy.

The cause is the network shape. The webhook listens on `127.0.0.1:3001`. Caddy
serves the POS on `:8080` and `tailscale serve` publishes that **over the
tailnet**, privately, to the shop's own devices. Meta is not on the tailnet.
There was no public HTTPS address for it to POST to.

## The fix, in order

Run these on the Mac mini. Each step is checkable before the next.

### 1. The webhook is running and configured

```
sudo launchctl print system/local.nusantara.webhook | head -5
curl -fsS http://127.0.0.1:3001/health
```

`/opt/nusantara/etc/webhook.env` needs `APP_SECRET` and `VERIFY_TOKEN` from the
Meta app. The endpoint **fails closed**: with no `APP_SECRET` every inbound
event is refused with 503, and there is deliberately no development bypass —
this endpoint drives an agent that sends from the shop's verified number.

### 2. Publish it, and only it

```
sudo /opt/nusantara/current/ops/whatsapp-funnel up
```

That maps one path through Tailscale Funnel:

```
443   tailscale serve    the whole POS   TAILNET ONLY
8443  tailscale funnel   /webhook        PUBLIC
```

The POS, `/api`, the store and the sign-in form stay where only the tailnet
reaches them. Funnel only listens on 443, 8443 or 10000 — Tailscale's own rule
— which is why the callback URL carries a port.

Two things must be true in the tailnet first, and the command says so if they
are not: Funnel enabled for this node in the policy file
(`"nodeAttrs": [{"target": ["tag:prod"], "attr": ["funnel"]}]`), and HTTPS
certificates enabled for the tailnet.

### 3. Register it with Meta

The command prints the URL. In **Meta → WhatsApp → Configuration**:

1. Paste the callback URL and the `VERIFY_TOKEN`.
2. Press **Verify and save**. The handshake is a `GET`; the log line is
   `evt=webhook.verified` in `/opt/nusantara/logs/webhook.log`.
3. **Subscribe to the `messages` field.**

Step 3 is the one that is easy to miss and impossible to notice: a callback URL
that verifies but has no field subscription delivers nothing, for ever, with no
error on either side.

### 4. Ask it

```
sudo -u _nusantara /opt/nusantara/current/ops/run chatbot
```

`chatbot` walks the whole path in the order a message travels it and says which
half is broken:

```
Meta ─▶ webhook ─▶ WaRawEvent ─▶ WaMessage ─▶ worker draft ─▶ Outbox ─▶ Meta
```

It reports whether a secret is **set**, never what it is, and writes nothing.
Run it after sending yourself a test message from a phone that is not the
shop's own number.

## What the bot may do

Since 2026-09-29: **four switches on /chat** — Stock, Price, Reservations,
Photos — stored as `AppSetting` rows and changed by the owner on the page; the
worker reads them at the start of every pass. `AGENT_CAPABILITIES` in
`/opt/nusantara/etc/worker.env` is only the answer for a switch nobody has
pressed (`capabilitiesFromSettings`, packages/agent/src/policy.ts). Price,
Reservations and Photos each need Stock on. A switch that is off sends its
kind of question to a person, with an action item on the chat. The table
below is the two extremes: every switch off, and every switch on.

| | unset (the default) | `live` |
|---|---|---|
| the owner's approved answers | ✅ | ✅ |
| shop facts, hours, payment methods | ✅ | ✅ |
| what configurations a model comes in | ✅ | ✅ |
| **is this unit in stock, and what does it cost** | → a person | ✅ |
| **the unit's grade, battery, condition** | → a person | ✅ |
| **the shop's own photos of a unit** | → a person | ✅ |
| **book a hold** | → a person | ✅ |
| pick something for a stated budget | → a person | ✅ |
| negotiation, a discount, a best price | → a person | → a person |
| a payment made, an order or delivery status | → a person | → a person |
| trade-in and buy-back quotes, shipping quotes | → a person | → a person |
| complaints, faults, warranty, returns | → a person | → a person |
| a photo the CUSTOMER sent | → a person | → a person |
| checking, moving, cancelling a booking | → a person | ✅ |

**The default is the cautious one, deliberately.** The live design is right
only once the stock in this database is the shop's real stock; a variable
nobody set should not be what decides that a bot is quoting prices off a
half-migrated shelf. A value the code does not recognise also reads as
cautious.

`live` is the owner's 2026-09-21 ask — *"the chatbot can send pictures per unit
and get detail about a unit, and the only write operation is to make a
reservation"* — so set it on the day the migration lands and the shelf is real.

### What does not change either way

- **A figure the cited source does not state is never sent.** `checkReply`
  compares every rupiah amount and every "ready" in a draft against the text of
  the sources it cited. With `live` the stock lookups are a source, so a price
  that came from one passes; a price that came from the model's memory does
  not, and the turn becomes a hand-over.
- **Every turn ends in `reply` or `handoff_to_staff`**, under
  `tool_choice: any`. A free-text answer with nothing behind it cannot happen.
- **Anything a customer writes is data.** A message telling the bot to ignore
  its rules is answered normally and obeyed in nothing.

## Photos

`unit_photos(serial)` returns **handles**, never bytes and never a URL, and the
model passes them to `reply` as `photos`. The draft transaction queues one
`WA_IMAGE` outbox row per handle, after the reply. The worker reads the bytes
from `UnitNotePhoto.data` at send time, uploads them to Graph's media endpoint
and sends the media id.

Three properties fall out of that shape, and all three are the reason for it:

- **The model never sees an image**, so it cannot be talked into describing
  one, and the prompt cache never carries a photograph.
- **Only handles `unit_photos` offered this turn are accepted.** A model asked
  for a list of ids will sometimes produce a plausible-looking one, and the
  cost of an invented handle is the shop sending a stranger a picture of a
  machine nobody asked about.
- **Nothing is published.** A `link` send would mean every QC photograph living
  at a guessable public address; an upload pushes the bytes over the connection
  the worker already has, which is also the only thing that CAN work behind
  Tailscale.

At most three photos per answer, and only for a unit that is still sellable: a
sold machine's pictures are a record of what the shop shipped, not a listing.

## The voice

The 2026-09-18 persona answered questions. The 2026-09-21 one sells, which is
the other half of the owner's ask — *"be more proactive, ask questions to
determine intent, and upselling a product"*:

- ask what it will be used for, what they have now, and roughly what they want
  to spend, one question at a time, never as a list;
- call `lookup_customer` first, so a returning customer is greeted by name and
  not asked what their last purchase already says;
- say **why** a machine fits what they described;
- offer **one** step up, saying what the difference buys, and drop it if they
  say no;
- mention a charger or a case once, at the end.

What did not come back is the closing pressure of the pre-2026-09-18 voice.
"Mau aku pegangin dulu?" on every machine is a shop that feels like a funnel,
and the owner's own approved answers do not sound like that.

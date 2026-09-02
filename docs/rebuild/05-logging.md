# Logging

Four layers, three destinations, one correlation id. The change from the current
build: **HTTP logs leave the application database.** `HttpLog` grew unbounded in
the same Postgres the cashier depends on, which means a burst of traffic
competed with checkout for I/O and the retention job competed with everything.

---

## 1. The four layers

| Layer | Question it answers | Destination | Retention |
|---|---|---|---|
| **Access** | What HTTP traffic happened? | Log sink (NDJSON) | 30 days |
| **Application** | What did the code do, and what broke? | Log sink (NDJSON) | 30 days |
| **Audit** | Who changed which record, from what to what? | `AuditLog` in Postgres | Forever |
| **Business events** | What happened to this serial / this order? | `UnitEvent`, `PriceLog`, `OrderAdjustment` | Forever |

The split is deliberate and it is the whole design:

> **Logs are diagnostics — sampled, truncated, redacted, expiring, and outside
> the app database. Audit and business events are data — complete, constrained,
> permanent, and inside it, subject to the same transaction as the change they
> describe.**

If you catch yourself asking "should this be a log or a table?", ask instead: *if
this row is missing in six months, is that an inconvenience or a dispute?*
Inconvenience → log. Dispute → table.

---

## 2. The sink

Applications write **NDJSON to stdout**. Nothing else. No app opens a file, no app
writes logs to Postgres, no app knows where logs end up.

```
apps/*  ──stdout(NDJSON)──►  pino-roll / systemd-journald  ──►  /var/log/nusantara/*.ndjson
                                                            └──►  (optional) Loki + Grafana
```

**Why stdout.** It works identically under `pnpm dev`, systemd, Docker and a
future hosted runtime; log shipping becomes an ops decision rather than a code
change; and a logging outage can never take down a checkout, because there is no
logging I/O in the request path to fail.

**Library: `pino`.** Fast enough that structured logging is not a latency
decision. `packages/logging` keeps its current public shape — `requestLogger()`
and the outbound wrapper — so app code does not change; only `store.ts` is
replaced, swapping `prisma.httpLog.create` for a pino transport.

**Minimum viable ops.** File rotation (100 MB × 7, gzipped) satisfies the whole
requirement. Loki/Grafana is an upgrade you take when you actually want
dashboards, not a prerequisite.

### The record shape

Every line, every app, no exceptions:

```jsonc
{
  "t":   "2026-08-13T09:14:22.481Z",  // ISO-8601, UTC
  "lvl": "info",                       // trace|debug|info|warn|error|fatal
  "app": "api",                        // api | web | whatsapp-webhook | monitor | worker
  "env": "production",
  "rid": "01J8F9Q2K3M4N5P6",           // request id — the join key
  "sid": "clx3k9…",                    // staff id, when authenticated
  "msg": "checkout completed",
  "evt": "order.checkout",             // stable dotted name; grep target
  "dur": 412,                          // ms, when the record measures something
  "ctx": { "orderCode": "INV-2026-0912", "units": 2, "total": "12400000" },
  "err": { "type": "…", "msg": "…", "stack": "…" }  // errors only
}
```

Rules: `evt` names are **stable identifiers**, never sentences — you will grep
them. `msg` is for humans and may change freely. Money in `ctx` is a **string**
(BigInt does not survive `JSON.stringify`). Never log a whole entity; log its id
and the two or three fields that matter.

---

## 3. Correlation

One id, generated once, carried everywhere.

1. `apps/api` (and the webhook) generate `rid` per inbound request — ULID, so it
   sorts by time — unless the caller supplied `x-request-id`.
2. It is returned as `x-request-id` on every response.
3. The SPA stores it and sends it back as `x-correlation-id` on the next request,
   so a user-reported "it broke after I clicked save" links two requests.
4. `AsyncLocalStorage` carries it through the whole handler, so a log line five
   calls deep does not need it threaded as an argument.
5. Outbound calls (Graph API, Anthropic) log with the same `rid`.
6. **It is written to the durable rows too**: `UnitEvent.requestId`,
   `AuditLog.requestId`. That is the bridge — from a disputed stock movement you
   can reach the exact HTTP request that caused it, and from that request every
   log line of that operation.

Webhook events additionally carry `waMessageId` / `igCommentId` in `ctx`, because
Meta's redeliveries are the same message under a different request.

---

## 4. What each app logs

**`apps/api`** — one access record per request (`evt: "http.in"`) with method,
route *pattern* (`/api/penjualan/:code`, never the filled path — that leaks
codes into logs and explodes cardinality), status, duration, staff id. Plus a
domain record per meaningful operation: `order.checkout`, `unit.transfer`,
`po.received`, `opname.posted`, `price.changed`, `auth.login`, `auth.denied`.

**`apps/whatsapp-webhook`** — the highest-value logs in the system, because it is
the one component driven by someone else's traffic:

| `evt` | Level | When |
|---|---|---|
| `wa.event.received` | info | Signature verified, raw event persisted |
| `wa.event.rejected` | warn | Bad or missing signature — **includes source IP** |
| `wa.event.duplicate` | debug | Dedup hit on `waMessageId` |
| `wa.agent.categorized` | info | Intent + confidence + cache hit/miss |
| `wa.agent.replied` | info | Auto-reply sent, with latency and token counts |
| `wa.agent.handoff` | info | Escalated to staff, **with the reason** |
| `wa.send.failed` | error | Graph API rejected — code, subcode, retryable? |
| `ig.comment.received` / `ig.reply.sent` | info | Instagram equivalents |

Never log message *bodies* at `info`. Customer message text is PII; it lives in
`WaMessage.text` where it is access-controlled, not in a flat file. At `debug`,
in development only, a truncated preview is acceptable.

**`apps/web`** — errors only, batched to `POST /api/client-errors`
(rate-limited, 10/min/session): unhandled rejections, error-boundary catches,
failed mutations with their `rid`. No analytics, no click tracking. This app has
three users; product telemetry would be theatre.

**`worker`** (outbox) — one record per claim/send/retry/exhaust, with attempt
count and `nextAttemptAt`.

---

## 5. Levels

| Level | Use for | Example |
|---|---|---|
| `error` | A user-visible operation failed, or an invariant broke | checkout rolled back; ledger gap detected |
| `warn` | Handled, but someone should know | rejected webhook signature; Graph rate limit; reconciliation mismatch |
| `info` | Business-meaningful events | order completed, PO received, agent replied |
| `debug` | Development and incident-time detail | cache hits, dedup skips, query shapes |
| `trace` | Off in production | request/response bodies |

Production runs at `info`. `LOG_LEVEL` is env-driven and readable at runtime from
the Monitor app so you can drop to `debug` during an incident **without a
deploy** — and it reverts automatically after 30 minutes, because nobody ever
remembers to turn it back.

---

## 6. Redaction

The existing rules in `packages/logging/src/redact.ts` are the floor and carry
over unchanged:

- Headers dropped entirely: `authorization`, `cookie`, `set-cookie`,
  `x-hub-signature`, `x-hub-signature-256`, `x-api-key`, `proxy-authorization`.
- Body keys masked at any depth, matched as a substring on the normalised key:
  `password`, `secret`, `token`, `apikey`, `credential`, `otp`, `pin`, `cvv`,
  `cardnumber`, …
- Bodies truncated to `LOG_BODY_MAX_BYTES` (2 KB default).
- Query strings dropped from logged paths.

Added for the rebuild:

- **Phone numbers are masked to `+6281****4321`** in log records. The chatbot
  inbox is the place to read a phone number; a log file is not.
- Customer names and addresses are never logged — id only.
- The redaction unit tests get a case per rule, and a fixture that asserts a real
  Meta webhook payload emerges with no `x-hub-signature-256` and no message text.

---

## 7. Retention and volume

| Data | Retention | Mechanism |
|---|---|---|
| NDJSON access + app logs | 30 days | rotation, gzip, delete |
| `WaRawEvent` / `IgRawEvent` payloads | 30 days | nightly job; `WaMessage` keeps the normalised record |
| `AgentCache` | `expiresAt` | pruned on read + nightly sweep |
| `AuditLog`, `UnitEvent`, `PriceLog` | forever | never deleted; the DB role has no `DELETE` |
| Client error reports | 14 days | nightly job |

Sizing sanity check: ~2 000 requests/day at ~600 B/record is ≈ 1.2 MB/day, ≈ 36 MB
per retention window. This is small. It only became a problem before because it
lived in the transactional database.

---

## 8. Monitor app (`:4100`)

Read-only, owner-only, on its own port and its own read-only database role. It
must never be able to change POS data.

- **Traffic** — requests by app/status/route, p50/p95/p99 latency, error rate.
- **Errors** — grouped by `evt` + error type, most recent first, drill to the full
  record and then to every line sharing the `rid`.
- **Webhook health** — events received/rejected/duplicated, agent reply latency,
  handoff rate, outbox depth and oldest pending item. *This is the page you open
  when a customer says "the bot didn't answer".*
- **Integritas Data** — the eight reconciliation checks from
  [08 §6](08-data-integrity.md#6-reconciliation--proving-the-data-is-right), with
  last-run time and a Run now button.
- **Audit trail** — `AuditLog` search by staff, entity, date. Owner-only, and
  reading it is itself an audit event.

Access: the POS session cookie plus an explicit owner check. `MONITOR_TOKEN`
stays as a break-glass path for when the POS itself is down.

---

## 9. Alerting

Small shop, so the bar is "would you get out of bed for it". Everything else is a
dashboard.

| Condition | Channel |
|---|---|
| Webhook signature rejections > 10 in 5 min | WhatsApp to the owner |
| Outbox has an item older than 15 min | WhatsApp to the owner |
| Any reconciliation check fails | WhatsApp to the owner + Monitor banner |
| API 5xx rate > 2% over 5 min | WhatsApp to the owner |
| Unhandled rejection / process restart | WhatsApp to the owner |
| Disk > 85% | WhatsApp to the owner |

The alerter is a cron job querying the sink and the database. It sends through
the same outbox as everything else — and it must degrade to a log line if
WhatsApp is the thing that is broken.

---

## 10. Definition of done

- [ ] `packages/logging` writes NDJSON to stdout via pino; `HttpLog` is gone from the schema
- [ ] Every record carries `t/lvl/app/env/rid`; `evt` names are stable and documented
- [ ] `rid` flows request → response → next request → `UnitEvent.requestId` / `AuditLog.requestId`
- [ ] Redaction tests cover every header rule, every body key, and phone masking
- [ ] Route patterns are logged, never filled paths
- [ ] Rotation configured; a week of logs measured against the 36 MB estimate
- [ ] Monitor app reads from the sink and a read-only DB role, and cannot write
- [ ] `LOG_LEVEL` is changeable at runtime and self-reverts after 30 minutes
- [ ] Every alert in §9 has been fired once deliberately, in staging

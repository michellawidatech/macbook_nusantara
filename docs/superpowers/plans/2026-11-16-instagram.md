# Instagram — implementation plan (2026-11-16)

Spec: `docs/superpowers/specs/2026-11-16-instagram-design.md`. Branch
`michellawidatech/instagram` off `v2026.11.16.4`. TDD at every layer; WhatsApp
suites stay green and unchanged. Commit by name, several commits.

## 1. Domain — `packages/domain/src/chatChannel.ts`
- [ ] Thread key: `igThreadKey`, `igsidOf`, `isIgThread`, `channelOf`, `isThreadKey`.
- [ ] Outbox: `REPLY_KINDS`, `IMAGE_KINDS`, `outboxKindFor`.
- [ ] Window: `igReplyMode`, `igReplyModeClosesAt` (24 h / 7 d HUMAN_AGENT).
- [ ] Comments: `igPrivateReplyOpen`, `commentStatusAfterUnhide`.
- [ ] `splitForInstagram` (≤ 1000 UTF-8 bytes), `utf8Length`.
- [ ] 100 % coverage (the package's rule).

## 2. Database — `packages/db`
- [ ] Migration `20261116120000_instagram_dms_and_comments`: `IgContact`,
      `IgConnection`, `OutboxKind` + `IG_IMAGE`/`IG_PRIVATE_REPLY`/`IG_HIDE`,
      `ChatMedia_shape` relaxed, `wa_thread_delete` accepting `ig:` keys,
      grants per the spec's table.
- [ ] `schema.prisma` models + generate.
- [ ] `enqueueOutbox` stores by `outboxKindFor`; `claimOutbox(…, {kinds, exclude})`.
- [ ] `invariants.test.ts`: grants, `ChatMedia` shape, delete function on an
      `ig:` key; outbox tests for the kind mapping and the claim filter.

## 3. Instagram Graph client — `packages/instagram`
- [ ] `sendText`, `sendImageUrl`, `privateReply`, `replyToComment`,
      `setHidden`, `getProfile`, `getMedia`, `getMe`, `refreshToken`;
      Bearer header; `GRAPH_API_VERSION` the shared v25.0; `fetchImpl` seam;
      errors carry status + Meta's code, never the token.
- [ ] Tests with a fake fetch.

## 4. Webhook — `apps/whatsapp-webhook`
- [ ] `IG_APP_SECRET` second key, instagram-only (signature + config tests).
- [ ] `extractIgMessages`, `extractIgComments` (both shapes), pure tests from
      Meta's documented payloads.
- [ ] `persistInboundIg`: raw → messages (dedupe) → media stub + comment →
      auto-reply rows; `processedAt`. DB tests.
- [ ] `GET /webhook/media/:outboxId/:token`. Tests: right token serves bytes,
      wrong/expired/retracted/other kind 404.

## 5. Agent — `packages/agent`
- [ ] `phoneForms`/`toE164` refuse an `ig:` key; `remember_customer` writes no
      Customer for one.
- [ ] `staffAlertText` channel-aware (`@username`, encoded link).
- [ ] Readers of sent rows use `REPLY_KINDS`/`IMAGE_KINDS`.

## 6. Worker — `apps/worker`
- [ ] Config: `IG_ACCESS_TOKEN`, `IG_USER_ID`, `IG_MEDIA_PUBLIC_URL`,
      `IG_TOKEN_FILE`, `IG_TOKEN_REFRESHED_AT`.
- [ ] `sendPass` excludes `IG_*`; `igSendPass` sends them (tests with fake fetch).
- [ ] `igSyncPass`: contacts, media, `/me`, token refresh + env-file rewrite,
      comment alerts.
- [ ] Readers in draft/followUp/actions use the kind lists; follow-ups treat an
      Instagram thread as Cloud API; `queueStaffAlerts` names `@username`.
- [ ] A DB test: an Instagram DM is drafted and queued as `IG_DM`; outside 24 h
      it is handed over.

## 7. API — `apps/api`
- [ ] `phoneParam` → `isThreadKey` on every inbox route.
- [ ] `GET /api/inbox?channel=`; thread `channel`, `username`, Instagram window.
- [ ] Reply route: Instagram window + `HUMAN_AGENT` tag (`IG_HUMAN_AGENT`).
- [ ] Sent items include `IG_DM`/`IG_IMAGE`, never editable/unsendable.
- [ ] Picture route: JPEG/PNG only for Instagram.
- [ ] `/waiting` adds `comments`.
- [ ] `routes/instagram.ts`: comments list/actions, settings, connection.
- [ ] Tests per route.

## 8. Web — `apps/web`
- [ ] `lib/instagramApi.ts`; inbox client `channel` param.
- [ ] Chat: WhatsApp | Instagram switch; reply-box window copy; `@username`.
- [ ] `CommentsPanel` tab; `InstagramCard` in Settings (owner-only).
- [ ] Waiting notice + badge include comments.
- [ ] i18n (`id.ts`), tests; the full web suite once.

## 9. Ops & docs
- [ ] Env templates (webhook.env, worker.env, api.env).
- [ ] `docs/instagram-connect.md` — the owner's guide, citations, what is
      unverified.
- [ ] CLAUDE.md entry.

## Checks
`pnpm -r typecheck`; agent, db (store + invariants), api, worker, webhook on a
private DB (`nus_ig_test`, one vitest at a time); web affected files then the
full suite; prettier + eslint on changed files.

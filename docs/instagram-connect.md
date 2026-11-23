# Connecting the shop's Instagram to the POS

> **2026-11-23 — read this first.** Meta no longer offers a new app "API
> setup with Instagram login"; it offers **Unified login** only, and that is
> what the shop's app (**Macbook Nusantara POS**, 1881665036340787) uses. Its
> token starts `EAA`, and the POS handles it since v2026.11.23: it talks to
> graph.facebook.com, never refreshes the token, and subscribes the account
> to the webhooks by itself. What changes below: use the new app, not
> 2157052578394015; in step 1 press *Create from template* on the login
> configuration; `IG_APP_SECRET` is the new app's **App Secret** (App settings
> → Basic); skip the `curl … subscribed_apps` in step 3.4; and the
> Instagram card's "token expires" stays unknown — this token does not
> expire on a schedule.

For the owner. It takes about an hour the first time, most of it in Meta's
dashboard. When it is done, Instagram DMs appear in **Chatbot → Chat →
Instagram**, the bot answers them like WhatsApp chats, and comments appear in
**Chatbot → Comments**.

Things marked **⚠️ not verified** are written from Meta's documentation (read
on 2026-11-16) but could not be tried without the shop's own account. Each one
says how to check it.

---

## 0. What you need before you start

1. **The shop's Instagram account is a professional account** — Business (or
   Creator). Instagram app → Settings → *Account type and tools*. With the
   method used here (*Instagram API with Instagram Login*) **no Facebook Page
   is needed**. [Overview][overview]
2. **The account is public.** Meta only sends comment notifications for public
   accounts. [Webhooks][webhooks]
3. **You can open the Meta app 2157052578394015** at
   <https://developers.facebook.com/apps/> — it is the same app WhatsApp uses.
   You must be an admin (or developer) of the app.
4. **The webhook is already published** for WhatsApp. On the Mac mini:

   ```
   sudo /opt/nusantara/current/ops/whatsapp-funnel status
   ```

   It prints the callback URL, something like
   `https://<the-mac-mini>.ts.net:8443/webhook`. If it is not up, run
   `sudo /opt/nusantara/current/ops/whatsapp-funnel up` (docs/chatbot-runbook.md).
5. A **second Instagram account** (yours, a colleague's) to test with — you
   cannot DM yourself.

---

## 1. Add Instagram to the Meta app

1. Open the app in the dashboard → **Add product** (or *Use cases* → *Add use
   case*) → **Instagram** → choose **API setup with Instagram login**.
   [Create an Instagram app][create]
2. Under **Permissions**, make sure these three are added (the old names
   without `business_` stopped working on 2025-01-27): [Overview][overview]
   - `instagram_business_basic`
   - `instagram_business_manage_messages` — DMs
   - `instagram_business_manage_comments` — comments
3. Note the **Instagram app secret** shown on the same page (*Business login
   settings*). It is NOT the same as the Meta app's App Secret. You may need
   it in step 4. [Business Login][bizlogin]

### App Review — what works before it

- **Standard access** (no review) is enough when the app is used only for
  accounts the people with a role on the app own or manage — which is the
  shop's case. Add the shop's Instagram account as an **Instagram tester**
  (App roles → Roles → Instagram testers) and accept the invite in the
  Instagram app (Settings → *Apps and websites* → *Tester invites*).
  [App Review][review]
- ⚠️ **not verified:** Meta's webhook page says the app must be **Live
  (published)** to receive notifications, and lists **Advanced Access** for the
  `comments` field. [Webhooks][webhooks] Try development mode first (step 6);
  if a test DM arrives but comments do not, switch the app to Live (App
  settings → Basic → *App mode*) and, if Meta still holds comments back,
  request Advanced Access for `instagram_business_manage_comments` through
  App Review (it asks for a screencast and Business Verification).
- **Replying after 24 hours** needs Meta's **Human Agent** feature, which only
  App Review grants. Without it, Instagram lets the shop reply only within 24
  hours of the customer's last message — the POS says so in the reply box.
  [Overview][overview], [Messaging API][messaging]

---

## 2. Get the token

1. In **API setup with Instagram login** → *Generate access tokens* → **Add
   account** → log in as the shop's Instagram account → allow everything.
2. Press **Generate token** next to the account and copy it. Tokens made in the
   dashboard are long-lived: **60 days**. [Get started][getstarted]
3. Note the account's **ID** shown beside it. That is the `IG_USER_ID`. ⚠️ If
   unsure, the worker checks it: its log line `worker.ig.account_mismatch`
   says when the ID does not belong to the token.

The token is a password to the shop's Instagram. Paste it only into the env
file in step 4 — never into a chat, an email, a document or a screenshot.

**You do not have to renew it every 60 days.** The worker refreshes it every 7
days by itself and writes the new one back into the file (Meta allows a
refresh once a token is a day old). [Refresh][getstarted] If the worker is
stopped for more than 60 days, generate a new one here.

---

## 3. Point Meta at the webhook

Still in **API setup with Instagram login** → **Configure webhooks**:

1. **Callback URL:** the URL from step 0.4 (ending in `/webhook`).
2. **Verify token:** the `VERIFY_TOKEN` value in
   `/opt/nusantara/etc/webhook.env` on the Mac mini (the same one WhatsApp
   uses). Press **Verify and save**. The webhook log
   (`/opt/nusantara/logs/webhook.log`) shows `evt=webhook.verified`.
3. **Subscribe** to the fields **`messages`** and **`comments`**. Without the
   subscription the URL verifies and nothing is ever delivered.
4. Some setups also need the account itself subscribed. In a Terminal on any
   computer (replace the two values; this is the one time the token is typed
   in a command — clear the Terminal afterwards):

   ```
   curl -X POST "https://graph.instagram.com/v25.0/me/subscribed_apps?subscribed_fields=messages,comments&access_token=PASTE_TOKEN"
   ```

   It answers `{"success":true}`. [Webhooks][webhooks]

---

## 4. Put the values on the Mac mini

The env files are in `/opt/nusantara/etc/`, owned by `_nusantara`, mode 600.
Edit them with `sudo nano /opt/nusantara/etc/<file>` and keep the single
quotes.

**`worker.env`** — the only file that holds the token:

```
IG_ACCESS_TOKEN='the token from step 2'
IG_USER_ID='the account ID from step 2'
IG_TOKEN_FILE='/opt/nusantara/etc/worker.env'
IG_MEDIA_PUBLIC_URL='https://<the-mac-mini>.ts.net:8443/webhook/media'
```

`IG_MEDIA_PUBLIC_URL` is the callback URL with `/media` added. Instagram
fetches the pictures the shop sends from it; without it, text still goes but
photos to Instagram fail (and /chat shows them as not sent).

**`webhook.env`** — only if step 6 shows Instagram deliveries being refused:

```
IG_APP_SECRET='the Instagram app secret from step 1.3'
```

⚠️ **not verified:** Meta's documentation does not say whether Instagram
deliveries are signed with the Meta app secret (already in `APP_SECRET`) or
the Instagram app secret. The webhook accepts either for Instagram deliveries
(never for WhatsApp ones) and logs which one matched:
`evt=webhook.ig.signed_with` with `key: APP_SECRET` or `IG_APP_SECRET`.

**`api.env`** — only after Meta approves the Human Agent feature:

```
IG_HUMAN_AGENT='1'
```

Then restart the three services:

```
sudo launchctl kickstart -k system/local.nusantara.webhook
sudo launchctl kickstart -k system/local.nusantara.worker
sudo launchctl kickstart -k system/local.nusantara.api
```

The worker's first log line (`/opt/nusantara/logs/worker.log`,
`evt=worker.config.loaded`) should say `"instagram":true`,
`"instagramPictures":true` and `"instagramTokenFile":true`. It never prints the
token.

---

## 5. Switch things on in the POS

Chatbot → **Settings** → **Instagram** card (owner only):

- **Connection** shows the account's @username within the hour (the worker
  checks `/me` hourly and at start), when the token expires, and when Meta last
  delivered anything.
- **Auto-reply to comments** is OFF until you switch it on. When on, a
  person's first top-level comment on a post gets the public reply template
  (e.g. "Cek DM ya kak 😊") and the private DM template — once per person per
  post. A private DM is allowed once per comment, within 7 days. [Private
  replies][private]

The bot answers Instagram DMs by itself, with the same switches, rules and
hand-overs as WhatsApp. To take one customer off the bot, use the switch in
that conversation's header, as on WhatsApp.

---

## 6. Test it

From your second Instagram account:

1. **DM the shop** "halo kak". Within a few seconds it appears in Chatbot →
   Chat → **Instagram**, and the bot answers in Instagram. The @username shows
   after the worker's next sync (a few seconds to a minute).
2. **Ask for photos** of a unit the POS has photos of. They arrive as
   pictures. If not, check `IG_MEDIA_PUBLIC_URL` and test the address:
   ⚠️ **not verified:** the funnel publishes `/webhook` and, as far as
   Tailscale's documentation says, everything under it. From a phone on mobile
   data, `https://<the-mac-mini>.ts.net:8443/webhook/media/x/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   should answer **404 Not found** (from the webhook) — not a Tailscale error
   page.
3. **Comment** on one of the shop's posts. It appears in Chatbot →
   **Comments** with the post's picture and caption (the picture may take a
   minute). Staff on the alert numbers get a WhatsApp alert. Try *Reply*,
   *Send DM*, *Hide* and *Mark done*.
4. Ask something only a person can answer ("bisa nego?"). The chat is outlined
   in /chat, counted in the sidebar notice, and the alert numbers get a
   WhatsApp message naming the @username with a link.

---

## Troubleshooting

| What you see | Look at | Usually |
|---|---|---|
| Verify fails in the dashboard | `webhook.log`: `webhook.verify.failed` | The verify token differs from `VERIFY_TOKEN`, or the funnel is down. |
| Nothing arrives at all | `webhook.log`: no `webhook.ig.received` | The `messages` / `comments` fields are not subscribed, the account is not subscribed (step 3.4), or the app is not Live. |
| `webhook.signature.invalid` when you DM | `webhook.log` | Instagram signs with the Instagram app secret: set `IG_APP_SECRET` (step 4) and restart the webhook. |
| DMs arrive, no reply | Chatbot → Chat → Instagram; `worker.log` | The bot is off for that chat, the message is a hand-over, or `IG_ACCESS_TOKEN`/`IG_USER_ID` is missing (`"instagram":false`). |
| `worker.ig.retry` / `exhausted` with `#190` | `worker.log` | The token expired or was revoked — generate a new one (step 2), put it in `worker.env`, restart the worker. |
| `#10` / `#200` permission errors | `worker.log` | A permission is missing, or (for comments) Advanced Access is needed. |
| Replies refused after a day | the reply box says so | Instagram's 24-hour rule. Only the Human Agent feature (App Review) extends it to 7 days. |
| Photos not delivered | /chat shows the picture as not sent | `IG_MEDIA_PUBLIC_URL` missing or wrong, or the funnel does not publish `/webhook/media` (test in step 6.2). Instagram takes JPG and PNG only. |
| No @username, just "Instagram user" | `worker.log`: `worker.ig.profile_failed` | Meta only shows the profile of somebody who has messaged the shop; retried hourly. |
| Card says the token expires soon | Settings → Instagram | The weekly refresh failed: `worker.ig.token_refresh_failed`. Check `IG_TOKEN_FILE` is writable by `_nusantara`. |

---

## Meta's limits, for reference

- A text DM is at most **1000 bytes**; the POS splits a longer reply into
  several messages. [Messaging API][messaging]
- Pictures: PNG or JPEG, up to 8 MB, sent **by URL**. [Messaging API][messaging]
- Private reply: one per comment, within 7 days; the 24-hour window opens only
  when the person answers it. [Private replies][private]
- Hide/unhide and public replies: `instagram_business_manage_comments`.
  [Comment moderation][moderation]
- Graph API version: the POS uses **v25.0** for both channels (one constant);
  v27.0 is current and v25.0 is supported until 2028-07-29.
  [Changelog][changelog]

[overview]: https://developers.facebook.com/documentation/instagram-platform/overview
[webhooks]: https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
[create]: https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app
[bizlogin]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
[review]: https://developers.facebook.com/documentation/instagram-platform/app-review
[getstarted]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started
[messaging]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api
[private]: https://developers.facebook.com/documentation/instagram-platform/private-replies
[moderation]: https://developers.facebook.com/documentation/instagram-platform/comment-moderation
[changelog]: https://developers.facebook.com/docs/graph-api/changelog

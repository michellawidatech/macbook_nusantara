# The POS on a public domain

The shop owns `macbooknusantara.com`, `macbooknusantara.my.id`, `mac-nus.com`
and `mac-nus.my.id` (registered at Domainesia on 2026-10-02). This puts the POS
on **`https://pos.macbooknusantara.com`**, reachable from any phone or laptop
without the Tailscale app; the three other `pos.` names redirect to it, and
every apex stays free for a landing site later.

```
staff (anywhere) ─https─▶ Cloudflare edge ─▶ Cloudflare Access (staff e-mails only)
                                │
                     outbound tunnel, started BY the Mac mini
                                ▼
                    cloudflared ─▶ Caddy 127.0.0.1:8080 ─┬─ /      the SPA
                                                         └─ /api   API :4000
staff (tailnet)  ─https─▶ tailscale serve :443 ─▶ the same Caddy   (unchanged)
Meta             ─https─▶ tailscale funnel :8443 ─▶ webhook        (unchanged)
```

## Why a tunnel

The Mac mini makes an OUTBOUND connection to Cloudflare, so nothing about the
shop's line matters: no router to configure, no port forwarded, no question of
whether the IP is public, static or behind CGNAT, and the shop's address is
never in DNS. The TLS certificate is Cloudflare's, issued and renewed by
itself. The cost is that the domains' DNS moves to Cloudflare (free plan);
Domainesia stays the registrar and keeps billing the renewals.

Serving straight from the Mac mini (Caddy + Let's Encrypt + a router forward)
was written and then dropped the same day: the router is at the client's shop,
nobody there can configure it, and whether the line is reachable at all was
unknown.

## One address, the others redirect

**`pos.macbooknusantara.com` serves the POS; `pos.mac-nus.com`,
`pos.mac-nus.my.id` and `pos.macbooknusantara.my.id` only redirect to it**
(owner, 2026-10-02). The browser keeps the session cookie and every draft the
app saves (`usePersistentState` — the till's basket, an inbound order's rows)
per ORIGIN, so two addresses serving the POS would be two sign-ins and a
basket started on one invisible on the other.

When the landing site is built on `macbooknusantara.com`, keep it a plain
site: to a browser it is the SAME site as `pos.macbooknusantara.com`, so a
script running there is closer to the till than one on any other domain.

## 0. Before anything is public — staff accounts

The initial password is `password`, and it is public. An account still on it
can do nothing except change its password — which means **anybody who guesses
the username can change it for them and take the account.** Usernames are
first names.

Before step 4, in Settings → Staff accounts:

- every person who will use the POS has signed in once and chosen a password;
- every account nobody uses is **switched off**;
- nobody is left on "must change password".

Cloudflare Access (step 5) closes this hole as well, but do not rely on one
lock for it.

## 1. Cloudflare — add the four domains

1. Create a free account at <https://dash.cloudflare.com/sign-up> with the
   e-mail that should own the domains' DNS (the owner's). Turn on two-factor
   authentication: *My Profile → Authentication*.
2. *Add a domain* → `macbooknusantara.com` → **Free** plan. Let it scan; it
   finds nothing, which is right (nothing was ever set up). Continue.
3. Cloudflare shows **two nameservers**, e.g. `ada.ns.cloudflare.com` and
   `bob.ns.cloudflare.com`. They are the same for every domain on this
   account.
4. Repeat for `mac-nus.com`, `mac-nus.my.id` and `macbooknusantara.my.id`.

## 2. Domainesia — point each domain at Cloudflare

For each of the four domains:

1. Sign in at <https://my.domainesia.com>.
2. *Domain → Domain Saya* → *Kelola* on the domain.
3. *Nameservers* → **Gunakan nameserver kustom** (use custom nameservers).
4. Nameserver 1 and 2: the two Cloudflare names. Delete anything in 3–5.
   Save.

On 2026-10-02 the `.com` domains were on `ns1/ns2.domainesia.net` and the
`.my.id` ones on `nsx1/nsx2.domainesia.com`; all four are replaced. Nothing
was configured at Domainesia's DNS, so nothing is lost. The `.my.id` domains
showed no hold, so PANDI's identity check is not blocking them — if Domainesia
ever shows one as *Menunggu Verifikasi* or suspended, upload the KTP first.

Each domain in Cloudflare says *Pending nameserver update* and then **Active**
— usually within an hour, up to 24h. Cloudflare e-mails when it is.

```bash
dig +short NS macbooknusantara.com
```

## 3. Cloudflare — zone settings (per domain)

On each domain, once Active:

- *SSL/TLS → Overview*: **Full (strict)**.
- *SSL/TLS → Edge Certificates*: **Always Use HTTPS** on, **Minimum TLS
  Version 1.2**, **TLS 1.3** on, **Automatic HTTPS Rewrites** on.
  Leave **HSTS off here** — Caddy sends it (`ops/Caddyfile`); two sources for
  one header is how they drift.
- *Security → Bots*: leave **Bot Fight Mode off** on `macbooknusantara.com` —
  it challenges `fetch` calls, and the app polls `/api/store/changes` every
  five seconds.

## 4. The tunnel — on the Mac mini

In Cloudflare: *Zero Trust* (left menu; the first time it asks for a team
name, e.g. `macbooknusantara`, and the **Free** plan, which may ask for a card
and charges nothing up to 50 users) → *Networks → Tunnels* → **Create a
tunnel** → **Cloudflared** → name `nusantara-mini`.

It shows an install command containing a long token. **The token is a
secret** — it lets anyone run your tunnel. Do not paste it into chat, a doc or
a commit.

On the Mac mini, as its admin account — from anywhere, over Tailscale:
Screen Sharing (`open vnc://nusantara-mini.tail903811.ts.net` on the laptop)
and Terminal on the mini, or SSH:

```bash
brew install cloudflared
```

```bash
sudo cloudflared service install <TOKEN-FROM-THE-DASHBOARD>
```

`sudo` makes it a LaunchDaemon (`/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`)
that starts at boot with nobody logged in — the rule every Nusantara process
follows. Without `sudo` it is a LaunchAgent and stops at logout. The dashboard
shows the connector **Healthy** within a minute.

Still in the tunnel → *Public Hostname* → **Add a public hostname**:

| Subdomain | Domain | Path | Type | URL |
|---|---|---|---|---|
| `pos` | `macbooknusantara.com` | *(empty)* | HTTP | `127.0.0.1:8080` |

That is Caddy, the same address `tailscale serve` points at — **not** `:4000`
(the API alone, around Caddy) and **not** `:3001` (the webhook). Cloudflare
creates the DNS record itself (a proxied CNAME to `<id>.cfargotunnel.com`).

`http://` is correct: that hop is inside the Mac mini over loopback, and the
tunnel itself is encrypted. Browsers only see Cloudflare's certificate.

## 5. Cloudflare Access — staff e-mails only

Without this the sign-in form is on the open internet, and every bug behind
it is one request from anybody. With it, nobody reaches even the sign-in form
without a one-time code sent to an address on the list.

*Zero Trust → Access → Applications* → **Add an application** → **Self-hosted**:

- Name `Nusantara POS`, session duration **1 month**.
- Public hostname `pos.macbooknusantara.com`, path empty.
- *Policies → Add a policy*: name `Staff`, action **Allow**, include
  **Emails** → each staff member's address. Not *Emails ending in*
  `@gmail.com` — that admits everyone with Gmail.
- *Login methods*: **One-time PIN** (on by default).

A staff member opens the address, types their e-mail, types the six-digit
code Cloudflare mails them, then sees the POS sign-in as before — once a month
per device. When the month runs out the app's background requests fail until
the page is reloaded; the reload asks for a code again.

To remove a person: take them out of the `Staff` policy, revoke them under
*Zero Trust → My Team → Users*, and switch their account off in Settings →
Staff accounts.

## 6. The Mac mini's API config

`/opt/nusantara/etc/api.env`:

- `CORS_ORIGIN=https://pos.macbooknusantara.com,https://nusantara-mini.tail903811.ts.net`
- `TRUST_PROXY` stays unset (`loopback`). cloudflared, like `tailscale serve`,
  reaches Caddy from 127.0.0.1; Cloudflare's edge appends the visitor's real
  address to `X-Forwarded-For`, so the first non-loopback address from the
  right is the person — which is what the login throttle keys on.
- `SESSION_COOKIE_INSECURE` stays unset.

```bash
sudo launchctl kickstart -k system/local.nusantara.api
```

The Caddyfile's HSTS line arrives with the next release (a `v*` tag); nothing
else in this document waits for one.

## 7. The `mac-nus` and `.my.id` names

In each of `mac-nus.com`, `mac-nus.my.id` and `macbooknusantara.my.id`:

1. *DNS → Records → Add record*: type `AAAA`, name `pos`, IPv6 `100::`,
   **Proxied** (orange cloud). `100::` is the discard address — the record
   exists only so Cloudflare answers for the name.
2. *Rules → Redirect Rules → Create rule*: when **Hostname equals**
   `pos.<that domain>` → **Dynamic**, expression
   `concat("https://pos.macbooknusantara.com", http.request.uri.path)`,
   status **301**, **Preserve query string** on.

The apexes stay empty until there is a landing site.

## 8. Check it

From a phone NOT on Tailscale:

1. `https://pos.macbooknusantara.com` → Cloudflare's e-mail page → code → the
   POS sign-in → sign in.
2. `https://pos.mac-nus.com` → lands on `https://pos.macbooknusantara.com`.

From the laptop:

```bash
curl -sI https://pos.macbooknusantara.com | grep -i -E '^(HTTP|location)'
```

`302` to `….cloudflareaccess.com` — Access asking who you are. A `200` means
Access is NOT in front; go back to step 5.

```bash
for h in pos.mac-nus.com pos.mac-nus.my.id pos.macbooknusantara.my.id; do curl -sI https://$h | grep -i -E '^location'; done
```

Three `location: https://pos.macbooknusantara.com/…`.

On the Mac mini, after one WRONG POS password from the phone:

```bash
sudo grep auth.login.failed /opt/nusantara/logs/api.log | tail -1
```

The `ip` must be the phone's carrier address, not `127.0.0.1` — otherwise
every visitor shares one throttle bucket (step 6).

## What stays as it was

- `tailscale serve` and `https://nusantara-mini.tail903811.ts.net` — a second
  door for staff on the tailnet, and the one to use if Cloudflare is down.
- The WhatsApp webhook on Tailscale Funnel (`ops/whatsapp-funnel`). Moving it
  to `wa.macbooknusantara.com` is possible — a second public hostname, path
  `^/webhook$` → `127.0.0.1:3001`, and an Access **Bypass** policy since Meta
  cannot type a code — but it changes the Meta callback URL, so it is its own
  job.
- The deploy pipeline and SSH, tailnet-only.
- The shop's router: untouched, nothing forwarded.

## Undo

*Zero Trust → Networks → Tunnels → nusantara-mini → Delete*, then on the Mac
mini `sudo cloudflared service uninstall`. The POS is tailnet-only again;
nothing in the app changes.

# Cutover: an empty shop, filled with master data and what is owed

Owner ask, 2026-09-21: *"I will deploy this tomorrow, the server is on Mac
mini. … For now, you can erase ALL of the data. Btw the data that I will
migrate is probably only the master product and piutang & utang (payable and
receivable) so pls simple master data like category, warehouse, etc, pls do not
create a long list of migration data from 2020."*

This is that sequence, in order, with a check after each step. About an hour,
most of it waiting.

Two companions, neither repeated here: [deploy-pipeline.md](./deploy-pipeline.md)
is how a `v*` tag reaches the Mac mini, and [deploy-macmini.md](./deploy-macmini.md)
is the machine itself. This is the one-off that happens between them.

## What ends up in the database

Measured on the real export, `~/Export Files`, 2026-09-21:

| | |
|---|---|
| product models | 159 |
| variants (SKU) | 369, coded `AIR 13" 2020 I5 8/256` |
| categories | 16 |
| warehouses | 4 |
| suppliers | 64 |
| customers | 38 |
| salespeople | 15 |
| **owed by customers** | **Rp1.560.030.931** across 9 customers |
| ~~**owed to suppliers**~~ | ⚠️ **not imported since 2026-09-24** — see below |
| units, sales, purchase orders, stock moves | **none** |

Three years of documents become one number per customer. That is deliberate,
and it is what `Customer.openingBalance` was added for (2026-09-08,
2026-09-13): *debt from before this app, stated once*. It is not a fake
invoice — an invented invoice would put phantom stock in the ledger and be
counted by every report that walks documents — and it appears on Customers and
on Receivable.

⚠️ **The supplier half is gone (2026-09-24.)** The owner stopped tracking a
supplier's debt from before this app — *"we don't track it anymore (remove
from database schema)"* — so `Supplier.openingBalance` and `Payment.supplierId`
were dropped. The Rp6.887.861.193 of payable this table used to carry has
nowhere to land: after the cutover, Payable lists the inbound invoices this
app records and nothing before them. `extract.py` still reports each
supplier's figure in `audit.xlsx` (*"Saldo awal supplier tidak dibawa"*), and
`emit.py`'s summary says `payable: 0` rather than claiming an import that did
not happen. Carrying it again would need a new owner decision and a new
migration.

**Rp11 is left behind**, on an internal pseudo-account called `PEMAKAIAN TOKO`
that is in the aged report and in no customer list. The extractor names it
rather than absorbing it. Nothing needs doing about it.

---

## 1. Cut the release

```bash
git tag v2026.09.21 && git push origin v2026.09.21
```

Watch the run. It builds on GitHub's `macos-15` runner, takes a `pg_dump`
called `predeploy-2026.09.21` before it touches anything, applies migrations
through an SSH tunnel as the owner, verifies them **by query** (`prisma migrate
status` lies in this project), installs, and switches back by itself if
`/api/health` does not name the new version.

**Check:** the run is green, and

```bash
curl -fsS https://<mac-mini>.<tailnet>.ts.net/api/health
```

names `2026.09.21`.

## 2. Erase the shop

Only on a deliberate cutover, and only because the owner asked for it. There is
a dump from step 1 if this turns out to be the wrong day.

```bash
ssh <mac-mini>
sudo -u _nusantara /opt/nusantara/current/ops/backup pre-cutover     # one more, by hand
sudo launchctl bootout system/local.nusantara.api            # nothing writing
sudo launchctl bootout system/local.nusantara.worker
```

Then, as the owner role:

```bash
dropdb nusantara_pos_prod && createdb nusantara_pos_prod
cd /opt/nusantara/current && APP_ENV=prod DATABASE_URL="$OWNER_URL" \
  npx prisma migrate deploy --schema prisma/schema.prisma
```

**Check:** every migration applied, and the app role's grants are `t|f|t|f|t`
— it may INSERT into `UnitEvent` and may never UPDATE or DELETE it:

```sql
SELECT has_table_privilege('nusantara_app','"UnitEvent"','SELECT'),
       has_table_privilege('nusantara_app','"UnitEvent"','UPDATE'),
       has_table_privilege('nusantara_app','"UnitEvent"','INSERT'),
       has_table_privilege('nusantara_app','"UnitEvent"','DELETE'),
       has_table_privilege('nusantara_app','"Unit"','UPDATE');
```

## 3. Read the export

No database is touched by this step. It can be run anywhere, including on a
laptop, and the folder copied over.

```bash
python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft --balances-only
```

**Check:** it prints one chunk and four figures, and the two "ditempatkan"
lines match the two "B2Soft" lines apart from the Rp11 named above.

The `--balances-only` flag is what makes this a cutover rather than a
migration: master data, plus every party's outstanding position rolled into one
opening balance taken from B2Soft's **own aged reports** (`Laporan Piutang
Dagang`, `Laporan Hutang Dagang`) rather than from a replay. The replay is a
reconstruction, and on the day of a cutover what the shop believes it is owed
is the number that matters.

## 4. Import it

```bash
APP_ENV=prod DATABASE_URL="$OWNER_URL" \
  pnpm --filter @nusantara/db import:b2soft build/b2soft --master-only --with-balances
```

The owner connection, not the app's: it creates the document-numbering
sequences, and those must belong to the role `next_doc_code` runs as.

**Check:** it prints `reference … suppliers 64, salesmen 15, customers 38,
categories 16, models 159, skus 369`, then `Income & Expense counts from …`,
then eight `OK` lines. Then:

```sql
SELECT count(*), sum("openingBalance") FROM "Customer" WHERE "openingBalance" > 0;  -- 9,  1560030931
SELECT count(*) FROM "Unit";                                                        -- 0
-- No supplier line: the column was dropped on 2026-09-24 (see above).
```

## 5. Logins

The seed writes an unusable hash for every account, so nobody can sign in until
this runs.

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run accounts --owner ersen
```

Every active salesperson gets a login, username from their first name, on the
initial password `password` — and every one of them must change it at first
sign-in. `ersen` is the owner and can manage the rest from Settings → Staff
accounts.

**Check:** sign in as `ersen`, change the password when asked, and the app
opens on Inventory.

## 6. Start the services

```bash
sudo launchctl kickstart -k system/local.nusantara.api
sudo launchctl kickstart -k system/local.nusantara.worker
```

## 7. The chatbot

Two steps, and the second is the one that was missing on 2026-09-21 —
[chatbot-runbook.md](./chatbot-runbook.md) has the whole story.

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run knowledge \
  /tmp/knowledge-2026-09-18.md --by ersen
sudo launchctl kickstart -k system/local.nusantara.webhook
sudo /opt/nusantara/current/ops/whatsapp-funnel up
```

Paste the URL it prints into **Meta → WhatsApp → Configuration**, press
**Verify and save**, and **subscribe to the `messages` field**. A callback URL
that verifies with no field subscription delivers nothing, for ever, with no
error on either side.

**Check:** message the shop's number from a phone, then

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run chatbot
```

Every line should read `ok`.

### Whether the bot may quote stock

`AGENT_CAPABILITIES` in `/opt/nusantara/etc/worker.env`. **Leave it unset until
the shelf in this database is real.** After a cutover it is empty — no units at
all — so a bot answering "is the Air M1 ready?" from it would tell every
customer the shop has nothing. Set it to `live` once stock has been taken in
through Inbound & QC.

## 8. Say what is in the drawer

Income & Expense opens with a single *add the current balance* button when
nothing has been recorded. Enter the cash and the bank balance as they stand;
the import has already set the date they count from, so nothing before the
cutover is counted as money in hand.

---

## What is NOT carried over, and where it still lives

| | |
|---|---|
| stock on the shelf | **not carried.** Take it in through Inbound & QC, which is what gives each unit a cost, a grade and a serial |
| three years of sales and purchases | not carried. B2Soft keeps them; `git show` of `tools/b2soft` carries the full-history importer if it is ever wanted |
| marketplace payouts still pending | not carried. Anything Shopee owes from before the cutover settles in B2Soft |
| QC photographs | there were none to carry |

The full-history import still exists and still works — it is the same command
without `--balances-only` and without `--with-balances`. It writes 4,328 units,
26,851 events and every document since 2023. It is not what was asked for.

## If it goes wrong

```bash
sudo /usr/local/libexec/nusantara-deploy rollback     # the previous release, in seconds
```

and the database is in `/opt/nusantara/backups`, newest first, with the
pre-deploy dump named after the version. The rollback deliberately does **not**
touch the database: a migration that has run stays run, which is why a
migration must never break the release before it.

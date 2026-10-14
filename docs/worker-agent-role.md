# The chatbot worker logs in as `nusantara_agent` (runbook, 2026-10-15)

**Why.** The POS and the chatbot are two database roles on purpose:
`nusantara_app` is the shop's screens, `nusantara_agent` is the bot. The
agent role may write the bot's own columns (the thread note, the lease, the
bot's half of a lead, a hold it books) and may never touch money or a staff
decision. On the Mac mini the worker has been logging in with common.env's
`DATABASE_URL` — as `nusantara_app` — so the separation existed only on paper,
and the summary pass's updates were refused and swallowed.

From the release carrying chatbot v2 the worker **refuses to start in
production as any role but `nusantara_agent`**. `worker.log` then says, every
few seconds as launchd retries it:

> the worker is logged in as nusantara_app, not nusantara_agent — set
> DATABASE_URL in worker.env (docs/worker-agent-role.md). Not starting.

**When.** Do this **before** pushing the chatbot v2 tag. The release running
today works under either role, so switching first costs nothing; deploying
first leaves the bot silent until the switch is made.

Everything below is on the Mac mini, in Terminal, as the admin account that
ran docs/go-live.md.

## 1. Find the agent password

It is the **agent** line of the four printed in go-live step 2.4 ("SAVE THESE
FOUR NOW") — look in your password manager.

If it is lost, set a new one (nothing else uses this role yet, so nothing
else breaks):

```bash
AGENT_PW=$(openssl rand -hex 24)
/opt/homebrew/opt/postgresql@16/bin/psql -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE nusantara_agent PASSWORD '$AGENT_PW'"
printf '\nSAVE THIS NOW — agent: %s\n' "$AGENT_PW"
```

Otherwise put the saved one in the same variable, without echoing it:

```bash
read -rs 'AGENT_PW?agent password: '; echo
```

## 2. Prove the password and the role before touching the config

```bash
/opt/homebrew/opt/postgresql@16/bin/psql \
  "postgresql://nusantara_agent:${AGENT_PW}@127.0.0.1:5432/nusantara_pos_prod" \
  -Atc 'select current_user'
```

It must print `nusantara_agent`. A password error here means step 1's
password is wrong — stop and fix that first; nothing has changed yet.

## 3. Point the worker — and only the worker — at it

`ops/run` loads `common.env` and then `worker.env`, so a `DATABASE_URL` in
worker.env wins for the worker alone. The API and the webhook keep
`nusantara_app` from common.env. That is the separation.

```bash
F=/opt/nusantara/etc/worker.env
sudo cp "$F" "$F.before-agent-role"
sudo sed -i '' '/^DATABASE_URL=/d' "$F"
echo "DATABASE_URL='postgresql://nusantara_agent:${AGENT_PW}@127.0.0.1:5432/nusantara_pos_prod?connection_limit=10'" \
  | sudo tee -a "$F" >/dev/null
sudo chown _nusantara:staff "$F" && sudo chmod 600 "$F"
unset AGENT_PW
```

`connection_limit=10`: the worker answers up to 8 chats at once
(`WORKER_DRAFT_CONCURRENCY`), each holding at most one connection.

Check that the line is there exactly once, without printing the password:

```bash
sudo grep -c '^DATABASE_URL=.*nusantara_agent:' /opt/nusantara/etc/worker.env   # → 1
sudo grep -c '^DATABASE_URL=.*nusantara_app:'   /opt/nusantara/etc/common.env   # → 1 (unchanged)
```

## 4. Restart the worker

```bash
sudo launchctl kickstart -k system/local.nusantara.worker
```

## 5. Verify

```bash
# The release with chatbot v2 logs the role it found:
tail -n 100 /opt/nusantara/logs/worker.log | grep -E 'worker.db_role|worker.started'

# And the database agrees — the worker's connections are the agent's:
/opt/homebrew/opt/postgresql@16/bin/psql -d nusantara_pos_prod -Atc \
  "select usename, count(*) from pg_stat_activity
    where datname = 'nusantara_pos_prod' group by 1 order by 1"
```

Expect `nusantara_agent|…` (the worker) beside `nusantara_app|…` (the API and
the webhook). On a release from before chatbot v2 there is no `db_role` line;
the `pg_stat_activity` query is the proof.

Then send the shop's WhatsApp number a message from a tester's phone and see
it answered on /chat.

## Undo

```bash
sudo cp /opt/nusantara/etc/worker.env.before-agent-role /opt/nusantara/etc/worker.env
sudo launchctl kickstart -k system/local.nusantara.worker
```

(On the chatbot v2 release the worker will then refuse to start again — which
is the point: the undo is for a release from before it.)

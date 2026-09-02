/**
 * Keep the API awake during shop hours.
 *
 * ## Why this exists
 *
 * Render spins a free web service down after 15 minutes without a request, and
 * the next request then waits about a minute for it to come back. On a till
 * that is the wrong minute: it lands on the first customer after a quiet spell,
 * with somebody standing at the counter.
 *
 * ## Why it is a window and not simply always
 *
 * Render's free tier is 750 instance-hours per MONTH, per account, shared by
 * every free service and not rolled over — and a service burns those hours
 * whenever it is awake, which means a ping consumes exactly the resource it is
 * protecting. Kept awake around the clock the API alone would cost ~730 h and
 * leave the webhook nothing. Kept awake 08:00–22:00 Asia/Jakarta it costs
 * ~450 h and leaves ~300 h of headroom for the webhook's own wakes.
 *
 * So the trade is deliberate: instant during opening hours, and the first
 * request of the morning still waits for the spin-up. Paying $7/mo for the API
 * instance removes the whole problem and this file with it.
 *
 * ## Why /api/health and not /
 *
 * It has to be a route the SERVICE serves, so the request reaches Render's
 * origin and resets the idle timer. `/api/health` touches no database — it
 * answers from config — so ninety pings a day cost the database nothing.
 * A path served by the CDN would return 200 without ever waking anything.
 *
 * The webhook is deliberately not pinged. Meta retries a failed delivery, so a
 * cold start there is a late reply rather than a lost message, and those hours
 * are better spent on the till.
 */

import type { Config } from "@netlify/functions";

const API_HEALTH = "https://nusantara-api.onrender.com/api/health";

export default async (): Promise<Response> => {
  const started = Date.now();
  try {
    // No timeout of our own: a cold start is the case this exists for, and
    // ~60 s of it is a success, not a failure worth aborting.
    const res = await fetch(API_HEALTH, {
      headers: { "user-agent": "nusantara-keep-warm" },
    });
    const ms = Date.now() - started;
    // Logged rather than thrown, because a scheduled function that fails is
    // noise in the Netlify log and the next run is ten minutes away regardless.
    console.log(
      JSON.stringify({
        evt: "keep-warm",
        status: res.status,
        ms,
        // Over ~5 s means it was asleep and this call woke it — which is the
        // ping doing its job, and worth being able to count.
        wokeIt: ms > 5_000,
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        evt: "keep-warm.failed",
        ms: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
  return new Response(null, { status: 204 });
};

export const config: Config = {
  // Asia/Jakarta is UTC+7 and has no daylight saving, so the offset is a
  // constant and this window does not drift twice a year:
  //   01:00–15:50 UTC  =  08:00–22:50 WIB
  // Netlify schedules in UTC and offers no timezone field, which is why the
  // conversion is written here rather than assumed.
  schedule: "*/10 1-15 * * *",
};

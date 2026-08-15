/**
 * Login rate limiting — docs/rebuild/08-data-integrity.md §9.
 *
 * "Rate-limit login per username *and* per IP … Lock-out is progressive delay,
 * not a hard lock — a hard lock is a denial-of-service handed to anyone who
 * knows a username."
 *
 * So the delay grows with each failure and always expires. The wait is
 * *reported* (429 + Retry-After) rather than slept through: holding the
 * connection open would hand an attacker a cheap way to exhaust the pool.
 */

import type { LoginLimitConfig } from "../config.js";

interface Bucket {
  failures: number;
  /** Nothing is accepted before this instant. */
  blockedUntil: number;
  /** When the failure count decays. */
  windowEnds: number;
}

export interface LimitDecision {
  readonly allowed: boolean;
  /** Seconds the caller must wait. Only meaningful when not allowed. */
  readonly retryAfter: number;
}

export interface LoginLimiter {
  check(username: string, ip: string): LimitDecision;
  recordFailure(username: string, ip: string): void;
  recordSuccess(username: string, ip: string): void;
  /** Drop expired buckets. The map is small (~3 staff) but not unbounded. */
  sweep(): void;
}

export function createLoginLimiter(
  config: LoginLimitConfig,
  now: () => number = Date.now,
): LoginLimiter {
  const buckets = new Map<string, Bucket>();

  // Per username AND per IP: one attacker spraying many usernames from one
  // address is throttled, and so is one username attacked from many addresses.
  const keysFor = (username: string, ip: string): string[] => [
    `u:${username.toLowerCase()}`,
    `i:${ip}`,
  ];

  const bucketFor = (key: string): Bucket => {
    const t = now();
    const existing = buckets.get(key);
    if (existing !== undefined && existing.windowEnds > t) return existing;
    const fresh: Bucket = {
      failures: 0,
      blockedUntil: 0,
      windowEnds: t + config.windowMs,
    };
    buckets.set(key, fresh);
    return fresh;
  };

  return {
    check(username, ip) {
      const t = now();
      let worst = 0;
      for (const key of keysFor(username, ip)) {
        const bucket = bucketFor(key);
        if (bucket.blockedUntil > t)
          worst = Math.max(worst, bucket.blockedUntil - t);
      }
      return worst === 0
        ? { allowed: true, retryAfter: 0 }
        : { allowed: false, retryAfter: Math.ceil(worst / 1000) };
    },

    recordFailure(username, ip) {
      const t = now();
      for (const key of keysFor(username, ip)) {
        const bucket = bucketFor(key);
        bucket.failures += 1;
        bucket.windowEnds = t + config.windowMs;

        if (bucket.failures >= config.maxAttempts) {
          const over = bucket.failures - config.maxAttempts;
          const delay = Math.min(
            config.baseDelayMs * 2 ** over,
            config.maxDelayMs,
          );
          bucket.blockedUntil = t + delay;
        }
      }
    },

    recordSuccess(username, ip) {
      for (const key of keysFor(username, ip)) buckets.delete(key);
    },

    sweep() {
      const t = now();
      for (const [key, bucket] of buckets) {
        if (bucket.windowEnds <= t && bucket.blockedUntil <= t)
          buckets.delete(key);
      }
    },
  };
}

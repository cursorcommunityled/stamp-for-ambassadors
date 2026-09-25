import { db } from "@/lib/db";

/**
 * Rate limits that survive a deploy and are shared across instances.
 *
 * The in-memory maps in claim.ts are still the cheap first line: they flatten
 * one person hammering one instance without touching the database. What they
 * cannot do is hold a limit across a restart or across two web processes, and
 * a deploy mid-event handing everyone a fresh allowance is exactly when the
 * limit matters.
 */

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the window rolls over. Zero when the call was allowed. */
  retryAfter: number;
};

/**
 * Every per-IP number here has to survive one fact: a room of a hundred
 * people on the venue wifi shares a single public address. So the per-IP
 * limits are set to catch a script and nothing else, and the per-person work
 * is done by the per-email limits, which is where a real abuser has to spend
 * something (an inbox they control) to get another bucket.
 */
export const LIMITS = {
  /** A door queue is one person every few seconds. A script is thousands. */
  signInPerIp: { limit: 20, windowMs: 60_000 },
  /** Backstop on pointing the form at one stranger's inbox all evening. */
  signInPerEmail: { limit: 8, windowMs: 15 * 60_000 },
  /** Six sponsors, plus retries, plus a reload. */
  claimPerEmail: { limit: 20, windowMs: 60_000 },
  /** Deliberately loose: the whole venue is behind this one key. */
  claimPerIp: { limit: 600, windowMs: 60_000 },
  /** Each of these is one Luma call. The 6s in-memory cooldown comes first. */
  recheckPerEmail: { limit: 15, windowMs: 60_000 },
} as const;

export type Limit = { limit: number; windowMs: number };

const ALLOWED: RateLimitResult = { ok: true, retryAfter: 0 };

/**
 * Counts one call against `key` and says whether it fits under `limit`.
 *
 * One statement, so two simultaneous requests cannot both read a count of
 * four and both decide they are the fifth. `ON CONFLICT DO UPDATE` takes a
 * row lock, and the `CASE` both rolls the window over and increments inside
 * it, which is why the returned count is authoritative rather than a read
 * that something else has already invalidated.
 *
 * Fails open. A database that cannot serve this cannot serve the claim behind
 * it either, so refusing here would only turn an outage into a worse one.
 */
export async function consume(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  try {
    const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimit" ("key", "windowStart", "count")
      VALUES (${key}, ${now}, 1)
      ON CONFLICT ("key") DO UPDATE
      SET "windowStart" = CASE
            WHEN "RateLimit"."windowStart" < ${windowStart} THEN ${now}
            ELSE "RateLimit"."windowStart"
          END,
          "count" = CASE
            WHEN "RateLimit"."windowStart" < ${windowStart} THEN 1
            ELSE "RateLimit"."count" + 1
          END
      RETURNING "count", "windowStart"
    `;

    const row = rows[0];
    if (!row || row.count <= limit) return ALLOWED;

    // Clamped to the window. Concurrent callers each read their own clock, so
    // a refusal can measure itself against a window another one opened a few
    // milliseconds later and report longer than the window is.
    const elapsed = now.getTime() - row.windowStart.getTime();
    const remaining = Math.min(windowMs, Math.max(0, windowMs - elapsed));
    return { ok: false, retryAfter: Math.max(1, Math.ceil(remaining / 1000)) };
  } catch (error) {
    console.error(`[stamp] rate limit check failed for ${key}:`, error);
    return ALLOWED;
  }
}

/**
 * Whose request this is, for limiting purposes.
 *
 * `x-forwarded-for` is only worth reading because Render terminates TLS in
 * front of the app and appends the real peer. Taking the first entry is the
 * client as the proxy saw it; a spoofed prefix costs the attacker their own
 * bucket, not someone else's. With no header at all — a local run, or a
 * direct hit — everyone shares one bucket, which is strict rather than open.
 */
export function callerIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}

/** `consume` against a preset, for the common single-key case. */
export function check(key: string, of: Limit): Promise<RateLimitResult> {
  return consume(key, of.limit, of.windowMs);
}

/**
 * Drops windows nobody is inside any more. Called from the same places that
 * already prune magic links, so the table cannot grow one row per IP forever.
 */
export async function pruneRateLimits(olderThanMs: number): Promise<void> {
  try {
    await db.rateLimit.deleteMany({
      where: { windowStart: { lt: new Date(Date.now() - olderThanMs) } },
    });
  } catch (error) {
    console.error(`[stamp] rate limit prune failed:`, error);
  }
}

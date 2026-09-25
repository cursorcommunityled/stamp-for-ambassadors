import { db } from "@/lib/db";

/**
 * Pool assignment. Lives apart from claim.ts and roster.ts because both need
 * it: the attendee tapping Claim and the door scan handing credits out
 * automatically go through the same atomic take.
 */

/**
 * Postgres unique-violation (23505), however the driver wrapped it. Raw
 * queries surface as P2010 with the driver code in `meta`; the pg adapter can
 * also throw the underlying error directly.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { code, meta, message } = error as {
    code?: unknown;
    meta?: { code?: unknown };
    message?: unknown;
  };

  if (code === "23505" || code === "P2002") return true;
  if (meta?.code === "23505") return true;
  return typeof message === "string" && message.includes("23505");
}

/**
 * Takes one unused row out of a sponsor's pool for this attendee.
 *
 * Returns null when the pool is empty, and also when we lost a race: two
 * simultaneous claims each take a *different* row because SKIP LOCKED skips
 * the other's lock, and the second commit then trips
 * @@unique([eventId, sponsorId, claimedByAttendeeId]). Callers re-read to
 * find out which of the two happened.
 */
export async function takeCode(
  eventId: string,
  sponsorId: string,
  attendeeId: string,
): Promise<string | null> {
  try {
    const rows = await db.$queryRaw<{ code: string }[]>`
      UPDATE "Code" SET "claimedByAttendeeId" = ${attendeeId}, "claimedAt" = now()
      WHERE id = (
        SELECT id FROM "Code"
        WHERE "sponsorId" = ${sponsorId}
          AND "eventId" = ${eventId}
          AND "claimedByAttendeeId" IS NULL
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING code
    `;
    return rows[0]?.code ?? null;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return null;
  }
}

/**
 * Fills every pool this attendee is still missing and returns how many codes
 * they now hold. Idempotent, so it is safe to re-run on each sync, which is
 * what lets codes uploaded *after* a door scan still reach people who were
 * already checked in.
 */
export async function assignAllCodes(
  eventId: string,
  attendeeId: string,
): Promise<number> {
  const [available, mine] = await Promise.all([
    db.code.groupBy({
      by: ["sponsorId"],
      where: { eventId, claimedByAttendeeId: null },
    }),
    db.code.findMany({
      where: { eventId, claimedByAttendeeId: attendeeId },
      select: { sponsorId: true },
    }),
  ]);

  const held = new Set(mine.map((row) => row.sponsorId));

  for (const pool of available) {
    if (held.has(pool.sponsorId)) continue;
    if (await takeCode(eventId, pool.sponsorId, attendeeId)) {
      held.add(pool.sponsorId);
    }
  }

  return held.size;
}

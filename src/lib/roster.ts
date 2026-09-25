import { createMagicLink, EVENT_LINK_TTL_MS } from "@/lib/auth";
import { assignAllCodes } from "@/lib/codes";
import { db } from "@/lib/db";
import {
  getGuestByEmail,
  listGuests,
  LumaError,
  type NormalizedGuest,
} from "@/lib/luma";
import { hasEnded } from "@/lib/events";
import { maySendMail, sendCreditsReadyEmail } from "@/lib/mail";
import { normalizeEmail } from "@/lib/utils";

/**
 * The event roster lives in Postgres and is refreshed from Luma at most once
 * per TTL. Reading a stamp is then a local query, which is what lets the
 * status page poll for a door scan without spending the 200 requests/minute
 * calendar budget on every page view.
 */

const SYNC_TTL_MS = 60_000;

export type RosterSync = {
  /** True when this caller was the one that went to Luma. */
  ran: boolean;
  /** Human-readable Luma failure, or null when the sync was fine or skipped. */
  error: string | null;
  lumaGuestId?: string | null;
};

const SKIPPED: RosterSync = { ran: false, error: null };

/**
 * Claims the right to sync with a single conditional UPDATE. Exactly one
 * concurrent caller gets a row back, so a room full of people opening the
 * page at once still produces one Luma sync.
 *
 * The timestamp moves when the sync is claimed. A failed Luma call then
 * rolls it back so the next tab retries in seconds instead of a full minute.
 */
async function claimSyncSlot(eventId: string, ttlMs: number): Promise<boolean> {
  const staleBefore = new Date(Date.now() - ttlMs);
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Event"
    SET "guestsSyncedAt" = now()
    WHERE id = ${eventId}
      AND ("guestsSyncedAt" IS NULL OR "guestsSyncedAt" < ${staleBefore})
    RETURNING id
  `;
  return rows.length > 0;
}

function attendeeFields(guest: NormalizedGuest) {
  return {
    email: guest.email,
    name: guest.name,
    approvalStatus: guest.approvalStatus,
    registeredAt: guest.registeredAt,
    checkedInAt: guest.checkedInAt,
  };
}

/** Upserts on lumaGuestId, not email. People do change the address on a registration. */
async function writeRoster(eventId: string, guests: NormalizedGuest[]) {
  const CHUNK = 50;
  for (let i = 0; i < guests.length; i += CHUNK) {
    await db.$transaction(
      guests.slice(i, i + CHUNK).map((guest) =>
        db.eventAttendee.upsert({
          where: {
            eventId_lumaGuestId: { eventId, lumaGuestId: guest.lumaGuestId },
          },
          create: {
            eventId,
            lumaGuestId: guest.lumaGuestId,
            ...attendeeFields(guest),
          },
          update: attendeeFields(guest),
        }),
      ),
    );
  }
}

function lumaMessage(error: unknown): string {
  return error instanceof LumaError
    ? error.message
    : "Could not reach Luma. Try again in a moment.";
}

/**
 * How many people we hand credits to in one pass. A door rush can stamp
 * more than this in a minute, so deliverCredits loops until the backlog
 * drains (or hits MAX_DELIVERY_BATCHES).
 */
const DELIVERY_BATCH = 20;
const MAX_DELIVERY_BATCHES = 10;
/** After a Luma failure, retry in 15s instead of waiting out the full TTL. */
const FAILED_SYNC_RETRY_MS = 15_000;

type DeliveryEvent = {
  id: string;
  slug: string;
  name: string;
  perksRequireCheckIn: boolean;
};

type PendingAttendee = {
  id: string;
  email: string;
  creditsAssignedAt: Date | null;
  notifiedAt: Date | null;
  codes: { sponsorId: string }[];
};

function entitledWhere(event: DeliveryEvent) {
  return {
    eventId: event.id,
    approvalStatus: "approved" as const,
    ...(event.perksRequireCheckIn ? { checkedInAt: { not: null } } : {}),
  };
}

function needsDelivery(
  attendee: PendingAttendee,
  availableSponsorIds: Set<string>,
): boolean {
  const held = new Set(attendee.codes.map((row) => row.sponsorId));
  if ([...availableSponsorIds].some((id) => !held.has(id))) return true;
  return held.size > 0 && (!attendee.creditsAssignedAt || !attendee.notifiedAt);
}

async function nextDeliveryBatch(
  event: DeliveryEvent,
  take: number,
): Promise<PendingAttendee[]> {
  const select = {
    id: true,
    email: true,
    creditsAssignedAt: true,
    notifiedAt: true,
    codes: { select: { sponsorId: true } },
  } as const;

  const [unassigned, available] = await Promise.all([
    db.eventAttendee.findMany({
      where: {
        ...entitledWhere(event),
        creditsAssignedAt: null,
      },
      orderBy: { checkedInAt: { sort: "asc", nulls: "last" } },
      take,
      select,
    }),
    db.code.groupBy({
      by: ["sponsorId"],
      where: { eventId: event.id, claimedByAttendeeId: null },
    }),
  ]);

  const availableSponsorIds = new Set(available.map((row) => row.sponsorId));
  const work = unassigned.filter((attendee) =>
    needsDelivery(attendee, availableSponsorIds),
  );
  if (work.length >= take || availableSponsorIds.size === 0) {
    return work.slice(0, take);
  }

  const extra = await db.eventAttendee.findMany({
    where: {
      ...entitledWhere(event),
      ...(work.length > 0
        ? { id: { notIn: work.map((row) => row.id) } }
        : {}),
    },
    orderBy: { checkedInAt: { sort: "asc", nulls: "last" } },
    take: take * 3,
    select,
  });

  for (const attendee of extra) {
    if (!needsDelivery(attendee, availableSponsorIds)) continue;
    work.push(attendee);
    if (work.length >= take) break;
  }

  return work.slice(0, take);
}

async function deliverOne(
  event: DeliveryEvent,
  attendee: { id: string; email: string; creditsAssignedAt: Date | null; notifiedAt: Date | null },
) {
  // Re-running assignment is deliberate: it is idempotent, and it means codes
  // uploaded after someone was scanned in still find their way to them.
  const codeCount = await assignAllCodes(event.id, attendee.id);
  if (codeCount === 0) return;

  const data: { creditsAssignedAt?: Date; notifiedAt?: Date } = {};
  if (!attendee.creditsAssignedAt) data.creditsAssignedAt = new Date();

  // Codes can be handed out on a laptop. The mail cannot. `maySendMail` is
  // false everywhere except the Render service, so opening a status page
  // here updates the local roster and does not write to a registered inbox.
  if (!attendee.notifiedAt && maySendMail()) {
    try {
      const url = await createMagicLink(
        attendee.email,
        `/e/${event.slug}/status`,
        EVENT_LINK_TTL_MS,
      );
      await sendCreditsReadyEmail({
        email: attendee.email,
        url,
        eventName: event.name,
        codeCount,
      });
      data.notifiedAt = new Date();
    } catch (error) {
      console.error(`[stamp] credits email failed for ${attendee.email}:`, error);
    }
  }

  if (Object.keys(data).length === 0) return;
  await db.eventAttendee.update({ where: { id: attendee.id }, data });
}

/**
 * Hands out credits to everyone newly entitled to them, so nobody has to know
 * this app exists to end up holding their codes. Gated on the door scan
 * unless the event says an approved registration is enough.
 *
 * Always runs *after* the roster write, because that write is what brings a
 * fresh `checkedInAt` over from Luma. Also covers people who were already
 * notified: a CSV uploaded after their scan still fills the missing pools.
 */
export async function deliverCredits(eventId: string) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, slug: true, name: true, perksRequireCheckIn: true },
  });
  if (!event) return;

  for (let n = 0; n < MAX_DELIVERY_BATCHES; n += 1) {
    const pending = await nextDeliveryBatch(event, DELIVERY_BATCH);
    if (pending.length === 0) return;

    // One person's bad address must not stop everyone else's credits.
    const results = await Promise.allSettled(
      pending.map((attendee) => deliverOne(event, attendee)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`[stamp] credit delivery failed:`, result.reason);
      }
    }

    if (pending.length < DELIVERY_BATCH) return;
  }
}

async function runSync(event: {
  id: string;
  lumaEventId: string;
}): Promise<RosterSync> {
  let result: RosterSync;
  try {
    await writeRoster(event.id, await listGuests(event.lumaEventId));
    result = { ran: true, error: null };
  } catch (error) {
    console.error(`[stamp] roster sync failed for ${event.lumaEventId}:`, error);
    result = { ran: true, error: lumaMessage(error) };
    // Slot was claimed at the start of the TTL. Roll it back so the next
    // open tab retries in seconds, not a full minute, without a stampede.
    await db.event.update({
      where: { id: event.id },
      data: {
        guestsSyncedAt: new Date(Date.now() - SYNC_TTL_MS + FAILED_SYNC_RETRY_MS),
      },
    });
  }

  // Runs even when Luma failed: an earlier sync may have left people owed
  // codes, or an email that needs retrying. A finished night is a record,
  // though, so that pass must not discover an old backlog and mail it.
  await deliverIfLive(event.id);
  return result;
}

/** Credits and credit mail for an event that is still live. */
async function deliverIfLive(eventId: string) {
  const dates = await db.event.findUnique({
    where: { id: eventId },
    select: { startAt: true, endAt: true },
  });
  if (!dates || hasEnded(dates)) return;
  await deliverCredits(eventId);
}

/** Refreshes the roster only if nobody else has within the TTL. */
export async function syncRosterIfStale(
  event: { id: string; lumaEventId: string },
  ttlMs = SYNC_TTL_MS,
): Promise<RosterSync> {
  if (!(await claimSyncSlot(event.id, ttlMs))) return SKIPPED;
  return runSync(event);
}

/** Ignores the TTL. For the organizer's explicit "sync now". */
export async function syncRosterNow(event: {
  id: string;
  lumaEventId: string;
}): Promise<RosterSync> {
  await claimSyncSlot(event.id, 0);
  return runSync(event);
}

/**
 * One targeted lookup for a single guest. Costs one Luma request, so it
 * belongs behind an explicit "check again" action, never on a page render.
 */
export async function refreshAttendee(
  event: { id: string; lumaEventId: string },
  rawEmail: string,
): Promise<RosterSync> {
  const email = normalizeEmail(rawEmail);
  let result: RosterSync;
  try {
    const guest = await getGuestByEmail(event.lumaEventId, email);
    if (guest) await writeRoster(event.id, [guest]);
    result = { ran: true, error: null, lumaGuestId: guest?.lumaGuestId ?? null };
  } catch (error) {
    console.error(`[stamp] guest refresh failed for ${email}:`, error);
    result = { ran: true, error: lumaMessage(error), lumaGuestId: null };
  }

  await deliverIfLive(event.id);
  return result;
}

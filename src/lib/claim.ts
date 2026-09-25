import { after } from "next/server";
import { takeCode } from "@/lib/codes";
import { db } from "@/lib/db";
import type { NormalizedGuest } from "@/lib/luma";
import { refreshAttendee, syncRosterIfStale } from "@/lib/roster";
import { normalizeEmail } from "@/lib/utils";

export type StampLock =
  | "not_on_list"
  | "not_approved"
  | "not_checked_in"
  | "luma_error";

export type StampStatus = {
  attendeeId: string | null;
  guest: NormalizedGuest | null;
  locked: StampLock | null;
  lockedReason: string | null;
};

function lockFromGuest(
  guest: NormalizedGuest,
  requireCheckIn: boolean,
): { locked: StampLock; reason: string } | null {
  if (guest.approvalStatus === "declined") {
    return {
      locked: "not_approved",
      reason: "This registration was declined on Luma.",
    };
  }
  if (guest.approvalStatus === "waitlist") {
    return {
      locked: "not_approved",
      reason: "You are on the waitlist. Credits unlock if a spot opens up.",
    };
  }
  if (guest.approvalStatus === "pending_approval") {
    return {
      locked: "not_approved",
      reason: "Your registration is still pending approval on Luma.",
    };
  }
  if (guest.approvalStatus === "invited") {
    return {
      locked: "not_approved",
      reason: "You are invited but have not registered on Luma yet.",
    };
  }
  if (guest.approvalStatus !== "approved") {
    return {
      locked: "not_approved",
      reason: "Registration isn't approved on Luma yet.",
    };
  }
  if (requireCheckIn && !guest.checkedInAt) {
    return {
      locked: "not_checked_in",
      reason:
        "Get scanned at the door. Your credits unlock the moment you are. This page is watching, so leave it open.",
    };
  }
  return null;
}

export type StampEvent = {
  id: string;
  lumaEventId: string;
  perksRequireCheckIn: boolean;
};

/**
 * Reads the stamp from the local roster. A guest we already know about stays
 * readable even while Luma is unreachable. Stale beats an error message, and
 * only a guest we have never seen surfaces `luma_error`.
 */
async function readStamp(
  event: StampEvent,
  email: string,
  syncError: string | null,
  lumaGuestId?: string | null,
): Promise<StampStatus> {
  const attendee = await db.eventAttendee.findFirst({
    where: {
      eventId: event.id,
      OR: [
        { email },
        ...(lumaGuestId ? [{ lumaGuestId }] : []),
      ],
    },
    // Prefer a checked-in registration when one guest has several.
    orderBy: [
      { checkedInAt: { sort: "desc", nulls: "last" } },
      { registeredAt: { sort: "desc", nulls: "last" } },
    ],
  });

  if (!attendee) {
    return {
      attendeeId: null,
      guest: null,
      locked: syncError ? "luma_error" : "not_on_list",
      lockedReason:
        syncError ??
        "That email is not on this guest list yet. If you just registered, leave this page open — it watches Luma.",
    };
  }

  const guest: NormalizedGuest = {
    lumaGuestId: attendee.lumaGuestId,
    email: attendee.email,
    name: attendee.name,
    approvalStatus: attendee.approvalStatus,
    registeredAt: attendee.registeredAt,
    checkedInAt: attendee.checkedInAt,
  };

  const lock = lockFromGuest(guest, event.perksRequireCheckIn);
  return {
    attendeeId: attendee.id,
    guest,
    locked: lock?.locked ?? null,
    lockedReason: lock?.reason ?? null,
  };
}

/** Page-render path: never wait on a full-room Luma list. */
export async function resolveStamp(
  event: StampEvent,
  rawEmail: string,
): Promise<StampStatus> {
  const email = normalizeEmail(rawEmail);

  // One guest lookup unlocks this person. The roster for everyone else
  // catches up after the response so a slow Luma list cannot freeze login.
  after(async () => {
    try {
      await syncRosterIfStale(event);
    } catch (error) {
      console.error(`[stamp] background roster sync failed:`, error);
    }
  });

  let stamp = await readStamp(event, email, null);
  if (stamp.locked && claimLookup(pageLookupAt, event.id, email, PAGE_LOOKUP_MS)) {
    const personal = await refreshAttendee(event, email);
    stamp = await readStamp(
      event,
      email,
      personal.error,
      personal.lumaGuestId,
    );
  }
  return stamp;
}

const pageLookupAt = new Map<string, number>();
const recheckAt = new Map<string, number>();

/** A locked page reloads on a timer, so it asks Luma far less often than it renders. */
const PAGE_LOOKUP_MS = 20_000;
/**
 * "Check again" is a button, and a queue at the door mashes buttons. Luma
 * allows 200 calls a minute for the whole calendar, shared with the roster
 * sync, so a handful of impatient people could spend the budget in seconds.
 */
const RECHECK_MS = 6_000;

/**
 * True at most once per `ttlMs` for this guest. Held in memory, so it flattens
 * one person hammering one instance rather than acting as a fleet-wide quota.
 */
function claimLookup(
  seen: Map<string, number>,
  eventId: string,
  email: string,
  ttlMs: number,
): boolean {
  const key = `${eventId}:${email}`;
  const prev = seen.get(key) ?? 0;
  if (Date.now() - prev < ttlMs) return false;
  if (seen.size > 2000) seen.clear();
  seen.set(key, Date.now());
  return true;
}

/** Explicit "check again": one targeted Luma lookup for this guest only. */
export async function recheckStamp(
  event: StampEvent,
  rawEmail: string,
): Promise<StampStatus> {
  const email = normalizeEmail(rawEmail);
  // Inside the cooldown, answer from the roster the background sync maintains.
  if (!claimLookup(recheckAt, event.id, email, RECHECK_MS)) {
    return readStamp(event, email, null);
  }
  const sync = await refreshAttendee(event, email);
  return readStamp(event, email, sync.error, sync.lumaGuestId);
}

/**
 * Whatever we last knew, with no Luma call at all. For events that are over:
 * the roster cannot change any more, so spending a request on it is waste.
 */
export async function storedStamp(
  event: StampEvent,
  rawEmail: string,
): Promise<StampStatus> {
  return readStamp(event, normalizeEmail(rawEmail), null);
}

export class ClaimError extends Error {
  constructor(
    readonly code:
      | StampLock
      | "unauthenticated"
      | "unknown_sponsor"
      | "out_of_codes"
      | "ended",
    message: string,
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

/**
 * Hands out one code from the sponsor pool. Idempotent: a second click
 * returns the code already assigned to this guest.
 */
export async function claimCode(input: {
  eventId: string;
  lumaEventId: string;
  perksRequireCheckIn: boolean;
  email: string;
  sponsorSlug: string;
}): Promise<{ code: string; alreadyHad: boolean }> {
  const sponsor = await db.sponsor.findUnique({
    where: { slug: input.sponsorSlug },
  });
  if (!sponsor) {
    throw new ClaimError("unknown_sponsor", "That partner is not on this event.");
  }

  const stamp = await resolveStamp(
    {
      id: input.eventId,
      lumaEventId: input.lumaEventId,
      perksRequireCheckIn: input.perksRequireCheckIn,
    },
    input.email,
  );

  if (stamp.locked || !stamp.attendeeId) {
    throw new ClaimError(
      stamp.locked ?? "not_on_list",
      stamp.lockedReason ?? "You cannot claim credits yet.",
    );
  }

  const existing = await db.code.findFirst({
    where: {
      eventId: input.eventId,
      sponsorId: sponsor.id,
      claimedByAttendeeId: stamp.attendeeId,
    },
    select: { code: true },
  });
  if (existing) {
    return { code: existing.code, alreadyHad: true };
  }

  const assigned = await takeCode(input.eventId, sponsor.id, stamp.attendeeId);
  if (assigned) {
    return { code: assigned, alreadyHad: false };
  }

  // Either the pool is empty, or the write above lost a race.
  const raced = await db.code.findFirst({
    where: {
      eventId: input.eventId,
      sponsorId: sponsor.id,
      claimedByAttendeeId: stamp.attendeeId,
    },
    select: { code: true },
  });
  if (raced) {
    return { code: raced.code, alreadyHad: true };
  }

  throw new ClaimError(
    "out_of_codes",
    "This sponsor is out of codes. Find an organizer.",
  );
}

export function parseCsvCodes(text: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const cell = line
      .split(/[,;\t]/)[0]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (!cell) continue;
    if (codes.length === 0 && /^(code|codes|coupon|key)$/i.test(cell)) {
      continue;
    }
    const key = cell.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(cell);
  }

  return codes;
}

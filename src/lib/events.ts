import { publicOrigin } from "@/lib/app-url";
import type { ImportedLumaEvent } from "@/lib/luma";

export type EventCard = {
  slug: string;
  name: string;
  lumaEventId: string;
  startAt: Date | null;
  endAt: Date | null;
  timezone: string | null;
  location: string | null;
  coverUrl: string | null;
};

export function eventCover(event: {
  lumaEventId: string;
  coverUrl?: string | null;
}): string {
  return event.coverUrl || "/images/events/cover.png";
}

/** Absolute cover for a chat preview. Relative plates need the live origin. */
export function eventShareImage(event: {
  lumaEventId: string;
  coverUrl?: string | null;
}): string {
  const src = eventCover(event);
  if (/^https?:\/\//.test(src)) return src;
  return `${publicOrigin()}${src.startsWith("/") ? src : `/${src}`}`;
}

/**
 * Luma decides what lands in this column and `Intl` throws on anything it does
 * not recognise. An unfamiliar zone should move a printed time, not take down
 * the page someone is reading their credits off.
 */
function safeTimeZone(timezone: string | null | undefined): string | undefined {
  if (!timezone) return undefined;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
}

function formatEventStamp(
  startAt: Date,
  timezone: string | null | undefined,
  time: boolean,
): string {
  return (
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(time ? { hour: "numeric", minute: "2-digit" } : {}),
      timeZone: safeTimeZone(timezone),
    })
      .format(startAt)
      // en-GB is the only month it abbreviates to four letters. These dates
      // stack in a column beside eleven three-letter ones.
      .replace("Sept", "Sep")
  );
}

export function formatEventWhen(
  startAt: Date | null | undefined,
  timezone?: string | null,
): string | null {
  if (!startAt) return null;
  return formatEventStamp(startAt, timezone, true);
}

/** Showcase record: the night, not the door time. */
export function formatEventDay(
  startAt: Date | null | undefined,
  timezone?: string | null,
): string | null {
  if (!startAt) return null;
  return formatEventStamp(startAt, timezone, false);
}

/** Open mic and voting, local wall clock, on the event's start day. */
const OPEN_MIC_HOUR = 20;
const OPEN_MIC_MINUTE = 30;

/**
 * Instant for a local wall time on the same calendar day as `startAt`
 * in the event timezone. Used for program beats Luma does not carry.
 */
export function wallTimeOnEventDay(
  startAt: Date,
  timezone: string | null,
  hour: number,
  minute: number,
): Date {
  const tz = safeTimeZone(timezone) ?? "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(startAt);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(
    zonedWallMs(tz, num("year"), num("month"), num("day"), hour, minute),
  );
}

export function openMicAt(
  startAt: Date | null,
  endAt: Date | null,
  timezone: string | null,
): Date | null {
  if (!startAt) return null;
  const at = wallTimeOnEventDay(
    startAt,
    timezone,
    OPEN_MIC_HOUR,
    OPEN_MIC_MINUTE,
  );
  if (at.getTime() <= startAt.getTime()) return null;
  if (endAt && at.getTime() >= endAt.getTime()) return null;
  return at;
}

function zonedWallMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const asUtcWall = (ms: number) => {
    const map: Record<string, string> = {};
    for (const part of dtf.formatToParts(new Date(ms))) {
      if (part.type !== "literal") map[part.type] = part.value;
    }
    return Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
  };
  let t = desired;
  t += desired - asUtcWall(t);
  t += desired - asUtcWall(t);
  return t;
}

/**
 * Doors and claims stay live past the calendar close. Late scans, lingering
 * guests, and Luma lag all happen after "end". Treating `startAt` as the
 * close is worse: Luma often omits `endAt`, which would freeze the roster
 * the moment the event begins.
 */
const LIVE_AFTER_END_MS = 6 * 60 * 60 * 1000;
const LIVE_AFTER_START_MS = 18 * 60 * 60 * 1000;

export function isUpcomingEvent(event: {
  startAt: Date | null;
  endAt: Date | null;
}, now = new Date()): boolean {
  if (event.endAt) {
    return event.endAt.getTime() + LIVE_AFTER_END_MS >= now.getTime();
  }
  if (event.startAt) {
    return event.startAt.getTime() + LIVE_AFTER_START_MS >= now.getTime();
  }
  return true;
}

/**
 * A finished event is read-only: nothing left to claim, nobody left to scan
 * in. An event with no date at all counts as still to come.
 */
export function hasEnded(
  event: { startAt: Date | null; endAt: Date | null },
  now = new Date(),
): boolean {
  return !isUpcomingEvent(event, now);
}

export function sortEvents<T extends { startAt: Date | null; createdAt?: Date }>(
  events: T[],
  upcoming: boolean,
): T[] {
  return [...events].sort((a, b) => {
    if (!a.startAt && !b.startAt) return 0;
    if (!a.startAt) return -1;
    if (!b.startAt) return 1;
    return upcoming
      ? a.startAt.getTime() - b.startAt.getTime()
      : b.startAt.getTime() - a.startAt.getTime();
  });
}

export function splitEvents<T extends { startAt: Date | null; endAt: Date | null }>(
  events: T[],
  now = new Date(),
) {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const event of events) {
    if (isUpcomingEvent(event, now)) upcoming.push(event);
    else past.push(event);
  }
  return {
    upcoming: sortEvents(upcoming, true),
    past: sortEvents(past, false),
  };
}

/**
 * Throwaway row from `preview.ts`. It clones a live event so status-page
 * states can be clicked through, and must not appear as a second night to
 * attendees, in admin Upcoming, or as a leftover-code destination.
 */
export function isFixtureEvent(event: { lumaEventId: string }): boolean {
  return event.lumaEventId.startsWith("evt-preview-");
}

export function attendeeEvents<T extends { lumaEventId: string }>(
  events: T[],
): T[] {
  return events.filter((event) => !isFixtureEvent(event));
}

export function eventSlugFromPath(path: string): string | null {
  const match = path.match(/^\/e\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export function eventSnapshot(imported: ImportedLumaEvent) {
  return {
    name: imported.name,
    lumaEventId: imported.lumaEventId,
    startAt: imported.startAt,
    endAt: imported.endAt,
    timezone: imported.timezone,
    location: imported.location,
    coverUrl: imported.coverUrl,
    lumaUrl: imported.lumaUrl,
    description: imported.description,
  };
}

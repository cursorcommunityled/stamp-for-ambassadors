import { db } from "@/lib/db";
import { attendeeEvents, splitEvents } from "@/lib/events";
import { normalizeEmail } from "@/lib/utils";

/**
 * Where "My credits" leads. Only ever a night this address is registered
 * for. One event being the only one still to come does not make it theirs:
 * every city's nights live on the same site, so aiming a Skopje attendee at
 * a Prague status page greets them with "not on this list" for a list they
 * never said they were on.
 *
 * Anything other than exactly one match is a real choice, and the event list
 * is where a choice gets made.
 */
export async function creditsPath(email: string): Promise<string> {
  const events = await db.event.findMany({
    where: { attendees: { some: { email: normalizeEmail(email) } } },
    select: { slug: true, lumaEventId: true, startAt: true, endAt: true },
  });
  const { upcoming } = splitEvents(attendeeEvents(events));
  const [only] = upcoming;
  return upcoming.length === 1 && only ? `/e/${only.slug}/status` : "/";
}

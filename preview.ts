/**
 * Spins up a throwaway live event and prints sign-in links for the two states
 * attendees actually see: waiting for the door scan, and stamped.
 *
 * The homepage, "My credits", and the admin event list all ignore
 * `evt-preview-*` rows, so this never looks like a second city night and
 * never shows up anywhere you would mistake it for one. Reach it through the
 * links printed below, and tear it down with `--clean` when done.
 */
import "dotenv/config";
import { db } from "./src/lib/db";
import { createMagicLink } from "./src/lib/auth";
const DOMAIN = "@preview.invalid";
const SLUG = "preview";

async function teardown() {
  const events = await db.event.findMany({ where: { slug: SLUG }, select: { id: true } });
  for (const e of events) {
    await db.code.deleteMany({ where: { eventId: e.id } });
    await db.eventAttendee.deleteMany({ where: { eventId: e.id } });
    await db.event.delete({ where: { id: e.id } });
  }
  await db.magicLink.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}

async function main() {
  if (process.argv.includes("--clean")) {
    await teardown();
    console.log("preview removed");
    return;
  }

  await teardown();
  const now = Date.now();
  const cursor = await db.sponsor.findUniqueOrThrow({ where: { slug: "cursor" } });

  // Live right now, whenever this runs: doors an hour ago, and a close late
  // enough that the 20:30 open mic still falls inside the programme.
  const at = (hour: number, minute: number) => {
    const d = new Date(now);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const startAt = new Date(now - 3600_000);
  const endAt = at(23, 30);

  const event = await db.event.create({
    data: {
      slug: SLUG,
      name: "Build with Cursor",
      lumaEventId: `evt-preview-${now}`,
      perksRequireCheckIn: true,
      startAt,
      endAt,
      timezone: "UTC",
      // Fresh, so rendering never reaches for Luma or triggers delivery.
      guestsSyncedAt: new Date(now),
    },
  });

  await db.eventAttendee.createMany({
    data: [
      {
        eventId: event.id,
        lumaGuestId: "gst-preview-stamped",
        email: `stamped${DOMAIN}`,
        name: "Stefan",
        approvalStatus: "approved",
        registeredAt: new Date(now - 86400_000),
        checkedInAt: new Date(now - 1800_000),
      },
      {
        eventId: event.id,
        lumaGuestId: "gst-preview-waiting",
        email: `waiting${DOMAIN}`,
        name: "Ana Waiting",
        approvalStatus: "approved",
        registeredAt: new Date(now - 86400_000),
        checkedInAt: null,
      },
    ],
  });

  await db.code.createMany({
    data: Array.from({ length: 6 }, (_, i) => ({
      eventId: event.id,
      sponsorId: cursor.id,
      code: `https://cursor.com/referral/preview-${i}-${now}`,
    })),
  });
  await db.project.createMany({
    data: [
      {
        eventId: event.id,
        name: "Grant finder",
        builders: "Ana & Marko",
        description: "Matches you to public grants from a short form.",
        sortOrder: 1,
      },
      {
        eventId: event.id,
        name: "Door list",
        builders: "Lea K.",
        description: "Who is still outside, from the Luma check-in.",
        sortOrder: 2,
      },
      {
        eventId: event.id,
        name: "Demo clock",
        builders: "Nik & Sofi",
        description: "A three-minute timer the host can throw on the projector.",
        sortOrder: 3,
      },
      {
        eventId: event.id,
        name: "Sponsor wall",
        builders: "Team Orbit",
        description: "Tonight’s partners, one card each, no leftover copy.",
        sortOrder: 4,
      },
      {
        eventId: event.id,
        name: "Meetup photos",
        builders: "Ivana",
        description: "A shared album that closes when the build night does.",
        sortOrder: 5,
      },
    ],
  });

  await db.event.update({
    where: { id: event.id },
    data: { votingOpenedAt: new Date(), votingClosedAt: null },
  });

  const next = `/e/${SLUG}/status`;
  for (const who of ["stamped", "waiting"]) {
    const url = await createMagicLink(`${who}${DOMAIN}`, next, 6 * 3600_000);
    console.log(`${who}: ${url}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

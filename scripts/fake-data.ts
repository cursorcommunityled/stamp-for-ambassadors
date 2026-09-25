/**
 * Fills a local database with fake nights so every screen has something on
 * it: a live build night with the ballot open, an upcoming cafe, a finished
 * build night on the showcase, and a finished meetup. No codes are loaded.
 * The host uploads Cursor credits.
 *
 *   npx tsx scripts/fake-data.ts                  create (replaces any earlier run)
 *   npx tsx scripts/fake-data.ts checkin <email>  simulate the door scan
 *   npx tsx scripts/fake-data.ts links            fresh sign-in links
 *   npx tsx scripts/fake-data.ts --clean          remove everything it made
 *
 * Unlike `preview.ts`, these rows are meant to be seen, so the Luma ids start
 * with `evt-fake-` rather than `evt-preview-`. None of them exist on Luma.
 * Both sync clocks are pushed far into the future so pages never try to
 * refresh them; only an explicit "Sync now" or "Check again" reaches for
 * Luma, and that fails with a readable message.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { createMagicLink, EVENT_LINK_TTL_MS } from "../src/lib/auth";

if (process.env.RENDER || process.env.NODE_ENV === "production") {
  console.error("Refusing to write fake data outside a laptop.");
  process.exit(1);
}

const LUMA_PREFIX = "evt-fake-";
const DOMAIN = "@example.test";
const TZ = "Europe/Skopje";
const NEVER_SYNC = new Date("2099-01-01T00:00:00Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const ADMIN =
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .find(Boolean) ?? `admin${DOMAIN}`;

const SLUGS = {
  live: "build-night-live",
  upcoming: "cafe-cursor-next-week",
  past: "build-night-august",
  meetup: "meetup-july",
};

const FIRST = [
  "Ana", "Marko", "Lea", "Nikola", "Sofija", "Stefan", "Ivana", "Petar",
  "Elena", "Filip", "Maja", "Luka", "Teodora", "Bojan", "Kristina", "David",
  "Mila", "Aleksandar", "Jana", "Viktor", "Sara", "Damjan", "Eva", "Andrej",
  "Tamara", "Goran", "Nina", "Igor", "Vesna", "Darko", "Irena", "Toni",
];
const LAST = [
  "Petrovska", "Nikolov", "Stojanova", "Trajkovski", "Ilievska", "Georgiev",
  "Dimitrova", "Kostov", "Angelova", "Jovanov", "Mitrevska", "Popov",
];

type Guest = {
  lumaGuestId: string;
  email: string;
  name: string | null;
  approvalStatus: string;
  registeredAt: Date;
  checkedInAt: Date | null;
};

function crowd(
  tag: string,
  count: number,
  now: number,
  checkedIn: (i: number) => boolean,
): Guest[] {
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    // Roughly one in twelve is not a clean approval, like a real list.
    const approvalStatus =
      i % 12 === 5 ? "waitlist" : i % 12 === 9 ? "pending_approval" : "approved";
    return {
      lumaGuestId: `gst-fake-${tag}-${i}`,
      email: `${first}.${last}.${tag}${i}${DOMAIN}`.toLowerCase(),
      name: `${first} ${last}`,
      approvalStatus,
      registeredAt: new Date(now - (3 + (i % 10)) * DAY),
      checkedInAt:
        approvalStatus === "approved" && checkedIn(i)
          ? new Date(now - (i % 50) * 60_000)
          : null,
    };
  });
}

const WAITING = `waiting${DOMAIN}`;
const CHECKED_IN = `checked.in${DOMAIN}`;
const PENDING_HOST = `pending.host${DOMAIN}`;

/** The two addresses you sign in as on the live night. */
function personas(now: number): (Guest & { role: string })[] {
  const base = { registeredAt: new Date(now - 4 * DAY) };
  return [
    {
      role: "Checked in, waiting on the host to upload credits",
      lumaGuestId: "gst-local-checked-in",
      email: CHECKED_IN,
      name: null,
      approvalStatus: "approved",
      checkedInAt: new Date(now - 30 * 60_000),
      ...base,
    },
    {
      role: "Registered, not checked in",
      lumaGuestId: "gst-local-waiting",
      email: WAITING,
      name: null,
      approvalStatus: "approved",
      checkedInAt: null,
      ...base,
    },
  ];
}

const LIVE_PROJECTS = [
  { name: "Grant finder", builders: "Ana & Marko", description: "Matches you to public grants from a short form." },
  { name: "Demo clock", builders: "Nik & Sofi", description: "A three-minute timer the host can throw on the projector." },
  { name: "Menu translator", builders: "Filip, Maja & Luka", description: null },
];

const PAST_PROJECTS = [
  { name: "Bus Radar", builders: "Teodora & Bojan", description: "Live city bus positions and a guess at when yours actually arrives." },
  { name: "Recipe Remix", builders: "Kristina", description: "Photograph your fridge, get three dinners you can make tonight." },
  { name: "Gig Finder", builders: "Jana & Viktor", description: null },
];

async function teardown() {
  const events = await db.event.findMany({
    where: { lumaEventId: { startsWith: LUMA_PREFIX } },
    select: { id: true, slug: true },
  });
  // Codes, attendees, projects, and votes cascade with the event.
  await db.event.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { eventSlug: { in: Object.values(SLUGS) } },
        { detail: { endsWith: DOMAIN } },
      ],
    },
  });
  await db.host.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await db.magicLink.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: DOMAIN } } });
  return events.length;
}

async function createEvent(data: {
  slug: string;
  name: string;
  startAt: Date;
  endAt: Date;
  location: string;
  description: string;
  perksRequireCheckIn?: boolean;
  votingOpenedAt?: Date | null;
  votingClosedAt?: Date | null;
}) {
  return db.event.create({
    data: {
      perksRequireCheckIn: true,
      ...data,
      lumaEventId: `${LUMA_PREFIX}${data.slug}`,
      timezone: TZ,
      lumaUrl: `https://luma.com/${data.slug}`,
      guestsSyncedAt: NEVER_SYNC,
      hostsSyncedAt: NEVER_SYNC,
    },
  });
}

async function castVotes(
  eventId: string,
  voterIds: string[],
  projectIds: string[],
  weights: number[],
) {
  const ballot = projectIds.flatMap((id, i) => Array(weights[i] ?? 1).fill(id));
  await db.vote.createMany({
    data: voterIds.map((attendeeId, i) => ({
      eventId,
      attendeeId,
      projectId: ballot[(i * 5) % ballot.length],
    })),
  });
}

async function seed() {
  const now = Date.now();
  const cursor = await db.sponsor.findUnique({ where: { slug: "cursor" } });
  if (!cursor) {
    throw new Error("Cursor sponsor missing. Run `npm run db:seed` first.");
  }

  // ── Live build night: doors open, ballot open, no codes yet ──────────────
  const live = await createEvent({
    slug: SLUGS.live,
    name: "Build Night with Cursor",
    startAt: new Date(now - 2 * HOUR),
    endAt: new Date(now + 6 * HOUR),
    location: "Public Room, Skopje",
    description: "Bring a laptop and an idea. Demos at the open mic, the room votes.",
    votingOpenedAt: new Date(now - 20 * 60_000),
    votingClosedAt: null,
  });
  const liveGuests: Guest[] = [
    ...personas(now).map(
      ({ lumaGuestId, email, name, approvalStatus, registeredAt, checkedInAt }) =>
        ({ lumaGuestId, email, name, approvalStatus, registeredAt, checkedInAt }),
    ),
    ...crowd("live", 10, now, (i) => i % 3 !== 0),
  ];
  await db.eventAttendee.createMany({
    data: liveGuests.map((guest) => ({ eventId: live.id, ...guest })),
  });

  const liveRoster = await db.eventAttendee.findMany({
    where: { eventId: live.id },
    select: { id: true, email: true, approvalStatus: true, checkedInAt: true },
  });
  const stamped = liveRoster.filter(
    (a) => a.approvalStatus === "approved" && a.checkedInAt && a.email !== CHECKED_IN,
  );

  await db.project.createMany({
    data: LIVE_PROJECTS.map((p, i) => ({ eventId: live.id, ...p, sortOrder: i + 1 })),
  });
  const liveProjects = await db.project.findMany({
    where: { eventId: live.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  // About half the room has voted; you and the stamped persona have not.
  const liveVoters = stamped.slice(0, 3).map((a) => a.id);
  await castVotes(live.id, liveVoters, liveProjects.map((p) => p.id), [3, 1, 2]);

  // ── Upcoming cafe: nobody through the door yet, no ballot ────────────────
  const upcoming = await createEvent({
    slug: SLUGS.upcoming,
    name: "Cafe Cursor",
    startAt: new Date(now + 7 * DAY),
    endAt: new Date(now + 7 * DAY + 3 * HOUR),
    location: "Kafe Kino, Skopje",
    description: "Coffee, laptops, and whoever turns up. No demos.",
  });
  await db.eventAttendee.createMany({
    data: [
      ...crowd("cafe", 5, now, () => false),
    ].map((guest) => ({ eventId: upcoming.id, ...guest })),
  });

  // ── Past build night: ballot closed, on the showcase ─────────────────────
  const pastStart = new Date(now - 30 * DAY);
  const past = await createEvent({
    slug: SLUGS.past,
    name: "Build Night: August",
    startAt: pastStart,
    endAt: new Date(pastStart.getTime() + 5 * HOUR),
    location: "Public Room, Skopje",
    description: "Three demos, one winner.",
    votingOpenedAt: new Date(pastStart.getTime() + 3 * HOUR),
    votingClosedAt: new Date(pastStart.getTime() + 4 * HOUR),
  });
  await db.eventAttendee.createMany({
    data: [
      ...crowd("aug", 8, pastStart.getTime(), (i) => i % 4 !== 0),
    ].map((guest) => ({ eventId: past.id, ...guest })),
  });
  const pastStamped = await db.eventAttendee.findMany({
    where: { eventId: past.id, approvalStatus: "approved", checkedInAt: { not: null } },
    select: { id: true },
  });
  await db.project.createMany({
    data: PAST_PROJECTS.map((p, i) => ({ eventId: past.id, ...p, sortOrder: i + 1 })),
  });
  const pastProjects = await db.project.findMany({
    where: { eventId: past.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  await castVotes(past.id, pastStamped.map((a) => a.id), pastProjects.map((p) => p.id), [4, 1, 2]);

  // ── Past meetup: no ballot, leftover codes to move to the next night ─────
  const meetupStart = new Date(now - 60 * DAY);
  const meetup = await createEvent({
    slug: SLUGS.meetup,
    name: "Cursor Meetup: July",
    startAt: meetupStart,
    endAt: new Date(meetupStart.getTime() + 3 * HOUR),
    location: "Hub, Skopje",
    description: "Talks and pizza.",
    perksRequireCheckIn: false,
  });
  await db.eventAttendee.createMany({
    data: crowd("jul", 5, meetupStart.getTime(), (i) => i % 2 === 0).map(
      (guest) => ({ eventId: meetup.id, ...guest }),
    ),
  });
  await db.host.create({
    data: {
      email: PENDING_HOST,
      grantedBy: "luma",
      pendingNotifiedAt: new Date(now - DAY),
      events: { connect: [{ id: live.id }] },
    },
  });

  // ── Audit trail ──────────────────────────────────────────────────────────
  const log = [
    { at: 60 * DAY + HOUR, action: "event.create", eventSlug: SLUGS.meetup, detail: meetup.name },
    { at: 31 * DAY, action: "event.create", eventSlug: SLUGS.past, detail: past.name },
    { at: 30 * DAY - 3 * HOUR, action: "voting.open", eventSlug: SLUGS.past, detail: null },
    { at: 30 * DAY - 4 * HOUR, action: "voting.close", eventSlug: SLUGS.past, detail: null },
    { at: 3 * DAY, action: "event.create", eventSlug: SLUGS.live, detail: live.name },
    { at: 3 * DAY, action: "host.pending", eventSlug: SLUGS.live, detail: PENDING_HOST },
    { at: 2 * DAY, action: "event.create", eventSlug: SLUGS.upcoming, detail: upcoming.name },
    { at: 20 * 60_000, action: "voting.open", eventSlug: SLUGS.live, detail: null },
  ];
  await db.auditLog.createMany({
    data: log.map(({ at, ...entry }) => ({
      actorEmail: ADMIN,
      ...entry,
      createdAt: new Date(now - at),
    })),
  });

  console.log(
    `Created 4 events, ${await db.eventAttendee.count({ where: { event: { lumaEventId: { startsWith: LUMA_PREFIX } } } })} attendees, ` +
      `${await db.code.count({ where: { event: { lumaEventId: { startsWith: LUMA_PREFIX } } } })} codes, ` +
      `${await db.vote.count({ where: { event: { lumaEventId: { startsWith: LUMA_PREFIX } } } })} votes.`,
  );
}

async function printLinks() {
  const now = Date.now();
  const status = `/e/${SLUGS.live}/status`;
  const rows: [string, string, string][] = [
    ["Admin (/admin)", ADMIN, "/admin"],
    ...personas(now)
      .filter((p) => p.email !== ADMIN)
      .map((p): [string, string, string] => [p.role, p.email, status]),
    ["Luma host, waiting on the admin", PENDING_HOST, "/admin"],
  ];
  console.log(`\nSign-in links (one use each, valid 12 hours):\n`);
  for (const [role, email, next] of rows) {
    const url = await createMagicLink(email, next, EVENT_LINK_TTL_MS);
    console.log(`  ${role}\n  ${email}\n  ${url}\n`);
  }
  console.log(
    `Door scan: npx tsx scripts/fake-data.ts checkin ${WAITING}\n` +
      `New links: npx tsx scripts/fake-data.ts links`,
  );
}

async function checkIn(email: string | undefined) {
  if (!email) throw new Error("Usage: npx tsx scripts/fake-data.ts checkin <email>");
  const attendee = await db.eventAttendee.findFirst({
    where: { email: email.toLowerCase(), event: { slug: SLUGS.live } },
  });
  if (!attendee) throw new Error(`${email} is not on ${SLUGS.live}.`);
  const now = new Date();
  await db.eventAttendee.update({
    where: { id: attendee.id },
    data: { approvalStatus: "approved", checkedInAt: attendee.checkedInAt ?? now },
  });
  console.log(`${email} scanned in. Credits stay empty until a host uploads them.`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === "--clean") {
    console.log(`Removed ${await teardown()} fake events.`);
  } else if (command === "checkin") {
    await checkIn(arg);
  } else if (command === "links") {
    await printLinks();
  } else {
    await teardown();
    await seed();
    await printLinks();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });

/**
 * Stress and invariant checks for the things that would ruin a night: two
 * people holding the same code, someone voting twice, a stranger reaching
 * /admin, a rate limit that two requests can both slip past.
 *
 * Everything runs against a throwaway event whose rows all carry one run id,
 * so it cannot touch a real night even if it fails halfway. Teardown runs on
 * the way out either way.
 *
 *   npm run stress                    # invariants only, no server needed
 *   npm run stress -- --http          # also drive a running server
 *   npm run stress -- --load=100      # a 100-guest door rush
 *   npm run stress -- --clean         # remove leftovers from a crash
 *
 * Not a unit test suite. These are the concurrency and abuse cases, which is
 * what the guardrails are for; correctness of a single happy path shows up
 * the moment anyone opens the app.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { createMagicLink, findHost, isOrganizerEmail } from "../src/lib/auth";
import { assignAllCodes, takeCode } from "../src/lib/codes";
import { syncEventHostsFromLuma } from "../src/lib/hosts";
import { consume, LIMITS } from "../src/lib/rate-limit";
import { castVote, votingState, VoteError } from "../src/lib/voting";

const RUN = `stress-${Date.now()}`;
const DOMAIN = `@${RUN}.invalid`;
const BASE = process.env.STRESS_URL ?? "http://localhost:3002";

/**
 * A host sync now writes to the admins, and this harness runs dozens of them
 * against fixture events. Dropping the Resend key puts every send on the
 * console-log branch in src/lib/mail.ts, and emptying the admin list keeps
 * even that quiet except in the one section that is testing it. Without both,
 * a stress run mails whoever is in the real ADMIN_EMAILS.
 *
 * Only this process. The server driven by `--http` has its own environment.
 */
const STRESS_ADMIN = `admin${DOMAIN}`;
process.env.ADMIN_EMAILS = "";
delete process.env.RESEND_API_KEY;

let passed = 0;
let failed = 0;

function expect(name: string, ok: boolean, detail: string) {
  if (ok) {
    passed += 1;
    console.log(`  pass  ${name} — ${detail}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name} — ${detail}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/** Anything this script ever created, by naming convention. */
async function teardown() {
  const events = await db.event.findMany({
    where: { lumaEventId: { startsWith: "evt-stress-" } },
    select: { id: true },
  });
  for (const e of events) {
    await db.vote.deleteMany({ where: { eventId: e.id } });
    await db.project.deleteMany({ where: { eventId: e.id } });
    await db.code.deleteMany({ where: { eventId: e.id } });
    await db.eventAttendee.deleteMany({ where: { eventId: e.id } });
    await db.event.delete({ where: { id: e.id } });
  }
  await db.sponsor.deleteMany({ where: { slug: { startsWith: "stress-" } } });
  await db.host.deleteMany({ where: { email: { contains: ".invalid" } } });
  await db.magicLink.deleteMany({ where: { email: { contains: ".invalid" } } });
  await db.rateLimit.deleteMany({ where: { key: { contains: "stress" } } });
  await db.auditLog.deleteMany({ where: { actorEmail: { contains: ".invalid" } } });
}

type Fixture = {
  event: {
    id: string;
    slug: string;
    lumaEventId: string;
    perksRequireCheckIn: boolean;
    votingOpenedAt: Date | null;
    votingClosedAt: Date | null;
  };
  sponsorId: string;
  sponsorSlug: string;
  attendeeIds: string[];
};

/**
 * A live event with `guestsSyncedAt` and `hostsSyncedAt` already fresh, so
 * loading its pages never claims a sync slot and never reaches for Luma with
 * an event id Luma has never heard of.
 */
async function fixture(opts: {
  attendees: number;
  codes: number;
  checkedIn?: boolean;
  /**
   * Email namespace for this fixture's guests. Phases that drive HTTP have to
   * differ: rate limits are keyed by address, so a later phase reusing
   * `guest0` inherits whatever budget an earlier phase spent on it, and reads
   * as the app refusing a guest it should have served.
   */
  prefix?: string;
}): Promise<Fixture> {
  const now = Date.now();
  const who = opts.prefix ?? "guest";
  const sponsor = await db.sponsor.create({
    data: { slug: `stress-${now}`, name: "Stress Partner", sortOrder: 999 },
  });
  const event = await db.event.create({
    data: {
      slug: `stress-${now}`,
      name: "Stress Night",
      lumaEventId: `evt-stress-${now}`,
      perksRequireCheckIn: true,
      startAt: new Date(now - 3600_000),
      endAt: new Date(now + 3600_000),
      timezone: "Europe/Skopje",
      guestsSyncedAt: new Date(now),
      hostsSyncedAt: new Date(now),
    },
  });

  await db.eventAttendee.createMany({
    data: Array.from({ length: opts.attendees }, (_, i) => ({
      eventId: event.id,
      lumaGuestId: `gst-${RUN}-${who}-${i}`,
      email: `${who}${i}${DOMAIN}`,
      name: `Guest ${i}`,
      approvalStatus: "approved",
      registeredAt: new Date(now - 86400_000),
      checkedInAt: opts.checkedIn === false ? null : new Date(now - 1800_000),
    })),
  });
  if (opts.codes > 0) {
    await db.code.createMany({
      data: Array.from({ length: opts.codes }, (_, i) => ({
        eventId: event.id,
        sponsorId: sponsor.id,
        code: `${RUN}-code-${i}`,
      })),
    });
  }

  const attendees = await db.eventAttendee.findMany({
    where: { eventId: event.id },
    select: { id: true },
    orderBy: { lumaGuestId: "asc" },
  });

  return {
    event,
    sponsorId: sponsor.id,
    sponsorSlug: sponsor.slug,
    attendeeIds: attendees.map((a) => a.id),
  };
}

/** A room of people all tapping Claim on a pool too small for them. */
async function codeContention() {
  section("Code assignment under contention");

  const f = await fixture({ attendees: 40, codes: 10 });
  await Promise.all(
    f.attendeeIds.map((id) => takeCode(f.event.id, f.sponsorId, id)),
  );

  const claimed = await db.code.findMany({
    where: { eventId: f.event.id, claimedByAttendeeId: { not: null } },
    select: { code: true, claimedByAttendeeId: true },
  });
  const holders = new Set(claimed.map((c) => c.claimedByAttendeeId));
  const codes = new Set(claimed.map((c) => c.code));

  expect(
    "pool cannot overdraw",
    claimed.length === 10,
    `40 people raced for 10 codes, ${claimed.length} handed out`,
  );
  expect(
    "no code held twice",
    codes.size === claimed.length,
    `${codes.size} distinct codes across ${claimed.length} claims`,
  );
  expect(
    "no person holds two",
    holders.size === claimed.length,
    `${holders.size} distinct holders`,
  );

  // One person, many taps. The unique index is what makes this one code.
  const f2 = await fixture({ attendees: 1, codes: 20 });
  const solo = f2.attendeeIds[0]!;
  await Promise.all(
    Array.from({ length: 25 }, () =>
      takeCode(f2.event.id, f2.sponsorId, solo),
    ),
  );
  const mine = await db.code.count({
    where: { eventId: f2.event.id, claimedByAttendeeId: solo },
  });
  expect(
    "double-tap yields one code",
    mine === 1,
    `25 simultaneous takes for one guest produced ${mine}`,
  );

  // assignAllCodes is what the door scan runs, and it re-runs every sync.
  const before = await db.code.count({
    where: { eventId: f2.event.id, claimedByAttendeeId: { not: null } },
  });
  await Promise.all(
    Array.from({ length: 10 }, () => assignAllCodes(f2.event.id, solo)),
  );
  const after = await db.code.count({
    where: { eventId: f2.event.id, claimedByAttendeeId: { not: null } },
  });
  expect(
    "delivery is idempotent",
    before === after && after === 1,
    `ten concurrent assignAllCodes left ${after} claimed`,
  );
}

async function rateLimits() {
  section("Rate limiter");

  const key = `stress:one:${RUN}`;
  const burst = await Promise.all(
    Array.from({ length: 150 }, () => consume(key, 50, 60_000)),
  );
  const allowed = burst.filter((r) => r.ok).length;
  expect(
    "atomic under load",
    allowed === 50,
    `150 simultaneous calls, limit 50, allowed ${allowed}`,
  );

  const refused = burst.find((r) => !r.ok);
  expect(
    "retryAfter within the window",
    Boolean(refused && refused.retryAfter > 0 && refused.retryAfter <= 60),
    `refusal reported ${refused?.retryAfter}s for a 60s window`,
  );

  // Buckets must not bleed: one abuser must not spend a stranger's budget.
  const perKey = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      consume(`stress:many:${RUN}:${i}`, 1, 60_000),
    ),
  );
  expect(
    "keys are independent",
    perKey.every((r) => r.ok),
    `40 distinct keys each got their first call`,
  );

  const roll = `stress:roll:${RUN}`;
  const first = await consume(roll, 1, 300);
  const second = await consume(roll, 1, 300);
  await new Promise((r) => setTimeout(r, 400));
  const third = await consume(roll, 1, 300);
  expect(
    "window rolls over",
    first.ok && !second.ok && third.ok,
    `allow, refuse, then allow again after the window`,
  );

  // The numbers the app actually ships with, so a typo in LIMITS is caught.
  expect(
    "sign-in limits are sane",
    LIMITS.signInPerIp.limit > 0 && LIMITS.signInPerEmail.limit > 0,
    `${LIMITS.signInPerIp.limit}/ip per ${LIMITS.signInPerIp.windowMs / 1000}s, ` +
      `${LIMITS.signInPerEmail.limit}/email per ${LIMITS.signInPerEmail.windowMs / 60000}min`,
  );
  expect(
    "a venue behind one IP can still claim",
    LIMITS.claimPerIp.limit >= 20 * LIMITS.claimPerEmail.limit,
    `${LIMITS.claimPerIp.limit}/ip leaves room for ${Math.floor(LIMITS.claimPerIp.limit / LIMITS.claimPerEmail.limit)} guests at full tilt`,
  );
}

async function oneVoteEach() {
  section("One vote per attendee");

  const f = await fixture({ attendees: 30, codes: 0 });
  const event = await db.event.update({
    where: { id: f.event.id },
    data: { votingOpenedAt: new Date(), votingClosedAt: null },
  });
  const projects = await Promise.all(
    [0, 1, 2].map((i) =>
      db.project.create({
        data: {
          eventId: f.event.id,
          name: `Project ${i}`,
          builders: "Team",
          sortOrder: i,
        },
      }),
    ),
  );

  expect(
    "ballot reads open",
    votingState(event) === "open",
    `votingState says ${votingState(event)}`,
  );

  // Every guest submits three ballots at once, for three different projects.
  const votes = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) =>
      Promise.all(
        projects.map((p) =>
          castVote({
            event,
            email: `guest${i}${DOMAIN}`,
            projectId: p.id,
          }),
        ),
      ),
    ),
  );
  const errors = votes.filter((v) => v.status === "rejected");

  const rows = await db.vote.findMany({
    where: { eventId: f.event.id },
    select: { attendeeId: true },
  });
  const voters = new Set(rows.map((r) => r.attendeeId));
  expect(
    "one row per voter",
    rows.length === 30 && voters.size === 30,
    `30 guests × 3 concurrent ballots produced ${rows.length} rows across ${voters.size} voters`,
  );
  expect(
    "no ballot errored",
    errors.length === 0,
    `${errors.length} rejections${errors.length ? `: ${(errors[0] as PromiseRejectedResult).reason}` : ""}`,
  );

  // A forged POST after the host closes the ballot.
  const closed = await db.event.update({
    where: { id: f.event.id },
    data: { votingClosedAt: new Date() },
  });
  let blocked = "";
  try {
    await castVote({
      event: closed,
      email: `guest0${DOMAIN}`,
      projectId: projects[0]!.id,
    });
  } catch (e) {
    blocked = e instanceof VoteError ? e.code : "wrong error type";
  }
  expect(
    "closed ballot refuses votes",
    blocked === "not_open",
    `castVote threw ${blocked || "nothing"}`,
  );

  // Someone who was never scanned at the door, voting through a forged POST.
  const reopened = await db.event.update({
    where: { id: f.event.id },
    data: { votingClosedAt: null, votingOpenedAt: new Date() },
  });
  await db.eventAttendee.updateMany({
    where: { eventId: f.event.id, email: `guest0${DOMAIN}` },
    data: { checkedInAt: null },
  });
  let unstamped = "";
  try {
    await castVote({
      event: reopened,
      email: `guest0${DOMAIN}`,
      projectId: projects[0]!.id,
    });
  } catch (e) {
    unstamped = e instanceof VoteError ? e.code : "wrong error type";
  }
  expect(
    "unstamped guest refused",
    unstamped === "not_eligible",
    `castVote threw ${unstamped || "nothing"}`,
  );

  // A project id from another event, to check the ballot is event-scoped.
  const other = await fixture({ attendees: 1, codes: 0 });
  const foreign = await db.project.create({
    data: {
      eventId: other.event.id,
      name: "Elsewhere",
      builders: "Them",
      sortOrder: 0,
    },
  });
  let cross = "";
  try {
    await castVote({
      event: reopened,
      email: `guest1${DOMAIN}`,
      projectId: foreign.id,
    });
  } catch (e) {
    cross = e instanceof VoteError ? e.code : "wrong error type";
  }
  expect(
    "cannot vote for another event's project",
    cross === "unknown_project",
    `castVote threw ${cross || "nothing"}`,
  );
}

async function hostGate() {
  section("Host confirmation gate");

  const pendingEmail = `pending${DOMAIN}`;
  const f = await fixture({ attendees: 1, codes: 0 });

  // Exactly what a Luma sync produces: a row nobody has confirmed.
  await syncEventHostsFromLuma(f.event.id, [pendingEmail]);
  const discovered = await db.host.findUnique({
    where: { email: pendingEmail },
  });
  expect(
    "Luma discovery lands unconfirmed",
    Boolean(discovered) && discovered!.confirmedAt === null,
    `grantedBy=${discovered?.grantedBy}, confirmedAt=${discovered?.confirmedAt ?? "null"}`,
  );
  expect(
    "pending host is not an organizer",
    (await findHost(pendingEmail)) === null &&
      (await isOrganizerEmail(pendingEmail)) === false,
    `findHost null and isOrganizerEmail false`,
  );

  await db.host.update({
    where: { email: pendingEmail },
    data: { confirmedAt: new Date(), confirmedBy: `admin${DOMAIN}` },
  });
  expect(
    "confirmation opens manage",
    Boolean(await findHost(pendingEmail)) &&
      (await isOrganizerEmail(pendingEmail)),
    `findHost resolves and isOrganizerEmail true`,
  );

  await db.host.update({
    where: { email: pendingEmail },
    data: { confirmedAt: null, confirmedBy: null },
  });
  expect(
    "revocation closes it again",
    (await findHost(pendingEmail)) === null,
    `findHost null after revoke`,
  );

  // A confirmed host must not survive as confirmed just because Luma still
  // lists them; sync only ever connects events, never grants.
  await db.host.update({
    where: { email: pendingEmail },
    data: { confirmedAt: null },
  });
  await syncEventHostsFromLuma(f.event.id, [pendingEmail]);
  const resynced = await db.host.findUnique({ where: { email: pendingEmail } });
  expect(
    "re-sync cannot grant access",
    resynced!.confirmedAt === null,
    `still unconfirmed after another Luma sync`,
  );
}

async function hostRevocation() {
  section("Luma host revocation");

  const f = await fixture({ attendees: 1, codes: 0 });
  const invited = `invited${DOMAIN}`;
  const derived = `derived${DOMAIN}`;
  const kept = `kept${DOMAIN}`;

  const invitedRow = await db.host.create({
    data: {
      email: invited,
      grantedBy: `admin${DOMAIN}`,
      confirmedAt: new Date(),
      confirmedBy: `admin${DOMAIN}`,
    },
  });
  await db.event.update({
    where: { id: f.event.id },
    data: { hosts: { connect: { id: invitedRow.id } } },
  });
  await syncEventHostsFromLuma(f.event.id, [derived, kept]);

  // Luma drops `derived` and keeps `kept`.
  await syncEventHostsFromLuma(f.event.id, [kept]);
  let hosts = await db.event.findUniqueOrThrow({
    where: { id: f.event.id },
    include: { hosts: { select: { email: true } } },
  });
  let emails = hosts.hosts.map((h) => h.email).sort();
  expect(
    "dropped Luma host disconnected",
    !emails.includes(derived),
    `event hosts now ${emails.join(", ")}`,
  );
  expect(
    "admin-invited host untouched",
    emails.includes(invited),
    `${invited} still appointed`,
  );
  expect(
    "disconnected row survives",
    Boolean(await db.host.findUnique({ where: { email: derived } })),
    `the Host row is kept, only the event link is gone`,
  );

  // A Luma response we cannot parse looks exactly like "no hosts". Acting on
  // it would revoke the people running the night.
  await syncEventHostsFromLuma(f.event.id, []);
  hosts = await db.event.findUniqueOrThrow({
    where: { id: f.event.id },
    include: { hosts: { select: { email: true } } },
  });
  emails = hosts.hosts.map((h) => h.email).sort();
  expect(
    "empty Luma list revokes nobody",
    emails.includes(kept) && emails.includes(invited),
    `still ${emails.join(", ")}`,
  );
}

/**
 * Runs `work` and returns how many mails it sent. With no Resend key
 * src/lib/mail.ts prints each one instead of posting it, so the log is the
 * only place a send is observable from here.
 */
async function countingSends(work: () => Promise<unknown>): Promise<number> {
  const real = console.log;
  let sends = 0;
  console.log = (...args: unknown[]) => {
    if (String(args[0] ?? "").includes("Host approval")) sends += 1;
  };
  try {
    await work();
  } finally {
    console.log = real;
  }
  return sends;
}

async function pendingHostNotification() {
  section("Pending host notification");

  const f = await fixture({ attendees: 1, codes: 0 });
  const fresh = `newhost${DOMAIN}`;
  const confirmed = `seenhost${DOMAIN}`;

  // No admins configured is a real deployment state, and the sync has to
  // survive it without claiming a stamp for a mail nobody was sent.
  await syncEventHostsFromLuma(f.event.id, [fresh]);
  let row = await db.host.findUniqueOrThrow({ where: { email: fresh } });
  expect(
    "no admins means nothing is claimed",
    row.pendingNotifiedAt === null,
    `pendingNotifiedAt still null with ADMIN_EMAILS empty`,
  );

  process.env.ADMIN_EMAILS = STRESS_ADMIN;
  try {
    await syncEventHostsFromLuma(f.event.id, [fresh]);
    row = await db.host.findUniqueOrThrow({ where: { email: fresh } });
    const first = row.pendingNotifiedAt;
    expect(
      "a new pending host is announced",
      first !== null,
      `pendingNotifiedAt set to ${first?.toISOString() ?? "null"}`,
    );

    // The admin event page syncs every fifteen minutes for as long as the
    // night is open. Re-announcing the same backlog on each one is the
    // failure this stamp exists to prevent.
    await syncEventHostsFromLuma(f.event.id, [fresh]);
    row = await db.host.findUniqueOrThrow({ where: { email: fresh } });
    expect(
      "a waiting host is not announced twice",
      row.pendingNotifiedAt?.getTime() === first?.getTime(),
      `stamp unchanged across a second sync`,
    );

    await db.host.create({
      data: {
        email: confirmed,
        grantedBy: STRESS_ADMIN,
        confirmedAt: new Date(),
        confirmedBy: STRESS_ADMIN,
      },
    });
    await syncEventHostsFromLuma(f.event.id, [confirmed]);
    const confirmedRow = await db.host.findUniqueOrThrow({
      where: { email: confirmed },
    });
    expect(
      "confirmed hosts are never announced",
      confirmedRow.pendingNotifiedAt === null,
      `nothing to approve, so nothing is sent`,
    );

    // Two events can name the same new host and sync at the same moment.
    // Only one of them may write about it.
    const raced = `raced${DOMAIN}`;
    const g = await fixture({ attendees: 1, codes: 0 });
    await db.host.create({ data: { email: raced, grantedBy: "luma" } });

    // Counting the sends, not the stamp. A stamp is there either way, so
    // asserting on it alone would pass just as happily if both syncs had
    // written to the admin. Without a Resend key every send is a log line.
    const sends = await countingSends(() =>
      Promise.all([
        syncEventHostsFromLuma(f.event.id, [raced]),
        syncEventHostsFromLuma(g.event.id, [raced]),
      ]),
    );
    const racedRow = await db.host.findUniqueOrThrow({
      where: { email: raced },
    });
    expect(
      "concurrent syncs announce a host once",
      sends === 1 && racedRow.pendingNotifiedAt !== null,
      `${sends} mail(s) for one new host across two simultaneous syncs`,
    );
  } finally {
    process.env.ADMIN_EMAILS = "";
  }
}

async function hostSyncThrottle() {
  section("Host sync slot");

  const f = await fixture({ attendees: 1, codes: 0 });
  await db.event.update({
    where: { id: f.event.id },
    data: { hostsSyncedAt: null },
  });

  // The same conditional UPDATE syncEventHostsIfStale uses. Calling it
  // directly keeps this off Luma while still testing the race.
  const claim = async () => {
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    const rows = await db.$queryRaw<{ id: string }[]>`
      UPDATE "Event" SET "hostsSyncedAt" = now()
      WHERE id = ${f.event.id}
        AND ("hostsSyncedAt" IS NULL OR "hostsSyncedAt" < ${staleBefore})
      RETURNING id
    `;
    return rows.length > 0;
  };

  const winners = (await Promise.all(Array.from({ length: 30 }, claim))).filter(
    Boolean,
  ).length;
  expect(
    "one caller wins the slot",
    winners === 1,
    `30 simultaneous page loads produced ${winners} Luma sync`,
  );
}

async function magicLinks() {
  section("Magic links");

  const email = `link${DOMAIN}`;
  const url = await createMagicLink(email, "/", 60_000);
  const token = new URL(url).searchParams.get("token")!;
  expect(
    "token is long enough to matter",
    token.length >= 64,
    `${token.length} hex characters`,
  );

  const stored = await db.magicLink.findFirst({ where: { email } });
  expect(
    "only a hash is stored",
    Boolean(stored) && !JSON.stringify(stored).includes(token),
    `the row holds tokenHash, not the token`,
  );

  // Expired, and past the replay grace: must be dead.
  const old = await createMagicLink(`old${DOMAIN}`, "/", 60_000);
  const oldToken = new URL(old).searchParams.get("token")!;
  await db.magicLink.updateMany({
    where: { email: `old${DOMAIN}` },
    data: {
      expiresAt: new Date(Date.now() - 60_000),
      consumedAt: new Date(Date.now() - 60 * 60 * 1000),
    },
  });
  const { consumeMagicLink } = await import("../src/lib/auth");
  expect(
    "expired link is refused",
    (await consumeMagicLink(oldToken)) === null,
    `consumeMagicLink returned null`,
  );

  const garbage = await consumeMagicLink("x".repeat(64));
  expect(
    "unknown token is refused",
    garbage === null,
    `a well-formed but unissued token returns null`,
  );

  // Concurrent use of one live link. Within the replay grace this is allowed
  // on purpose, for mail scanners that touch the URL before the guest does.
  const live = await createMagicLink(`live${DOMAIN}`, "/", 60_000);
  const liveToken = new URL(live).searchParams.get("token")!;
  const uses = await Promise.all(
    Array.from({ length: 10 }, () => consumeMagicLink(liveToken)),
  );
  const consumedRow = await db.magicLink.findFirst({
    where: { email: `live${DOMAIN}` },
    select: { consumedAt: true },
  });
  expect(
    "link is marked consumed exactly once",
    Boolean(consumedRow?.consumedAt) && uses.every((u) => u !== null),
    `10 concurrent uses, all inside the replay grace, one consumedAt stamp`,
  );
}

async function poolPressure() {
  section("Connection pool under a door rush");

  // The pool is capped at 20. A room opening the page at once must queue and
  // finish, not error out.
  const started = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: 300 }, (_, i) =>
      db.eventAttendee.count({ where: { email: `guest${i % 40}${DOMAIN}` } }),
    ),
  );
  const broken = results.filter((r) => r.status === "rejected");
  expect(
    "300 concurrent queries all complete",
    broken.length === 0,
    `${results.length - broken.length}/300 in ${Date.now() - started}ms${
      broken.length
        ? `, first error: ${(broken[0] as PromiseRejectedResult).reason}`
        : ""
    }`,
  );
}

/* ---------------------------------------------------------------- HTTP ---- */

async function cookieFrom(url: string): Promise<string | null> {
  const res = await fetch(url, { redirect: "manual" });
  const raw = res.headers.get("set-cookie");
  return raw?.split(";")[0] ?? null;
}

async function httpChecks() {
  section("Live server");

  try {
    await fetch(`${BASE}/signin`);
  } catch {
    console.log(`  skip  no server on ${BASE} — start one with npm run dev`);
    return;
  }

  const head = await fetch(`${BASE}/signin`);
  const csp = head.headers.get("content-security-policy") ?? "";
  expect(
    "security headers present",
    csp.includes("frame-ancestors 'none'") &&
      head.headers.get("x-frame-options") === "DENY" &&
      head.headers.get("x-content-type-options") === "nosniff" &&
      !head.headers.has("x-powered-by"),
    `CSP, X-Frame-Options, nosniff set; X-Powered-By absent`,
  );

  // Pool sized so the bystander at the end can actually get a code: the point
  // of that check is that one guest burning their limit leaves the room fine,
  // which an empty pool would fake by refusing everyone equally.
  const f = await fixture({ attendees: 25, codes: 30 });
  const guestUrl = await createMagicLink(`guest0${DOMAIN}`, "/", 600_000);
  const cookie = await cookieFrom(guestUrl);
  expect("guest can sign in", Boolean(cookie), `session cookie issued`);

  // This event's own sponsor. Earlier sections leave their fixtures standing
  // until teardown, so "any stress sponsor" would find one with no pool here.
  const sponsorSlug = f.sponsorSlug;

  const post = (jar: string | null, origin?: string) =>
    fetch(`${BASE}/api/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(jar ? { cookie: jar } : {}),
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ eventSlug: f.event.slug, sponsor: sponsorSlug }),
    });

  const anon = await post(null, BASE);
  expect(
    "claim needs a session",
    anon.status === 401,
    `no cookie returned ${anon.status}`,
  );

  const forged = await post("stamp_ambassadors_session=not.a.real.token", BASE);
  expect(
    "forged session cookie rejected",
    forged.status === 401,
    `a made-up cookie returned ${forged.status}`,
  );

  const crossSite = await post(cookie, "https://evil.example.com");
  expect(
    "cross-site origin refused",
    crossSite.status === 403,
    `evil origin returned ${crossSite.status}`,
  );

  const first = await post(cookie, BASE);
  const firstBody = (await first.json()) as { code?: string; message?: string };
  const again = await post(cookie, BASE);
  const againBody = (await again.json()) as { code?: string };
  expect(
    "a stamped guest claims",
    first.status === 200 && Boolean(firstBody.code),
    first.status === 200 && firstBody.code
      ? `got a code back`
      : `got ${first.status}: ${firstBody.message ?? JSON.stringify(firstBody)}`,
  );
  expect(
    "claiming twice returns the same code",
    Boolean(firstBody.code) && firstBody.code === againBody.code,
    `idempotent across two requests`,
  );

  // A room of strangers on one pool of five.
  const jars = await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const url = await createMagicLink(`guest${i + 1}${DOMAIN}`, "/", 600_000);
      return cookieFrom(url);
    }),
  );
  const rush = await Promise.all(jars.map((jar) => post(jar, BASE)));
  const codes = await Promise.all(
    rush.map(async (r) => ((await r.json()) as { code?: string }).code),
  );
  const handed = codes.filter(Boolean);
  const distinct = new Set(handed);
  const serverErrors = rush.filter((r) => r.status >= 500);
  expect(
    "no 500s under a claim rush",
    serverErrors.length === 0,
    `20 simultaneous claims, ${serverErrors.length} server errors`,
  );
  expect(
    "no code handed to two people over HTTP",
    // Asserting the count as well as the distinctness, because "all distinct"
    // is also true of zero codes, which is how a broken fixture passes this
    // quietly.
    handed.length === 20 && distinct.size === handed.length,
    `${handed.length} of 20 guests got a code, ${distinct.size} distinct`,
  );

  // Status page under load: what the room is staring at while they wait.
  const loads = await Promise.all(
    jars
      .slice(0, 15)
      .map((jar) =>
        fetch(`${BASE}/e/${f.event.slug}/status`, {
          headers: jar ? { cookie: jar } : {},
        }),
      ),
  );
  expect(
    "status page holds under load",
    loads.every((r) => r.status === 200),
    `15 concurrent loads, statuses ${[...new Set(loads.map((r) => r.status))].join(", ")}`,
  );

  // The per-email claim limit, from the outside.
  const hammer: number[] = [];
  for (let i = 0; i < LIMITS.claimPerEmail.limit + 8; i += 1) {
    hammer.push((await post(cookie, BASE)).status);
  }
  expect(
    "claim rate limit engages",
    hammer.includes(429),
    `${hammer.filter((s) => s === 429).length} of ${hammer.length} refused with 429`,
  );

  // And the point of all of it: a different guest is still fine.
  const bystanderUrl = await createMagicLink(
    `guest24${DOMAIN}`,
    "/",
    600_000,
  );
  const bystander = await post(await cookieFrom(bystanderUrl), BASE);
  const bystanderBody = (await bystander.json()) as {
    code?: string;
    message?: string;
  };
  expect(
    "one abuser does not block the room",
    bystander.status === 200 && Boolean(bystanderBody.code),
    bystander.status === 200
      ? `a bystander claimed normally while another guest was rate limited`
      : `got ${bystander.status}: ${bystanderBody.message ?? "no code"}`,
  );

  // A pending host hammering /admin never gets in.
  const hostEmail = `httphost${DOMAIN}`;
  await syncEventHostsFromLuma(f.event.id, [hostEmail]);
  const hostJar = await cookieFrom(
    await createMagicLink(hostEmail, "/admin", 600_000),
  );
  const tries = await Promise.all(
    Array.from({ length: 15 }, () =>
      fetch(`${BASE}/admin`, {
        headers: hostJar ? { cookie: hostJar } : {},
        redirect: "manual",
      }),
    ),
  );
  const locations = new Set(tries.map((r) => r.headers.get("location")));
  expect(
    "pending host cannot reach /admin",
    tries.every((r) => r.status === 307 || r.status === 302),
    `15 tries, all redirected to ${[...locations].join(", ")}`,
  );

  await db.host.update({
    where: { email: hostEmail },
    data: { confirmedAt: new Date(), confirmedBy: "stress" },
  });
  const opened = await fetch(`${BASE}/admin`, {
    headers: hostJar ? { cookie: hostJar } : {},
    redirect: "manual",
  });
  expect(
    "confirmed host reaches /admin",
    opened.status === 200,
    `after confirmation the same cookie got ${opened.status}`,
  );
}

/**
 * The night itself: a room arriving at once, each person signing in, opening
 * their status page, and claiming. Worth running against `npm run start`
 * rather than `next dev`, which compiles on demand and measures the compiler.
 */
async function doorRush(guests: number) {
  section(`Door rush — ${guests} guests arriving at once`);

  try {
    await fetch(`${BASE}/signin`);
  } catch {
    console.log(`  skip  no server on ${BASE}`);
    return;
  }

  const f = await fixture({
    attendees: guests,
    codes: guests,
    prefix: "rush",
  });

  // Every guest here shares one IP, so they share one bucket, and back-to-back
  // runs would otherwise inherit the last one's count and report the limiter
  // as a throughput ceiling. The limiter has its own tests; this phase is
  // measuring how much the app can actually carry.
  await db.rateLimit.deleteMany({ where: { key: { startsWith: "claim:ip:" } } });

  const sponsor = f.sponsorSlug;
  const timings: number[] = [];
  const statuses: number[] = [];

  const oneGuest = async (i: number) => {
    const started = Date.now();
    const url = await createMagicLink(`rush${i}${DOMAIN}`, "/", 600_000);
    const jar = await cookieFrom(url);
    const page = await fetch(`${BASE}/e/${f.event.slug}/status`, {
      headers: jar ? { cookie: jar } : {},
    });
    const claim = await fetch(`${BASE}/api/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(jar ? { cookie: jar } : {}),
      },
      body: JSON.stringify({ eventSlug: f.event.slug, sponsor }),
    });
    timings.push(Date.now() - started);
    statuses.push(page.status, claim.status);
    const body = (await claim.json()) as { code?: string };
    return body.code;
  };

  const started = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: guests }, (_, i) => oneGuest(i)),
  );
  const elapsed = Date.now() - started;

  const threw = results.filter((r) => r.status === "rejected");
  const codes = results.flatMap((r) =>
    r.status === "fulfilled" && r.value ? [r.value] : [],
  );
  const sorted = [...timings].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? 0;

  console.log(
    `  ${guests} guests in ${elapsed}ms · p50 ${pct(0.5)}ms · p95 ${pct(0.95)}ms · max ${pct(1)}ms`,
  );

  // `fetch failed` on its own says nothing. The cause is what tells you
  // whether the server refused the connection or this script ran out of
  // sockets trying to open two thousand at once.
  const why = threw.length
    ? (() => {
        const e = (threw[0] as PromiseRejectedResult).reason as {
          cause?: { code?: string; message?: string };
          message?: string;
        };
        return e?.cause?.code ?? e?.cause?.message ?? e?.message ?? "unknown";
      })()
    : "";
  expect(
    "nothing threw",
    threw.length === 0,
    `${threw.length} requests failed outright${why ? ` (${why})` : ""}`,
  );
  expect(
    "no server errors",
    statuses.every((s) => s < 500),
    `statuses seen: ${[...new Set(statuses)].sort().join(", ")}`,
  );
  expect(
    "nobody was rate limited",
    !statuses.includes(429),
    statuses.includes(429)
      ? `${statuses.filter((s) => s === 429).length} refused — the per-IP limit ` +
        `(${LIMITS.claimPerIp.limit}/min) is below this room size`
      : `the whole room fit under the per-IP limit`,
  );
  expect(
    "everyone got a code",
    codes.length === guests,
    `${codes.length} of ${guests} claimed from a pool of ${guests}`,
  );
  expect(
    "every code unique",
    new Set(codes).size === codes.length,
    `${new Set(codes).size} distinct across ${codes.length} claims`,
  );

  const doubled = await db.code.groupBy({
    by: ["claimedByAttendeeId"],
    where: { eventId: f.event.id, claimedByAttendeeId: { not: null } },
    _count: { _all: true },
    having: { claimedByAttendeeId: { _count: { gt: 1 } } },
  });
  expect(
    "nobody holds two from one pool",
    doubled.length === 0,
    `${doubled.length} guests hold more than one code`,
  );
}

function loadSize(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--load"));
  if (!arg) return null;
  const [, value] = arg.split("=");
  return value ? Number(value) : 100;
}

async function main() {
  if (process.argv.includes("--clean")) {
    await teardown();
    console.log("stress fixtures removed");
    return;
  }

  await teardown();
  console.log(`run ${RUN}`);

  try {
    await codeContention();
    await rateLimits();
    await oneVoteEach();
    await hostGate();
    await hostRevocation();
    await pendingHostNotification();
    await hostSyncThrottle();
    await magicLinks();
    await poolPressure();
    if (process.argv.includes("--http")) await httpChecks();
    const load = loadSize();
    if (load) await doorRush(load);
  } finally {
    await teardown();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    void teardown().finally(() => process.exit(1));
  });

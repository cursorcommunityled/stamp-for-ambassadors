import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CheckInWatcher } from "@/components/check-in-watcher";
import { EventClock } from "@/components/event-clock";
import { EventViews } from "@/components/event-views";
import { PageIntro } from "@/components/page-intro";
import { Plate } from "@/components/plate";
import { ProjectBallot, type BallotRow } from "@/components/project-ballot";
import { RecheckButton } from "@/components/recheck-button";
import { SponsorCredit } from "@/components/sponsor-credit";
import { StatusSeal } from "@/components/status-seal";
import { resolveStamp, storedStamp } from "@/lib/claim";
import { db } from "@/lib/db";
import { eventCover, hasEnded, openMicAt } from "@/lib/events";
import { partnersFor } from "@/lib/partners";
import { getSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  hasVotes,
  listProjects,
  myVote,
  rankProjects,
  voteCounts,
  votingState,
  type ProjectRow,
} from "@/lib/voting";

export const dynamic = "force-dynamic";

export default async function EventStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  /** Which panel to open on. The toggle writes it without navigating. */
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view } = await searchParams;
  const session = await getSession();

  const event = await db.event.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      lumaEventId: true,
      lumaUrl: true,
      coverUrl: true,
      perksRequireCheckIn: true,
      startAt: true,
      endAt: true,
      timezone: true,
      votingOpenedAt: true,
      votingClosedAt: true,
    },
  });
  if (!event) notFound();
  if (!session) redirect(`/e/${event.slug}`);

  // A finished event is a record, not a task. Read what we already know
  // rather than spending a Luma request on a roster that cannot change.
  const ended = hasEnded(event);
  const stamp = ended
    ? await storedStamp(event, session.email)
    : await resolveStamp(event, session.email);

  const votingPhase = votingState(event);

  const votingClosed = votingPhase === "closed";

  const [sponsors, myCodes, remainingGroups, poolGroups, projects, tally, myVoteId, projectCount] =
    await Promise.all([
      db.sponsor.findMany({
        where: partnersFor(event.id),
        orderBy: { sortOrder: "asc" },
      }),
      stamp.attendeeId
        ? db.code.findMany({
            where: {
              eventId: event.id,
              claimedByAttendeeId: stamp.attendeeId,
            },
            select: { code: true, sponsorId: true },
          })
        : Promise.resolve([]),
      db.code.groupBy({
        by: ["sponsorId"],
        where: { eventId: event.id, claimedByAttendeeId: null },
        _count: { _all: true },
      }),
      db.code.groupBy({
        by: ["sponsorId"],
        where: { eventId: event.id },
        _count: { _all: true },
      }),
      // The ballot rides along with the credits now that both live on this
      // page. An event whose host has not opened voting pays for none of it.
      votingPhase === "idle"
        ? Promise.resolve<ProjectRow[]>([])
        : listProjects(event.id),
      // Counted while the ballot is still open too, so the room can watch the
      // numbers move. An event whose host has not opened voting pays nothing.
      votingPhase === "idle"
        ? Promise.resolve(new Map<string, number>())
        : voteCounts(event.id),
      votingPhase === "idle"
        ? Promise.resolve(null)
        : myVote(event.id, stamp.attendeeId),
      db.project.count({ where: { eventId: event.id } }),
    ]);

  const mineBySponsor = new Map(
    myCodes.map((row) => [row.sponsorId, row.code]),
  );
  const remainingBySponsor = new Map(
    remainingGroups.map((row) => [row.sponsorId, row._count._all]),
  );
  const poolBySponsor = new Map(
    poolGroups.map((row) => [row.sponsorId, row._count._all]),
  );

  const greeting = stamp.guest?.name?.split(" ")[0] ?? "You";
  const stamped = !stamp.locked && Boolean(stamp.attendeeId);

  const declined = stamp.guest?.approvalStatus === "declined";
  // Locked out with Luma as the fix: an email that is not on the list has to
  // register, and so does someone holding an invite they never accepted. The
  // other locked states are waiting on the door or on a host, where a link to
  // Luma is one more thing to read and nothing to act on.
  const needsLumaSignup =
    stamp.locked === "not_on_list" ||
    stamp.guest?.approvalStatus === "invited";
  const openMic = openMicAt(event.startAt, event.endAt, event.timezone);
  const showClock =
    stamped && !ended && Boolean(event.startAt || openMic);

  // Until the host opens voting and someone writes down a project, Voting is
  // just a word in the toggle.
  const votingReady = votingPhase !== "idle" && projects.length > 0;
  // A declined registration is a closed door, not a waiting room. Neither
  // panel behind this toggle will ever open for them, so it is not a toggle.
  const showMenu = Boolean(stamp.attendeeId) && !declined;

  // A code partner appears only once this night has a pool, or this guest
  // already holds one. A guide is the prewritten how-to for an offer that
  // has no codes, so it shows as soon as the guest is stamped, on the one
  // event it was written for.
  const stampedGuest = Boolean(stamp.attendeeId) && !stamp.locked;
  const rows = sponsors.filter((sponsor) => {
    if (sponsor.guide && sponsor.eventId === event.id && stampedGuest) return true;
    if (ended) return mineBySponsor.has(sponsor.id);
    const pool = poolBySponsor.get(sponsor.id) ?? 0;
    return pool > 0 || mineBySponsor.has(sponsor.id);
  });

  const nothingLoaded = rows.length === 0;
  // A closed door is a title, a line, and a button. Left at the top of a
  // full-height shell it reads as a page that failed to load the rest. A
  // ballot behind the toggle is the opposite problem: centring a panel taller
  // than the window pushes its own first rows off the top.
  const showBallot = showMenu && votingReady;
  const short = (Boolean(stamp.locked) || nothingLoaded) && !showBallot;

  const liveTitle = stamp.locked
    ? stamp.locked === "not_checked_in"
      ? "Not yet."
      : stamp.locked === "not_on_list"
        ? "Not on this list."
        : stamp.locked === "not_approved"
          ? declined
            ? "Registration declined."
            : "Waiting on approval."
          : "Not yet."
    : `${greeting}, you're stamped.`;

  const title = ended
    ? myCodes.length > 0
      ? `${greeting}, here's what you claimed.`
      : "This event has wrapped."
    : liveTitle;

  // The line under the toggle belongs to the panel, not to the page. Sitting
  // up by the title it would stay put while the toggle moved, which is how a
  // toggle looks like it did nothing.
  const creditsHow: ViewHow | null =
    ended || stamp.locked
      ? null
      : {
          lead: "One offer per partner.",
          rest: "The button claims it, and the + opens the steps.",
        };

  const anyVotes = hasVotes(tally);
  const ranked = votingClosed && anyVotes ? rankProjects(projects, tally) : [];
  const ballotRows: BallotRow[] =
    ranked.length > 0
      ? ranked.map(({ project, votes, place }) => ({
          id: project.id,
          name: project.name,
          builders: project.builders,
          description: project.description,
          votes,
          place,
        }))
      : // Running order, not standings, while the ballot is open: re-ranking on
        // every poll would shuffle the list under a finger already reaching for
        // a button. The counts move, the rows hold still. Closed with nobody
        // voting, the line above already says so, so a "0 votes" per row would
        // only repeat it.
        projects.map((project) => ({
          id: project.id,
          name: project.name,
          builders: project.builders,
          description: project.description,
          votes: votingClosed ? null : (tally.get(project.id) ?? 0),
          place: null,
        }));

  const winners = ranked.filter((row) => row.place === 1).map((row) => row.project.name);
  const votingHow: ViewHow = votingClosed
    ? anyVotes
      ? {
          lead:
            winners.length === 1
              ? `${winners[0]} won.`
              : winners.length === 2
                ? `${winners[0]} and ${winners[1]} tied.`
                : "A tie for first.",
          rest: "Most votes first. The counts are final.",
        }
      : // Nothing happened, so there is no rule to lead with.
        {
          rest: "Voting closed without a single vote. This is the running order the room saw.",
        }
    : stamped
      ? {
          lead: "One vote each.",
          rest: "Pick a project from the open mic. Move it until we close. The counts beside them are live.",
        }
      : {
          lead: "Get stamped and you get a vote.",
          rest: "Until then you can only watch the count.",
        };

  // With the toggle above them the panels are already spaced; without it they
  // hang straight off the clock.
  const gap = showMenu ? "mt-6" : "mt-12";

  const creditsPanel =
    ended && rows.length === 0 ? (
      <p className={`${gap} max-w-md text-[16px] leading-8 text-mute`}>
        {stamp.guest
          ? "You didn't claim any partner credits at this one."
          : "This email wasn't on the guest list for this event."}
      </p>
    ) : !ended && stamp.locked ? (
      <div className={`${gap} max-w-md`}>
        <p className="text-[16px] leading-8 text-mute">{stamp.lockedReason}</p>
        {declined ? null : (
          <CheckInWatcher
            label={
              stamp.locked === "luma_error"
                ? "Retrying"
                : stamp.locked === "not_checked_in"
                  ? "Watching for your scan"
                  : stamp.locked === "not_on_list"
                    ? "Watching for your registration"
                    : "Watching Luma"
            }
          />
        )}
        {/* Beside the button, because for these two states it is the other
            half of the same decision: wait here while we watch, or go and
            fix it at the source. In the row at the foot of the page it sat
            among links that go nowhere near Luma. */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <RecheckButton eventSlug={event.slug} className="mt-0" />
          {needsLumaSignup && event.lumaUrl ? (
            <a
              href={event.lumaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-ink hover:opacity-60"
            >
              Register on Luma ↗
            </a>
          ) : null}
        </div>
      </div>
    ) : !ended && nothingLoaded ? (
      <p className={`${gap} max-w-md text-[16px] leading-8 text-mute`}>
        You are on the list for this event. No partner credits have been
        loaded yet. Check back once an organizer uploads them.
      </p>
    ) : (
      <>
        {creditsHow ? (
          <ViewHowLine how={creditsHow} className={showMenu ? undefined : "mt-12"} />
        ) : null}
        <section className={creditsHow ? "mt-7" : gap}>
          <ul className="border-y border-line">
            {rows.map((sponsor, index) => (
              <SponsorCredit
                key={sponsor.id}
                sponsor={sponsor}
                index={index + 1}
                eventSlug={event.slug}
                remaining={remainingBySponsor.get(sponsor.id) ?? 0}
                pool={poolBySponsor.get(sponsor.id) ?? 0}
                mine={mineBySponsor.get(sponsor.id)}
                ended={ended}
              />
            ))}
          </ul>
        </section>
      </>
    );

  const votingPanel = showBallot ? (
    <>
      <ViewHowLine how={votingHow} />
      <ProjectBallot
        eventSlug={event.slug}
        projects={ballotRows}
        closed={votingClosed}
        myVoteId={myVoteId}
        readOnly={votingClosed || !stamped}
      />
    </>
  ) : null;

  return (
    <AppShell
      center={short}
      // Not a link back to /e/[slug]: that page sends a signed-in visitor
      // straight here, so linking to it would bounce them in a loop.
      breadcrumb={
        <>
          <span>{event.name}</span>
        </>
      }
    >
      {/* Everything above the toggle is the night itself, not one of its two
          jobs, so it holds still while the panels below swap. */}
      <div>
        <div className="flex items-start justify-between gap-8">
          <div className="flex min-w-0 flex-col items-start gap-6 sm:flex-row sm:gap-8">
            <Plate
              src={eventCover(event)}
              alt=""
              eager
              className="size-20 shrink-0 sm:size-24"
            />
            <PageIntro size="page" title={title} />
          </div>
          <StatusSeal locked={stamp.locked} stamped={stamped} />
        </div>
        {showClock ? (
          <EventClock
            className="mt-8 border-t border-line pt-6"
            startAt={event.startAt?.toISOString() ?? null}
            openMicAt={openMic?.toISOString() ?? null}
            endAt={event.endAt?.toISOString() ?? null}
            timezone={event.timezone}
            layout="row"
          />
        ) : null}
      </div>

      {showMenu ? (
        <EventViews
          className="mt-14"
          initial={view === "voting" ? "voting" : "credits"}
          votingReady={votingReady}
          votingOpen={votingPhase === "open"}
          credits={creditsPanel}
          voting={votingPanel}
        />
      ) : (
        creditsPanel
      )}

      <div className="mt-12 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {projectCount > 0 ? (
          <Link
            href={`/e/${event.slug}/projects`}
            className="text-sm text-mute hover:text-ink"
          >
            Project showcase →
          </Link>
        ) : null}
        <Link href="/" className="text-sm text-mute hover:text-ink">
          Other events →
        </Link>
      </div>
      {!ended && !stamp.locked ? (
        <CheckInWatcher intervalMs={10000} />
      ) : null}
    </AppShell>
  );
}

/**
 * The sentence under the toggle. `lead` is the part that differs between the
 * two views and carries the emphasis, so flipping the toggle changes the first
 * words the eye lands on; both panels opened with the same bold "How it works."
 * before, which made the switch look like it had missed.
 */
type ViewHow = { lead?: string; rest: string };

function ViewHowLine({ how, className }: { how: ViewHow; className?: string }) {
  return (
    <p className={cn("view-how", className)}>
      {how.lead ? <span className="view-how-lead">{how.lead} </span> : null}
      {how.rest}
    </p>
  );
}

import { storedStamp, type StampEvent } from "@/lib/claim";
import { isUniqueViolation } from "@/lib/codes";
import { db } from "@/lib/db";

/**
 * The open mic ballot. Organizers type projects in from the back of the room
 * as teams present, then open voting once the last demo is done. Nothing here
 * is scheduled: `openMicAt` in events.ts is a countdown for the programme, not
 * a trigger, because the running order never survives contact with the night.
 */

/**
 * Deliberately no `startAt` or `endAt`. The ballot's life is its own: see the
 * auto-close below for what reading the event's dates cost us.
 */
export type VotingEvent = {
  votingOpenedAt: Date | null;
  votingClosedAt: Date | null;
};

export type VotingState = "idle" | "open" | "closed";

/**
 * A host with a microphone in one hand forgets to close the ballot, so it
 * closes itself. Long enough that it cannot cut a room off mid-vote, short
 * enough that votes stop once everyone has gone home.
 *
 * Measured from the moment the ballot was opened. It used to run off
 * `hasEnded`, six hours past Luma's `endAt` — a field Luma often omits, that a
 * host can move by rescheduling, and that a night running long sails past.
 * Once it lapsed the ballot read closed however many times the host pressed
 * Open, and a vote already underway started rejecting ballots as "not open".
 * Nothing anywhere said why, because no row had changed.
 */
const OPEN_FOR_MS = 6 * 60 * 60 * 1000;

export function votingState(event: VotingEvent, now = new Date()): VotingState {
  if (!event.votingOpenedAt) return "idle";
  if (event.votingClosedAt) return "closed";
  if (now.getTime() - event.votingOpenedAt.getTime() > OPEN_FOR_MS) {
    return "closed";
  }
  return "open";
}

export type VoteErrorCode = "not_open" | "not_eligible" | "unknown_project";

export class VoteError extends Error {
  constructor(
    readonly code: VoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VoteError";
  }
}

export type ProjectRow = {
  id: string;
  name: string;
  builders: string;
  description: string | null;
  sortOrder: number;
};

const PROJECT_SELECT = {
  id: true,
  name: true,
  builders: true,
  description: true,
  sortOrder: true,
} as const;

/** Running order: what the room saw, in the order they saw it. */
export async function listProjects(eventId: string): Promise<ProjectRow[]> {
  return db.project.findMany({
    where: { eventId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: PROJECT_SELECT,
  });
}

export async function voteCounts(eventId: string): Promise<Map<string, number>> {
  const groups = await db.vote.groupBy({
    by: ["projectId"],
    where: { eventId },
    _count: { _all: true },
  });
  return new Map(groups.map((row) => [row.projectId, row._count._all]));
}

export async function myVote(
  eventId: string,
  attendeeId: string | null,
): Promise<string | null> {
  if (!attendeeId) return null;
  const vote = await db.vote.findUnique({
    where: { eventId_attendeeId: { eventId, attendeeId } },
    select: { projectId: true },
  });
  return vote?.projectId ?? null;
}

/**
 * Nothing to rank until someone votes. Without this a ballot closed early
 * reads as a four-way tie for first, which is true and useless.
 */
export function hasVotes(counts: Map<string, number>): boolean {
  for (const count of counts.values()) {
    if (count > 0) return true;
  }
  return false;
}

/**
 * Results order: votes first, then the running order so a tie reads as the
 * order the room saw them rather than shuffling on every render.
 */
export function rankProjects(
  projects: ProjectRow[],
  counts: Map<string, number>,
): { project: ProjectRow; votes: number; place: number }[] {
  const sorted = [...projects].sort((a, b) => {
    const diff = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.sortOrder - b.sortOrder;
  });

  let place = 0;
  let lastVotes: number | null = null;
  return sorted.map((project, index) => {
    const votes = counts.get(project.id) ?? 0;
    // Shared vote totals share a place; the next one down skips.
    if (votes !== lastVotes) {
      place = index + 1;
      lastVotes = votes;
    }
    return { project, votes, place };
  });
}

export type VotingEligibility = {
  attendeeId: string | null;
  /** Null when they may vote. Otherwise why the ballot is read-only for them. */
  blocked: string | null;
};

/**
 * The bar to vote is the bar to claim credits: Luma-approved, and scanned at
 * the door when the event asks for it.
 *
 * Read from the stored roster, never Luma. The ballot only renders a Vote
 * button for someone the status page already resolved as stamped, so this is
 * a re-check against a forged POST rather than a chance to learn something
 * new. A room voting at once would otherwise all reach for Luma in the same
 * few seconds, and the answer is already sitting in our own table.
 */
export async function votingEligibility(
  event: StampEvent & VotingEvent,
  email: string,
): Promise<VotingEligibility> {
  const stamp = await storedStamp(event, email);

  if (!stamp.attendeeId || stamp.locked) {
    return {
      attendeeId: stamp.attendeeId,
      blocked:
        stamp.lockedReason ??
        "Only guests on this event's list can vote.",
    };
  }
  return { attendeeId: stamp.attendeeId, blocked: null };
}

/**
 * Records this attendee's one vote, or moves it. Moving is allowed while the
 * ballot is open: a mis-tap on a phone in a dark room is common, and the
 * unique index means a move rewrites the row rather than adding a second.
 */
export async function castVote(input: {
  event: StampEvent & VotingEvent;
  email: string;
  projectId: string;
}): Promise<{ projectId: string; moved: boolean }> {
  if (votingState(input.event) !== "open") {
    throw new VoteError("not_open", "Voting is not open right now.");
  }

  const project = await db.project.findFirst({
    where: { id: input.projectId, eventId: input.event.id },
    select: { id: true },
  });
  if (!project) {
    throw new VoteError(
      "unknown_project",
      "That project is not on this event's ballot.",
    );
  }

  const { attendeeId, blocked } = await votingEligibility(
    input.event,
    input.email,
  );
  if (!attendeeId || blocked) {
    throw new VoteError(
      "not_eligible",
      blocked ?? "You cannot vote at this event.",
    );
  }

  const previous = await myVote(input.event.id, attendeeId);
  await writeVote(input.event.id, attendeeId, project.id);
  return {
    projectId: project.id,
    moved: previous !== null && previous !== project.id,
  };
}

/**
 * One row per attendee, enforced by @@unique([eventId, attendeeId]). Two
 * ballots submitted at once both see no existing row and both try to insert;
 * the loser trips the index, and by then the row it wanted exists, so the
 * retry is an update. Same shape as `takeCode` losing a SKIP LOCKED race.
 */
async function writeVote(
  eventId: string,
  attendeeId: string,
  projectId: string,
): Promise<void> {
  try {
    await db.vote.upsert({
      where: { eventId_attendeeId: { eventId, attendeeId } },
      create: { eventId, attendeeId, projectId },
      update: { projectId },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await db.vote.update({
      where: { eventId_attendeeId: { eventId, attendeeId } },
      data: { projectId },
    });
  }
}

/** How many people have voted, for the host deciding whether to close. */
export async function voterCount(eventId: string): Promise<number> {
  return db.vote.count({ where: { eventId } });
}

/**
 * How many people could vote if they opened the page, by the same bar
 * `votingEligibility` applies one attendee at a time. The host closing the
 * ballot is really asking "has the room finished", and 6 votes means
 * something different in a room of 8 than in a room of 80.
 */
export async function eligibleVoterCount(
  event: Pick<StampEvent, "id" | "perksRequireCheckIn">,
): Promise<number> {
  return db.eventAttendee.count({
    where: {
      eventId: event.id,
      approvalStatus: "approved",
      ...(event.perksRequireCheckIn ? { checkedInAt: { not: null } } : {}),
    },
  });
}

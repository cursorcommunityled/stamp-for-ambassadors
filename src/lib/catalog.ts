import { db } from "@/lib/db";
import {
  attendeeEvents,
  formatEventDay,
  splitEvents,
} from "@/lib/events";
import {
  hasVotes,
  listProjects,
  rankProjects,
  voteCounts,
  votingState,
  type VotingEvent,
} from "@/lib/voting";

export type CatalogRow = {
  id: string;
  name: string;
  builders: string;
  description: string | null;
  votes: number | null;
  place: number | null;
};

/**
 * The public record of what was presented. Read-only: it never writes a vote
 * or a code. Rank and counts stay off until the ballot is closed, so this
 * page cannot do what the live list is careful not to — point the room at a
 * leader while people are still holding a vote.
 */
export async function projectCatalog(
  event: { id: string } & VotingEvent,
): Promise<{ closed: boolean; rows: CatalogRow[] }> {
  const projects = await listProjects(event.id);
  const closed = votingState(event) === "closed";

  if (!closed) {
    return {
      closed: false,
      rows: projects.map((project) => ({
        id: project.id,
        name: project.name,
        builders: project.builders,
        description: project.description,
        votes: null,
        place: null,
      })),
    };
  }

  const tally = await voteCounts(event.id);
  if (!hasVotes(tally)) {
    return {
      closed: true,
      rows: projects.map((project) => ({
        id: project.id,
        name: project.name,
        builders: project.builders,
        description: project.description,
        votes: null,
        place: null,
      })),
    };
  }

  return {
    closed: true,
    rows: rankProjects(projects, tally).map(({ project, votes, place }) => ({
      id: project.id,
      name: project.name,
      builders: project.builders,
      description: project.description,
      votes,
      place,
    })),
  };
}

export type ShowcaseNight = {
  slug: string;
  name: string;
  when: string | null;
  closed: boolean;
  rows: CatalogRow[];
};

/**
 * Past build nights only. A cafe, a meetup, or anything else without a
 * ballot is just a date on the home page. Upcoming nights stay off it too:
 * that list is still a running order, not a record.
 */
export async function pastShowcases(): Promise<ShowcaseNight[]> {
  const events = await db.event.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      lumaEventId: true,
      startAt: true,
      endAt: true,
      timezone: true,
      votingOpenedAt: true,
      votingClosedAt: true,
    },
  });

  const nights: ShowcaseNight[] = [];
  for (const event of splitEvents(attendeeEvents(events)).past) {
    const { closed, rows } = await projectCatalog(event);
    if (rows.length === 0) continue;
    nights.push({
      slug: event.slug,
      name: event.name,
      when: formatEventDay(event.startAt, event.timezone),
      closed,
      rows,
    });
  }
  return nights;
}

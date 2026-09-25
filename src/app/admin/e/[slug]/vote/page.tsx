import Link from "next/link";
import { requireEventManager } from "@/app/actions";
import {
  AddProjectForm,
  ProjectRoster,
  VotingSwitch,
} from "@/app/admin/e/[slug]/open-mic-forms";
import { AppShell } from "@/components/app-shell";
import { CheckInWatcher } from "@/components/check-in-watcher";
import { PageIntro } from "@/components/page-intro";
import { SignOutButton } from "@/components/session-actions";
import {
  eligibleVoterCount,
  hasVotes,
  listProjects,
  rankProjects,
  voteCounts,
  voterCount,
  votingState,
} from "@/lib/voting";

export const dynamic = "force-dynamic";

/**
 * Running the open mic, on its own page. This is a job done standing up with
 * one hand, between demos: it does not belong beside a CSV upload and a
 * leftover-code mover, which are quiet things done the week before.
 */
export default async function AdminVotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { organizer, event } = await requireEventManager(slug);

  const [projects, tally, voters, eligible] = await Promise.all([
    listProjects(event.id),
    voteCounts(event.id),
    voterCount(event.id),
    eligibleVoterCount(event),
  ]);

  const voting = votingState(event);
  const anyVotes = hasVotes(tally);

  // Running order while the room is still presenting, standings once the
  // ballot is closed and there is something to stand on.
  const rows =
    voting === "closed" && anyVotes
      ? rankProjects(projects, tally).map(({ project, votes, place }) => ({
          id: project.id,
          name: project.name,
          builders: project.builders,
          votes,
          place,
        }))
      : projects.map((project) => ({
          id: project.id,
          name: project.name,
          builders: project.builders,
          votes: tally.get(project.id) ?? 0,
          place: null,
        }));

  const title =
    voting === "open"
      ? "Voting is open."
      : voting === "closed"
        ? "Voting is closed."
        : "Not open yet.";

  const description =
    voting === "open"
      ? "Every stamped attendee gets one vote and can move it until you close. Keep adding projects if the room is still going."
      : voting === "closed"
        ? anyVotes
          ? "Attendees can see the standings. Reopen if you closed too early."
          : "Nobody voted. Reopen if you closed too early."
        : "Write each project in as it is presented, then open the vote once the last demo is done. Attendees see nothing until you do.";

  return (
    <AppShell
      breadcrumb={
        <>
          <Link href="/admin" className="hover:opacity-60">
            {organizer.admin ? "Admin" : "Host"}
          </Link>
          <span className="text-mute" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <Link href={`/admin/e/${event.slug}`} className="hover:opacity-60">
            {event.name}
          </Link>
          <span className="text-mute" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <span>Open mic</span>
        </>
      }
      actions={<SignOutButton />}
    >
      <PageIntro
        eyebrow="Open mic"
        size="page"
        title={title}
        description={description}
      />

      {/* Keyed on the ballot's length so adding a project clears whatever the
          switch last said. "Add at least one project before opening the vote"
          is the one refusal a host is likely to hit, and it was still sitting
          there after they had done exactly that. */}
      <VotingSwitch
        key={projects.length}
        eventSlug={event.slug}
        state={voting}
        voters={voters}
        eligible={eligible}
      />

      <div className="mt-16 border-t border-line pt-12">
        <h2 className="font-display text-2xl tracking-heading">
          {voting === "closed" && anyVotes ? "Standings" : "On the ballot"}
        </h2>
        <ProjectRoster
          eventSlug={event.slug}
          projects={rows}
          showVotes={voters > 0}
        />
      </div>

      <div className="mt-16 border-t border-line pt-12">
        <h2 className="font-display text-2xl tracking-heading">Add a project</h2>
        <AddProjectForm eventSlug={event.slug} />
      </div>

      <div className="mt-12 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Link
          href={`/admin/e/${event.slug}`}
          className="text-sm text-mute hover:text-ink"
        >
          ← Codes and inventory
        </Link>
        {projects.length > 0 ? (
          <Link
            href={`/e/${event.slug}/projects`}
            className="text-sm text-mute hover:text-ink"
          >
            Project pages →
          </Link>
        ) : null}
      </div>

      {/* Votes land while the host is standing there watching, so the tally
          climbs without anyone reaching for reload. */}
      {voting === "open" ? <CheckInWatcher intervalMs={8000} /> : null}
    </AppShell>
  );
}

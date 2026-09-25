import Link from "next/link";
import { requireEventManager } from "@/app/actions";
import {
  AssignHostsForm,
  RefreshLumaForm,
} from "@/app/admin/host-forms";
import {
  CodePool,
  LeftoverForm,
  GuideForm,
  UploadForm,
} from "@/app/admin/e/[slug]/inventory-forms";
import { AppShell } from "@/components/app-shell";
import { Fold } from "@/components/fold";
import { PageIntro } from "@/components/page-intro";
import { SignOutButton } from "@/components/session-actions";
import { StampCard } from "@/components/stamp-card";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import {
  formatEventWhen,
  hasEnded,
  isFixtureEvent,
  isUpcomingEvent,
} from "@/lib/events";
import { hostedBy, syncEventHostsIfStale } from "@/lib/hosts";
import { partnersFor } from "@/lib/partners";
import { syncRosterIfStale } from "@/lib/roster";
import { voterCount, votingState } from "@/lib/voting";

export const dynamic = "force-dynamic";

export default async function AdminEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { organizer, event } = await requireEventManager(slug);

  const [sponsors, otherEvents, hosts] = await Promise.all([
    // Every partner this event can use, because the pickers below have to
    // reach one that has no pool yet. The codes are what makes a count
    // possible, so they decide which of these gets a row.
    db.sponsor.findMany({
      where: partnersFor(event.id),
      orderBy: { sortOrder: "asc" },
      select: {
        slug: true,
        name: true,
        codes: {
          where: { eventId: event.id },
          select: {
            id: true,
            code: true,
            claimedAt: true,
            claimedByAttendeeId: true,
            claimedBy: { select: { name: true, email: true, checkedInAt: true } },
          },
        },
      },
    }),
    db.event.findMany({
      where: {
        id: { not: event.id },
        ...(organizer.admin ? {} : hostedBy(organizer.host?.id)),
      },
      orderBy: { createdAt: "desc" },
      select: {
        slug: true,
        name: true,
        lumaEventId: true,
        startAt: true,
        endAt: true,
      },
    }),
    organizer.admin
      ? db.host.findMany({
          // Confirmed only. Appointing a pending address to an event would
          // read as granting access and would not, so it is not offered.
          where: { confirmedAt: { not: null } },
          orderBy: { email: "asc" },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
    hasEnded(event) ? Promise.resolve() : syncRosterIfStale(event),
    // Host discovery lives here and nowhere an attendee can reach. Throttled
    // to a quarter of an hour, so leaning on refresh costs nothing.
    syncEventHostsIfStale(event),
  ]);

  // Just enough to describe the ballot in a card. Running it lives at
  // /admin/e/[slug]/vote.
  const [projectCount, voters] = await Promise.all([
    db.project.count({ where: { eventId: event.id } }),
    voterCount(event.id),
  ]);

  const when = formatEventWhen(event.startAt, event.timezone);
  const voting = votingState(event);
  const pooled = sponsors
    .filter((sponsor) => sponsor.codes.length > 0)
    .map((sponsor) => {
      const leftover = sponsor.codes
        .filter((row) => !row.claimedByAttendeeId)
        .map((row) => ({ id: row.id, code: row.code }));
      const claims = sponsor.codes
        .filter((row) => row.claimedBy && row.claimedByAttendeeId)
        .sort(
          (a, b) =>
            (b.claimedAt?.getTime() ?? 0) - (a.claimedAt?.getTime() ?? 0),
        )
        .map((row) => ({
          id: row.id,
          name: row.claimedBy?.name ?? null,
          email: row.claimedBy?.email ?? "",
          when: formatEventWhen(row.claimedBy?.checkedInAt, event.timezone),
        }));
      return {
        slug: sponsor.slug,
        name: sponsor.name,
        leftover,
        claims,
      };
    });

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
          <span>{event.name}</span>
        </>
      }
      actions={
        <div className="flex items-center gap-5">
          <Link
            href={`/e/${event.slug}`}
            className="text-sm text-ink hover:opacity-60"
          >
            Event page →
          </Link>
          <SignOutButton />
        </div>
      }
    >
      <PageIntro eyebrow="Inventory" title={event.name} />

      <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-5">
        {when ? (
          <div>
            <dt className="eyebrow">When</dt>
            <dd className="mt-2 text-sm tracking-tight">{when}</dd>
          </div>
        ) : null}
        {event.location ? (
          <div>
            <dt className="eyebrow">Where</dt>
            <dd className="mt-2 text-sm tracking-tight">{event.location}</dd>
          </div>
        ) : null}
        <div>
          <dt className="eyebrow">Check-in</dt>
          <dd className="mt-2 text-sm tracking-tight">
            {event.perksRequireCheckIn
              ? "Door scan required"
              : "Approved registration is enough"}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Event ID</dt>
          <dd className="mt-2 font-mono text-sm tracking-tight">
            {event.lumaEventId}
            {event.lumaUrl ? (
              <>
                <span className="font-sans text-mute"> · </span>
                <a
                  href={event.lumaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-sans hover:opacity-60"
                >
                  Luma ↗
                </a>
              </>
            ) : null}
          </dd>
        </div>
      </dl>

      <div className="mt-14">
        <p className="eyebrow mb-6">Credits</p>
        {pooled.length === 0 ? (
          <>
            <p className="text-sm text-mute">
              Nothing uploaded yet. The CSV you were sent goes in here.
            </p>
            <UploadForm
              eventSlug={event.slug}
              sponsors={sponsors.map((s) => ({ slug: s.slug, name: s.name }))}
            />
          </>
        ) : (
          <>
            {pooled.map((sponsor) => (
              <section key={sponsor.slug} className="border-t border-line py-8">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <h2 className="font-display text-2xl tracking-heading">
                    {sponsor.name}
                  </h2>
                  <p className="font-mono text-[11px] tracking-wide text-mute">
                    {sponsor.claims.length} claimed · {sponsor.leftover.length}{" "}
                    left · {sponsor.claims.length + sponsor.leftover.length} total
                  </p>
                </div>
                <CodePool eventSlug={event.slug} pool={sponsor} />
              </section>
            ))}
            <Fold
              title="Add codes"
              summary="CSV"
              hint="The file you were sent. One code per line. Leftovers can be removed from the pool above; claimed codes stay with their guest."
            >
              <UploadForm
                eventSlug={event.slug}
                sponsors={sponsors.map((s) => ({ slug: s.slug, name: s.name }))}
              />
            </Fold>
          </>
        )}
        <Fold
          title="How-to"
          summary="No codes"
          hint="Steps for an offer that has no file. Shown to guests stamped at this event. What you write stays in this database."
        >
          <GuideForm eventSlug={event.slug} />
        </Fold>
      </div>

      <StampCard className="mt-20 max-w-md">
        <p className="eyebrow">Open mic</p>
        <h2 className="mt-4 font-display text-2xl tracking-heading">
          {voting === "open"
            ? "Voting is open."
            : voting === "closed"
              ? "Voting is closed."
              : "Not open yet."}
        </h2>
        <p className="mt-3 text-sm leading-6 text-mute">
          {voting === "idle"
            ? "Write projects in as they present, then open the vote."
            : `${projectCount} ${projectCount === 1 ? "project" : "projects"} on the ballot · ${voters} ${voters === 1 ? "vote" : "votes"} in`}
        </p>
        <Button asChild variant="primary" className="mt-6">
          <Link href={`/admin/e/${event.slug}/vote`}>
            {voting === "idle" ? "Run the open mic" : "Manage the ballot"}
          </Link>
        </Button>
      </StampCard>

      {/* Everything below is setup: done once, in the quiet week before, and
          in the way on the night. */}
      <div className="mt-20">
        <p className="eyebrow mb-6">Setup</p>

        {isFixtureEvent(event) ? null : (
          <Fold
            title="Leftovers"
            summary="Move unclaimed"
            hint="Unclaimed rows move to another event you manage. Claimed codes stay put."
          >
            <LeftoverForm
              fromSlug={event.slug}
              sponsors={sponsors.map((s) => ({ slug: s.slug, name: s.name }))}
              events={otherEvents.filter(
                (row) => isUpcomingEvent(row) && !isFixtureEvent(row),
              )}
            />
          </Fold>
        )}

        <Fold
          title="Luma details"
          summary="Re-sync"
          hint="Pulls the event name, times, cover, Luma hosts, and re-syncs the guest list and door scans."
        >
          <RefreshLumaForm eventSlug={event.slug} />
        </Fold>

        {/* Only worth a row once there is somebody to appoint. Until a host is
            invited on /admin this section could only explain itself. */}
        {organizer.admin && hosts.length > 0 ? (
          <Fold
            title="Hosts"
            summary={`${hosts.length} confirmed`}
            hint="Luma hosts are appointed automatically but wait on confirmation, which happens on /admin. Admins can add extras for this event here."
          >
            <AssignHostsForm
              eventSlug={event.slug}
              hosts={hosts}
              appointedHostIds={event.hosts.map((host) => host.id)}
            />
          </Fold>
        ) : null}
      </div>
    </AppShell>
  );
}

import Link from "next/link";
import { requireOrganizer } from "@/app/actions";
import { HostAccessForm, InviteHostForm } from "@/app/admin/host-forms";
import { NewEventForm } from "@/app/admin/new-event-form";
import { SetupTestEmail } from "@/app/admin/setup-form";
import { AppShell } from "@/components/app-shell";
import { Fold } from "@/components/fold";
import { PageIntro } from "@/components/page-intro";
import { SignOutButton } from "@/components/session-actions";
import { db } from "@/lib/db";
import { formatEventWhen, isFixtureEvent, splitEvents } from "@/lib/events";
import { hostedBy } from "@/lib/hosts";
import {
  adminCheck,
  appUrlCheck,
  lumaCheck,
  mailCheck,
  secretCheck,
} from "@/lib/setup-check";

export const dynamic = "force-dynamic";

type AdminEvent = {
  id: string;
  slug: string;
  name: string;
  lumaEventId: string;
  startAt: Date | null;
  endAt: Date | null;
  timezone: string | null;
  location: string | null;
  hosts: { email: string }[];
  codes: number;
  claimed: number;
  leftover: number;
  guests: number;
  stamped: number;
  votes: number;
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-2 font-display text-3xl tracking-heading">{value}</dd>
    </div>
  );
}

function EventRow({
  event,
  manage,
  recap,
}: {
  event: AdminEvent;
  manage?: boolean;
  recap?: boolean;
}) {
  const meta = (
    <div>
      <p
        className={
          manage
            ? "font-display text-2xl tracking-heading group-hover:opacity-60"
            : "font-display text-2xl tracking-heading"
        }
      >
        {event.name}
      </p>
      <p className="mt-1 font-mono text-[11px] tracking-wide text-mute">
        {recap
          ? `${event.claimed} claimed · ${event.leftover} left · ${event.stamped} stamped · ${event.votes} ${event.votes === 1 ? "vote" : "votes"}`
          : `${event.codes} codes · ${event.stamped} stamped · ${event.guests} on the list`}
        {event.hosts.length > 0
          ? ` · ${event.hosts.map((host) => host.email).join(", ")}`
          : ""}
      </p>
      {event.startAt || event.location ? (
        <p className="mt-1 text-sm text-mute">
          {[formatEventWhen(event.startAt, event.timezone), event.location]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );

  if (manage) {
    return (
      <li>
        <Link
          href={`/admin/e/${event.slug}`}
          className="group flex items-baseline justify-between gap-6 py-7"
        >
          {meta}
          <span className="shrink-0 text-sm text-mute group-hover:text-ink">
            Manage →
          </span>
        </Link>
      </li>
    );
  }

  return <li className="flex items-baseline justify-between gap-6 py-7">{meta}</li>;
}

async function SetupPanel({ email }: { email: string }) {
  const checks = [
    appUrlCheck(),
    secretCheck(),
    adminCheck(email),
    mailCheck(),
    await lumaCheck(),
  ];
  const problems = checks.filter((check) => !check.ok).length;

  return (
    <Fold
      title="Setup check"
      summary={problems === 0 ? "Ready" : `${problems} to fix`}
      open={problems > 0 ? true : undefined}
      hint="Sign-in, mail, and the Luma key. It stays shut once every line is ready."
    >
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {checks.map((check) => (
          <li key={check.label} className="py-4">
            <p className="text-sm">
              {check.ok ? "Ready" : "Fix"} · {check.label}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-mute">{check.detail}</p>
          </li>
        ))}
      </ul>
      <SetupTestEmail />
    </Fold>
  );
}

export default async function AdminPage() {
  const organizer = await requireOrganizer();

  const [events, hosts, trail] = await Promise.all([
    db.event.findMany({
      where: organizer.admin ? undefined : hostedBy(organizer.host?.id),
      orderBy: [{ startAt: "asc" }, { createdAt: "desc" }],
      include: {
        hosts: { select: { email: true }, orderBy: { email: "asc" } },
        _count: { select: { codes: true, attendees: true } },
      },
    }),
    organizer.admin
      ? db.host.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            // Which nights an address was named on. It is most of what an
            // admin has to go on when deciding whether to confirm.
            events: { select: { slug: true, name: true } },
            _count: { select: { events: true } },
          },
        })
      : Promise.resolve([]),
    organizer.admin
      ? db.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 40,
        })
      : Promise.resolve([]),
  ]);

  // Only confirmed hosts can be handed an event, so they are the only ones
  // worth offering in the pickers below.
  const confirmed = hosts.filter((host) => host.confirmedAt);
  const pending = hosts.filter((host) => !host.confirmedAt);

  const eventIds = events.map((event) => event.id);
  const [stampedRows, claimedRows, voteRows] =
    eventIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db.eventAttendee.groupBy({
            by: ["eventId"],
            where: { eventId: { in: eventIds }, checkedInAt: { not: null } },
            _count: { _all: true },
          }),
          db.code.groupBy({
            by: ["eventId"],
            where: {
              eventId: { in: eventIds },
              claimedByAttendeeId: { not: null },
            },
            _count: { _all: true },
          }),
          db.vote.groupBy({
            by: ["eventId"],
            where: { eventId: { in: eventIds } },
            _count: { _all: true },
          }),
        ]);
  const stampedByEvent = new Map(
    stampedRows.map((row) => [row.eventId, row._count._all]),
  );
  const claimedByEvent = new Map(
    claimedRows.map((row) => [row.eventId, row._count._all]),
  );
  const votesByEvent = new Map(
    voteRows.map((row) => [row.eventId, row._count._all]),
  );
  const rows: AdminEvent[] = events.map((event) => {
    const codes = event._count.codes;
    const claimed = claimedByEvent.get(event.id) ?? 0;
    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      lumaEventId: event.lumaEventId,
      startAt: event.startAt,
      endAt: event.endAt,
      timezone: event.timezone,
      location: event.location,
      hosts: event.hosts,
      codes,
      claimed,
      leftover: codes - claimed,
      guests: event._count.attendees,
      stamped: stampedByEvent.get(event.id) ?? 0,
      votes: votesByEvent.get(event.id) ?? 0,
    };
  });
  // preview.ts rows never show here. They are reachable at /admin/e/preview
  // by the link the script prints, and `--clean` removes them.
  const live = rows.filter((event) => !isFixtureEvent(event));
  const { upcoming, past } = splitEvents(live);

  return (
    <AppShell
      breadcrumb={organizer.admin ? "Admin" : "Host"}
      actions={
        <div className="flex items-center gap-5">
          <Link href="/" className="text-sm text-ink hover:opacity-60">
            Attendee view →
          </Link>
          <SignOutButton />
        </div>
      }
    >
      <PageIntro
        eyebrow={organizer.admin ? "Admin" : "Host"}
        title={organizer.admin ? "Events." : "Your events."}
        description={
          organizer.admin
            ? "Import Luma events and keep code pools behind the door scan. Hosts Luma names show up below and wait on your confirmation."
            : "Import a Luma event you host. If it is already on Stamp, sign in with the email Luma has as host."
        }
      />

      {live.length === 0 ? (
        <p className="mt-14 text-sm text-mute">No events yet.</p>
      ) : upcoming.length > 0 ? (
        <section className="mt-14">
          <p className="eyebrow">Upcoming</p>
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {upcoming.map((event) => (
              <EventRow key={event.id} event={event} manage />
            ))}
          </ul>
        </section>
      ) : null}

      {/* Both jobs below are done between events. The list above is what this
          page gets opened for the rest of the time. */}
      <div className="mt-20">
        <p className="eyebrow mb-6">Setup</p>

        {organizer.admin ? <SetupPanel email={organizer.email} /> : null}

        <Fold title="New event" summary="From Luma">
          <NewEventForm
            admin={organizer.admin}
            hosts={confirmed.map((host) => ({ email: host.email }))}
          />
        </Fold>

        {/* First, and open on its own terms: somebody is sitting on the other
            side of this waiting to be let in. */}
        {organizer.admin && pending.length > 0 ? (
          <Fold
            title="Pending hosts"
            summary={`${pending.length} waiting`}
            hint="Luma named these addresses on an event. Luma does not say whether someone runs the night or helps at the door, so nothing opens until you say. Confirming lets them manage the events they are on."
          >
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {pending.map((host) => (
                <li
                  key={host.id}
                  className="flex items-start justify-between gap-6 py-5"
                >
                  <div>
                    <p className="font-mono text-sm tracking-tight">
                      {host.email}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-mute">
                      {host.events.length > 0
                        ? `From ${host.events.map((event) => event.name).join(", ")}`
                        : "No events yet"}
                    </p>
                  </div>
                  <HostAccessForm
                    hostId={host.id}
                    email={host.email}
                    confirmed={false}
                  />
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}

        {organizer.admin ? (
          <Fold
            title="Hosts"
            summary={
              confirmed.length > 0 ? `${confirmed.length} confirmed` : "None yet"
            }
            hint="Confirmed hosts manage the events they are on. Inviting an address confirms it, because you typed it. Admins always manage every event."
          >
            {confirmed.length > 0 ? (
              <ul className="mt-8 divide-y divide-line border-y border-line">
                {confirmed.map((host) => (
                  <li
                    key={host.id}
                    className="flex items-start justify-between gap-6 py-5"
                  >
                    <div>
                      <p className="font-mono text-sm tracking-tight">
                        {host.email}
                      </p>
                      <p className="mt-1 text-[11px] text-mute">
                        {host._count.events}{" "}
                        {host._count.events === 1 ? "event" : "events"} ·
                        granted by {host.grantedBy}
                        {host.confirmedBy && host.confirmedBy !== host.grantedBy
                          ? ` · confirmed by ${host.confirmedBy}`
                          : ""}
                      </p>
                    </div>
                    <HostAccessForm
                      hostId={host.id}
                      email={host.email}
                      confirmed
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <InviteHostForm />
          </Fold>
        ) : null}

        {organizer.admin && trail.length > 0 ? (
          <Fold
            title="Activity"
            summary={`Last ${trail.length}`}
            hint="Anything that moved codes, wrote a how-to, changed who can manage, or decided a ballot."
          >
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {trail.map((entry) => (
                <li key={entry.id} className="py-4">
                  <p className="font-mono text-[11px] tracking-wide text-mute">
                    {formatEventWhen(entry.createdAt, null)}
                  </p>
                  <p className="mt-1 text-sm leading-6">
                    <span className="font-mono text-[13px] tracking-tight">
                      {entry.action}
                    </span>{" "}
                    by {entry.actorEmail}
                    {entry.eventSlug ? ` on ${entry.eventSlug}` : ""}
                  </p>
                  {entry.detail ? (
                    <p className="mt-0.5 text-[13px] leading-5 text-mute">
                      {entry.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
      </div>

      {/* Last on the page: a finished event is looked up on purpose, long
          after the doors and the setup that got them open. */}
      {past.length > 0 ? (
        <div className="mt-20">
          <p className="eyebrow mb-6">Past</p>
          <dl className="flex flex-wrap gap-x-10 gap-y-5">
            <Stat label="Build nights" value={past.length} />
            <Stat
              label="Stamped"
              value={past.reduce((sum, event) => sum + event.stamped, 0)}
            />
            <Stat
              label="Claimed"
              value={past.reduce((sum, event) => sum + event.claimed, 0)}
            />
            <Stat
              label="Votes"
              value={past.reduce((sum, event) => sum + event.votes, 0)}
            />
          </dl>

          <div className="mt-10">
            <Fold
              title="Build nights"
              summary={`${past.length} ${past.length === 1 ? "event" : "events"}`}
            >
              <ul className="divide-y divide-line">
                {past.map((event) => (
                  <EventRow key={event.id} event={event} manage recap />
                ))}
              </ul>
            </Fold>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

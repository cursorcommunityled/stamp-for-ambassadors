import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { EmailForm } from "@/components/email-form";
import { PageIntro } from "@/components/page-intro";
import { Plate } from "@/components/plate";
import { StampCard } from "@/components/stamp-card";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { eventCover, formatEventWhen, hasEnded } from "@/lib/events";
import { getSession } from "@/lib/session";
import { eventShareMetadata } from "@/lib/share";
import { HOST_SIGN_IN_PATH } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await db.event.findUnique({
    where: { slug },
    select: {
      name: true,
      lumaEventId: true,
      coverUrl: true,
      description: true,
    },
  });
  if (!event) return {};
  return eventShareMetadata(event, {
    title: event.name,
    description:
      event.description ??
      "Verify your email, then get scanned at the door. Partner credits unlock after.",
  });
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ slug }, { error }, session] = await Promise.all([
    params,
    searchParams,
    getSession(),
  ]);

  const event = await db.event.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      lumaEventId: true,
      startAt: true,
      endAt: true,
      timezone: true,
      location: true,
      coverUrl: true,
      lumaUrl: true,
      description: true,
    },
  });
  if (!event) notFound();

  const nextPath = `/e/${event.slug}/status`;

  // A returning attendee has nothing to do on this page. The only action was
  // an email form they have already completed.
  if (session) redirect(nextPath);

  const ended = hasEnded(event);
  const when = formatEventWhen(event.startAt, event.timezone);
  const projectCount = await db.project.count({ where: { eventId: event.id } });
  const hasFacts = Boolean(when || event.location || event.lumaUrl);

  return (
    <AppShell hostDoor={!ended}>
      <div className="grid items-start gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,22rem)] lg:gap-20">
        <div>
          {/*
            Luma covers are usually square and carry the title and date as
            artwork, so a full-width banner both crops the art and pushes the
            form off the screen. Shown at its own shape instead, beside the
            heading and detail list that already state the same facts.
          */}
          <Plate
            src={eventCover(event)}
            alt=""
            eager
            className="mb-8 size-28 sm:size-32"
          />
          {/* No kicker over the title: it held the location, which the band
              below prints again under a label that says what it is. */}
          <PageIntro
            title={event.name}
            description={
              event.description ??
              (ended
                ? "This event has already happened. Kept here as a record of who attended and what was handed out."
                : "Verify your email, then get scanned at the door. Your partner credits unlock straight after.")
            }
          />
          {/* One band closes the column instead of two stacked orphans: the
              facts on the left, the only way off this page on the right, under
              a rule that answers the one the card is hung from. */}
          {hasFacts ? (
            <div className="mt-12 flex flex-wrap items-end justify-between gap-x-10 gap-y-6 border-t border-line pt-6">
              <dl className="flex flex-wrap gap-x-10 gap-y-5">
                {when ? (
                  <div>
                    <dt className="eyebrow">When</dt>
                    <dd className="mt-2 text-sm tracking-tight">{when}</dd>
                  </div>
                ) : null}
                {event.location ? (
                  <div>
                    <dt className="eyebrow">Where</dt>
                    <dd className="mt-2 text-sm tracking-tight">
                      {event.location}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                {projectCount > 0 ? (
                  <Link
                    href={`/e/${event.slug}/projects`}
                    className="text-sm text-ink hover:opacity-60"
                  >
                    Project showcase →
                  </Link>
                ) : null}
                {event.lumaUrl ? (
                  <a
                    href={event.lumaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-ink hover:opacity-60"
                  >
                    {ended ? "View on Luma ↗" : "Register on Luma ↗"}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <StampCard>
          {ended ? (
            <>
              <p className="eyebrow">Wrapped</p>
              <p className="mt-3 font-display text-2xl tracking-heading">
                This one is over.
              </p>
              <p className="mt-3 text-sm leading-6 text-mute">
                Credits closed with the doors. Nothing left to claim here.
              </p>
              {projectCount > 0 ? (
                <Button asChild variant="primary" className="mt-6">
                  <Link href={`/e/${event.slug}/projects`}>
                    See the build
                  </Link>
                </Button>
              ) : null}
              <p className="mt-6 text-[13px] leading-6 text-mute">
                Hosted this night?{" "}
                <Link href={HOST_SIGN_IN_PATH} className="text-ink hover:opacity-60">
                  Sign in with your Luma email.
                </Link>
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">This event</p>
              <p className="mt-3 font-display text-2xl tracking-heading">
                Use your Luma email.
              </p>
              <p className="mt-3 text-sm leading-6 text-mute">
                The address you registered with. That is how we find you on
                the guest list.
              </p>
              {error === "expired" ? (
                <p className="mt-4 text-sm text-severity-high">
                  That link expired. Request a new one.
                </p>
              ) : null}
              <div className="mt-8">
                <EmailForm nextPath={nextPath} />
              </div>
            </>
          )}
        </StampCard>
      </div>
    </AppShell>
  );
}

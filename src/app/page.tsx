import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EventChoice, EventGrid } from "@/components/event-choice";
import { HeroArt } from "@/components/hero-art";
import { StampCard } from "@/components/stamp-card";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { attendeeEvents, splitEvents } from "@/lib/events";
import { getSession } from "@/lib/session";
import { HOST_SIGN_IN_PATH } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "01", title: "Pick an event", copy: "Open the one you attended. The email form lives there." },
  { n: "02", title: "Verify your email", copy: "We send a link to the email on your Luma ticket." },
  { n: "03", title: "Get scanned", copy: "Door check-in on Luma is what unlocks partner credits." },
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, session, events] = await Promise.all([
    searchParams,
    getSession(),
    db.event.findMany({
      orderBy: { createdAt: "desc" },
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
      },
    }),
  ]);

  const visible = attendeeEvents(events);
  const { upcoming, past } = splitEvents(visible);
  // Always the list, never a night. Dropping someone straight into the only
  // event still to come reads as "this is the event", which is wrong on a
  // site that carries every city's, and it hides the rest of what is on.
  const cta = visible.length > 0;
  // A past night with nothing on the ballot is just a date. The showcase
  // link only appears if at least one of them actually had a vote.
  const showcaseReady =
    past.length > 0 &&
    (await db.project.count({
      where: { eventId: { in: past.map((event) => event.id) } },
    })) > 0;

  return (
    <AppShell creditsNote>
      <section className="home-hero">
        <HeroArt className="home-hero-art" />
        <div className="home-hero-copy">
          <p className="eyebrow">Presence, verified</p>
          <h1 className="home-hero-title">
            <span>Attend.</span>
            <span>Verify.</span>
            <span>Get credits.</span>
          </h1>
          <p className="mt-7 max-w-sm text-[15px] leading-7 text-mute">
            Pick an event, verify the email on your ticket, and claim after you
            are scanned in.
          </p>
          {cta ? (
            <Button asChild variant="primary" size="lg" className="mt-8">
              <Link href="#events">
                {upcoming.length > 0 ? "See upcoming events" : "See past events"}
              </Link>
            </Button>
          ) : null}
          {session ? null : (
            <p className="mt-6 text-sm text-mute">
              Hosting an event?{" "}
              <Link href={HOST_SIGN_IN_PATH} className="text-ink hover:opacity-60">
                Sign in to manage it →
              </Link>
            </p>
          )}
        </div>
      </section>

      {error === "expired" ? (
        <p className="mb-8 text-sm text-severity-high">
          That link expired. Open an event and request a new one.
        </p>
      ) : null}

      <ol className="grid gap-8 border-t border-line pt-12 sm:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.n}>
            <p className="font-mono text-[10px] tracking-[0.18em] text-mute">
              {step.n}
            </p>
            <p className="mt-2 font-display text-xl tracking-heading">{step.title}</p>
            <p className="mt-2 text-sm leading-6 text-mute">{step.copy}</p>
          </li>
        ))}
      </ol>

      {visible.length === 0 ? (
        <StampCard className="mt-16 max-w-md">
          <p className="font-display text-2xl tracking-heading">No events yet.</p>
          <p className="mt-3 text-sm leading-6 text-mute">
            An organizer has to import the Luma event before anyone can claim.
          </p>
        </StampCard>
      ) : (
        <div id="events" className="mt-16 scroll-mt-24 space-y-16">
          {upcoming.length > 0 ? (
            <section>
              <p className="eyebrow">Upcoming</p>
              <EventGrid count={upcoming.length}>
                {upcoming.map((event) => (
                  <EventChoice key={event.slug} event={event} />
                ))}
              </EventGrid>
            </section>
          ) : null}
          {past.length > 0 ? (
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <p className="eyebrow">Past events</p>
                {showcaseReady ? (
                  <Link
                    href="/showcase"
                    className="text-sm text-mute hover:text-ink"
                  >
                    Project showcase →
                  </Link>
                ) : null}
              </div>
              <EventGrid count={past.length}>
                {past.map((event) => (
                  <EventChoice key={event.slug} event={event} action="View" />
                ))}
              </EventGrid>
            </section>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}

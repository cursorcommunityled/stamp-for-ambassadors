import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageIntro } from "@/components/page-intro";
import { Plate } from "@/components/plate";
import { ProjectCatalog } from "@/components/project-catalog";
import { projectCatalog } from "@/lib/catalog";
import { db } from "@/lib/db";
import { eventCover, formatEventDay } from "@/lib/events";
import { getSession } from "@/lib/session";
import { eventShareMetadata } from "@/lib/share";

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
      startAt: true,
      timezone: true,
    },
  });
  if (!event) return {};
  const when = formatEventDay(event.startAt, event.timezone);
  return eventShareMetadata(event, {
    title: `${event.name} · Project showcase`,
    description: when
      ? `What the room built on ${when}.`
      : "What the room built on this build night.",
  });
}

export default async function EventProjectsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await db.event.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      lumaEventId: true,
      coverUrl: true,
      startAt: true,
      endAt: true,
      timezone: true,
      votingOpenedAt: true,
      votingClosedAt: true,
    },
  });
  if (!event) notFound();

  const [{ closed, rows }, session] = await Promise.all([
    projectCatalog(event),
    getSession(),
  ]);

  const when = formatEventDay(event.startAt, event.timezone);
  const description =
    rows.length === 0
      ? "Nothing has been written down yet. Projects appear here as they go up."
      : closed
        ? "What the room saw, in the order the votes settled."
        : "What has been presented so far, in the order the room saw it.";

  return (
    <AppShell
      breadcrumb={
        <>
          <Link href={`/e/${event.slug}`} className="hover:opacity-60">
            {event.name}
          </Link>
          <span className="text-mute" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <span>Project showcase</span>
        </>
      }
    >
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:gap-8">
        <Plate
          src={eventCover(event)}
          alt=""
          eager
          className="size-20 shrink-0 sm:size-24"
        />
        <PageIntro
          eyebrow={when ?? "Open mic"}
          size="page"
          title={event.name}
          description={description}
        />
      </div>

      {rows.length > 0 ? (
        <ProjectCatalog rows={rows} closed={closed} />
      ) : null}

      <div className="mt-12 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {session ? (
          <Link
            href={`/e/${event.slug}/status`}
            className="text-sm text-mute hover:text-ink"
          >
            Your credits →
          </Link>
        ) : null}
        <Link
          href={`/e/${event.slug}`}
          className="text-sm text-mute hover:text-ink"
        >
          Back to the event →
        </Link>
      </div>
    </AppShell>
  );
}

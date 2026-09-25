import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageIntro } from "@/components/page-intro";
import { StampCard } from "@/components/stamp-card";
import { db } from "@/lib/db";
import { eventSlugFromPath } from "@/lib/events";
import { eventPathFromNext, safeNextPath } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);
  const eventPath = eventPathFromNext(nextPath);
  const slug = eventSlugFromPath(nextPath);
  const event = slug
    ? await db.event.findUnique({
        where: { slug },
        select: { name: true },
      })
    : null;
  const backHref = eventPath ?? "/";
  const mailConfigured = Boolean(process.env.RESEND_API_KEY);

  return (
    <AppShell center hostDoor={false} breadcrumb={event?.name}>
      <div className="grid items-start gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,22rem)]">
        <PageIntro
          title={mailConfigured ? "Check your email." : "The link is in the terminal."}
          description={
            event
              ? `The link expires in 20 minutes. After you open it, we take you to the status page for ${event.name}.`
              : "The link expires in 20 minutes. It only works once."
          }
        />
        <StampCard>
          {mailConfigured ? (
            <>
              <p className="eyebrow">Inbox</p>
              <p className="mt-3 font-display text-2xl tracking-heading">
                We sent a link.
              </p>
              <p className="mt-3 text-sm leading-6 text-mute">
                It may take a minute. Check spam if it is not there.
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">Local</p>
              <p className="mt-3 font-display text-2xl tracking-heading">
                Running without Resend.
              </p>
              <p className="mt-3 text-sm leading-6 text-mute">
                The link is printed in the terminal that is running the app.
              </p>
            </>
          )}
          {error === "expired" ? (
            <p className="mt-4 text-sm text-severity-high">
              That link expired. Request a new one from the event page.
            </p>
          ) : null}
          <Link
            href={backHref}
            className="mt-8 inline-block text-sm text-ink hover:opacity-60"
          >
            Use a different email →
          </Link>
        </StampCard>
      </div>
    </AppShell>
  );
}

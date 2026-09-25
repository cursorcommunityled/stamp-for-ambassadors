import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { PageIntro } from "@/components/page-intro";
import { SignOutButton } from "@/components/session-actions";
import { StampCard } from "@/components/stamp-card";
import { findHostIncludingPending, isAdminEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

function AttendeeSide() {
  return (
    <p className="mt-10 text-[13px] leading-6 text-mute">
      Came for your credits instead?{" "}
      <Link href="/" className="text-ink hover:opacity-60">
        The attendee side is this way.
      </Link>
    </p>
  );
}

/**
 * Where `requireOrganizer` sends a signed-in address that may not manage:
 * one Luma named on an event but no admin has confirmed, or one Stamp does
 * not know as a host at all. Without this they get bounced to the attendee
 * home page and read it as Stamp being broken, then ask the admin the same
 * question by message anyway.
 */
export default async function PendingHostPage() {
  const session = await requireSession("/admin");
  const host = await findHostIncludingPending(session.email);

  // Confirmed in the meantime, or an admin all along. Either way /admin opens.
  if (isAdminEmail(session.email) || host?.confirmedAt) redirect("/admin");

  if (!host) {
    return (
      <AppShell breadcrumb="Host" actions={<SignOutButton />}>
        <PageIntro
          eyebrow="Host sign in"
          title="Not a host yet."
          description="Stamp does not know this address as a host. Ask an admin to invite you, or to import your Luma event. Once it is on Stamp, an admin confirms the hosts Luma lists on it."
        />

        <StampCard className="mt-14 max-w-md">
          <p className="eyebrow">Signed in as</p>
          <p className="mt-4 font-mono text-sm tracking-tight">{session.email}</p>
          <p className="mt-6 text-[13px] leading-6 text-mute">
            Luma lists you under another address? Sign out and use that one.
          </p>
        </StampCard>

        <AttendeeSide />
      </AppShell>
    );
  }

  const events = host.events;

  return (
    <AppShell breadcrumb="Host" actions={<SignOutButton />}>
      <PageIntro
        eyebrow="Waiting on an admin"
        title="Almost."
        description="Luma lists you as a host. An admin confirms that before manage opens, because Luma does not say who runs the night and who is helping at the door."
      />

      <StampCard className="mt-14 max-w-md">
        <p className="eyebrow">Your request</p>
        <p className="mt-4 font-mono text-sm tracking-tight">{session.email}</p>
        {events.length > 0 ? (
          <p className="mt-3 text-sm leading-6 text-mute">
            From {events.map((event) => event.name).join(", ")}.
          </p>
        ) : null}
        {/* Unsent when the instance has no admin addresses configured, or
            when every send failed. Saying it went out anyway would leave
            someone waiting on a message nobody received. */}
        <p className="mt-6 text-[13px] leading-6 text-mute">
          {host.pendingNotifiedAt
            ? "The admins have been emailed, so there is nothing more to do here."
            : "Ask an admin to confirm you."}{" "}
          Once you are confirmed, this address opens{" "}
          <Link href="/admin" className="text-ink hover:opacity-60">
            manage
          </Link>{" "}
          on its own.
        </p>
      </StampCard>

      <AttendeeSide />
    </AppShell>
  );
}

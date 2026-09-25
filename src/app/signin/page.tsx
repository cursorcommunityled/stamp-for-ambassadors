import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { EmailForm } from "@/components/email-form";
import { PageIntro } from "@/components/page-intro";
import { StampCard } from "@/components/stamp-card";
import { appName } from "@/lib/brand";
import { creditsPath } from "@/lib/credits";
import { getSession } from "@/lib/session";
import { HOST_SIGN_IN_PATH, safeNextPath } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const [{ next, error }, session] = await Promise.all([
    searchParams,
    getSession(),
  ]);

  const requested = next ? safeNextPath(next) : null;
  // Nobody on this page has told us who they are yet, so there is no event
  // of theirs to aim the link at. The list is the one honest answer.
  const nextPath =
    requested ?? (session ? await creditsPath(session.email) : "/");

  if (session) redirect(nextPath);

  const organizer = requested?.startsWith("/admin") ?? false;

  return (
    <AppShell
      center
      hostDoor={false}
      breadcrumb={organizer ? "Sign in" : "Your credits"}
    >
      <div className="grid items-start gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,22rem)]">
        <PageIntro
          eyebrow={appName()}
          title={organizer ? "Organizer sign in." : "Get your credits."}
          description={
            organizer
              ? "One link to your inbox. No password. Use the email Luma lists as host. An admin confirms a new host before manage opens."
              : "One link to your inbox. No password. Use the email on your Luma ticket."
          }
        />
        <StampCard>
          <p className="eyebrow">Request a link</p>
          <p className="mt-3 font-display text-2xl tracking-heading">
            {organizer
              ? "The email Luma has as host."
              : "Sign in to see your credits."}
          </p>
          {error === "expired" ? (
            <p className="mt-4 text-sm text-severity-high">
              That link expired. Request a new one.
            </p>
          ) : null}
          <div className="mt-8">
            <EmailForm
              nextPath={nextPath}
              {...(organizer ? { label: "Your organizer email" } : {})}
            />
          </div>
          {organizer ? null : (
            <p className="mt-6 text-[13px] leading-6 text-mute">
              Hosting an event?{" "}
              <Link href={HOST_SIGN_IN_PATH} className="text-ink hover:opacity-60">
                Sign in to manage it
              </Link>
            </p>
          )}
        </StampCard>
      </div>
    </AppShell>
  );
}

import Link from "next/link";
import { SessionActions } from "@/components/session-actions";
import { StampMark } from "@/components/stamp-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { appName, appTagline, footerCredit } from "@/lib/brand";
import { getSession } from "@/lib/session";
import { cn, HOST_SIGN_IN_PATH } from "@/lib/utils";

export async function AppShell({
  children,
  breadcrumb,
  actions,
  creditsNote = false,
  hostDoor = true,
  center = false,
}: {
  children: React.ReactNode;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  creditsNote?: boolean;
  /** The footer's host sign-in link, shown while signed out. */
  hostDoor?: boolean;
  /**
   * For a page too short to fill the screen, which now reads top-heavy since
   * the shell always reaches the bottom. Auto margins resolve to zero once
   * the content outgrows the space, so a long page is left where it is.
   */
  center?: boolean;
}) {
  const session = await getSession();

  return (
    // Viewport units, not `min-h-full`: body's height is content-based, so a
    // percentage min-height collapses and a short page strands the footer
    // mid-screen. `flex-1` on main takes the slack instead.
    <div className="relative flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 md:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-ink hover:opacity-70"
            >
              <StampMark size={22} />
              <span className="wordmark">{appName()}</span>
            </Link>
            {breadcrumb ? (
              <>
                <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden />
                <div className="min-w-0 truncate text-sm text-ink">
                  {breadcrumb}
                </div>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-5">
            {actions ??
              (session ? (
                <SessionActions email={session.email} />
              ) : (
                // Guests are who the header is for. The host door sits in
                // the footer, where a guest does not mistake it for theirs.
                <Link
                  href="/signin"
                  className="text-sm text-ink hover:opacity-60"
                >
                  My credits
                </Link>
              ))}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto w-full max-w-5xl flex-1 px-6 py-14 md:px-10 md:py-20",
          center && "flex flex-col",
        )}
      >
        {center ? <div className="my-auto">{children}</div> : children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-6 py-8 text-[11px] leading-5 text-mute md:px-10">
          <div className="flex max-w-sm flex-col gap-3">
            {creditsNote ? (
              <p>
                Credits unlock after you are stamped at the door. One code per
                partner, assigned to the email on your Luma ticket.
              </p>
            ) : null}
            {session || !hostDoor ? null : (
              <p>
                Hosting an event?{" "}
                <Link href={HOST_SIGN_IN_PATH} className="text-ink hover:opacity-60">
                  Sign in to manage it
                </Link>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="text-ink">{appTagline()}</span>
            <span>{footerCredit()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

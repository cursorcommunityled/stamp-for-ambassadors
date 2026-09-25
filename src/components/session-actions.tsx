import Link from "next/link";
import { signOut } from "@/app/actions";
import { isOrganizerEmail } from "@/lib/auth";
import { creditsPath } from "@/lib/credits";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className={cn("text-sm text-mute hover:text-ink", className)}
      >
        Sign out
      </button>
    </form>
  );
}

export async function SessionActions({
  email,
}: {
  email: string;
}) {
  const [organizer, credits] = await Promise.all([
    isOrganizerEmail(email),
    creditsPath(email),
  ]);

  return (
    <div className="flex items-center gap-5">
      {/*
        An attendee's reason to be here is their codes, so that is the action
        the header offers. Signing out only matters for the one person who
        typed the wrong address, so it stays reachable but quiet.
      */}
      <Link href={credits} className="text-sm text-ink hover:opacity-60">
        My credits
      </Link>
      {organizer ? (
        <Link href="/admin" className="text-sm text-ink hover:opacity-60">
          Manage
        </Link>
      ) : null}
      <SignOutButton className="text-xs" />
    </div>
  );
}

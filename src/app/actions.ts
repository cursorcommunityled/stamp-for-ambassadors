"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  findHost,
  issueMagicLink,
  isAdminEmail,
  SendLimitError,
} from "@/lib/auth";
import { recheckStamp } from "@/lib/claim";
import { db } from "@/lib/db";
import { hasEnded } from "@/lib/events";
import { isAppointedHost } from "@/lib/hosts";
import { callerIp, check, LIMITS } from "@/lib/rate-limit";
import { clearSession, getSession } from "@/lib/session";
import { safeNextPath } from "@/lib/utils";
import { castVote, VoteError } from "@/lib/voting";

export type ActionResult = { error?: string } | undefined;

const emailSchema = z.string().trim().email("That does not look like an email.");

export async function sendStampLink(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter your email." };
  }

  const next = safeNextPath(String(formData.get("next") ?? "/"));

  // The form is public and takes any address, so without this a script can
  // walk an address list and spend the Resend quota and the sending domain's
  // reputation with it. Checked before any work: the point is to be cheap.
  const perIp = await check(
    `signin:ip:${callerIp(await headers())}`,
    LIMITS.signInPerIp,
  );
  if (!perIp.ok) {
    return { error: "Too many sign-in attempts. Try again in a minute." };
  }

  try {
    await issueMagicLink(parsed.data, next);
  } catch (error) {
    if (error instanceof SendLimitError) {
      return {
        error: "That address has had several links already. Check your inbox.",
      };
    }
    return { error: "Could not send the stamp link. Try again in a moment." };
  }

  redirect(`/check-email?next=${encodeURIComponent(next)}`);
}

export async function signOut() {
  await clearSession();
  redirect("/");
}

/**
 * `signInPath` is where to send someone who is not signed in. The attendee
 * home page no longer advertises a way in, so organizer routes have to hand
 * over the form themselves instead of bouncing to "/".
 */
export async function requireSession(signInPath?: string) {
  const session = await getSession();
  if (!session) {
    redirect(
      signInPath ? `/signin?next=${encodeURIComponent(signInPath)}` : "/",
    );
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireSession("/admin");
  if (!isAdminEmail(session.email)) redirect("/");
  return session;
}

/**
 * Two local reads, no Luma. This runs on every request to `/admin`, and
 * anyone who can receive a magic link can reach it, so a Luma call here is a
 * lever for burning the calendar budget that the door scan needs.
 */
export async function requireOrganizer() {
  const session = await requireSession("/admin");
  const admin = isAdminEmail(session.email);
  const host = await findHost(session.email);
  if (admin || host) return { email: session.email, admin, host };

  // Being listed on Luma is not permission yet, and neither is coming in
  // through the host door. They proved they own the address, so saying where
  // they stand leaks nothing, and it beats a silent bounce they would read
  // as the app being broken.
  redirect("/admin/pending");
}

export async function requireEventManager(slug: string) {
  const organizer = await requireOrganizer();
  const event = await db.event.findUnique({
    where: { slug },
    include: { hosts: { select: { id: true } } },
  });
  if (!event) notFound();
  if (!organizer.admin && !isAppointedHost(event, organizer.host?.id)) {
    redirect("/admin");
  }
  return { organizer, event };
}

/**
 * One targeted Luma lookup for the signed-in guest. For walk-ups, pending
 * approvals, and door-scan lag that the minute-level roster sync has not
 * caught yet.
 */
export async function recheckMyStamp(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) redirect("/");

  const slug = String(formData.get("eventSlug") ?? "");
  const event = await db.event.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      lumaEventId: true,
      perksRequireCheckIn: true,
      startAt: true,
      endAt: true,
    },
  });
  if (!event) return { error: "That event is not here." };
  if (hasEnded(event)) return { error: "This event has wrapped." };

  // Each of these is a Luma call. The in-memory cooldown in claim.ts flattens
  // one person on one instance; this is what holds across a deploy and across
  // two web processes, which is exactly when the door needs the budget.
  const quota = await check(
    `recheck:${session.email}`,
    LIMITS.recheckPerEmail,
  );
  if (!quota.ok) {
    return { error: "Checking too often. Leave the page open — it watches." };
  }

  const stamp = await recheckStamp(event, session.email);
  revalidatePath(`/e/${event.slug}/status`);
  if (stamp.locked === "luma_error") {
    return { error: stamp.lockedReason ?? "Could not reach Luma." };
  }
  return undefined;
}

/**
 * The attendee's one vote at the open mic. No `ok` message: the re-rendered
 * ballot marks their pick, which says it better than a line of text under a
 * list they are already looking at.
 */
export async function castMyVote(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) redirect("/");

  const slug = String(formData.get("eventSlug") ?? "");
  const projectId = String(formData.get("projectId") ?? "");

  const event = await db.event.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      lumaEventId: true,
      perksRequireCheckIn: true,
      startAt: true,
      endAt: true,
      votingOpenedAt: true,
      votingClosedAt: true,
    },
  });
  if (!event) return { error: "That event is not here." };

  try {
    await castVote({ event, email: session.email, projectId });
  } catch (error) {
    if (error instanceof VoteError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/e/${event.slug}/vote`);
  // "Your vote is in" on the credits page changes with it, and the host is
  // watching the tally climb on theirs.
  revalidatePath(`/e/${event.slug}/status`);
  revalidatePath(`/admin/e/${event.slug}/vote`);
  return undefined;
}

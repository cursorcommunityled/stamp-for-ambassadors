import { publicOrigin } from "@/lib/app-url";
import { adminEmails } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasEnded } from "@/lib/events";
import { getLumaEvent } from "@/lib/luma";
import { sendHostPendingEmail } from "@/lib/mail";
import { normalizeEmail } from "@/lib/utils";

/**
 * Events an appointed host can manage. Admins skip this filter and see
 * every event.
 */
export function hostedBy(hostId: string | undefined | null) {
  return { hosts: { some: { id: hostId ?? "__none__" } } };
}

export function isAppointedHost(
  event: { hosts: { id: string }[] },
  hostId: string | undefined | null,
) {
  return Boolean(hostId && event.hosts.some((host) => host.id === hostId));
}

/**
 * Luma is the source of truth for who is named on a night, so this adds the
 * emails it lists and drops the ones it no longer does. Hosts an admin typed
 * in by hand are never disconnected: Luma was never asked about them.
 *
 * A discovered row lands unconfirmed. Luma's host list carries no access
 * level, so being on it is a request to manage, not permission to.
 */
export async function syncEventHostsFromLuma(
  eventId: string,
  emails: string[],
) {
  const unique = [
    ...new Set(emails.map((email) => normalizeEmail(email)).filter(Boolean)),
  ];

  const hosts = await Promise.all(
    unique.map((email) =>
      db.host.upsert({
        where: { email },
        create: { email, grantedBy: "luma" },
        update: {},
      }),
    ),
  );

  // An event on Luma always has at least one host, so an empty list is Luma
  // telling us nothing rather than telling us nobody: a response shape we
  // stopped recognising parses to zero entries just as cleanly as a real
  // answer would. Revoking on that would take manage away from the people
  // running the night, at the point where the only tool for fixing it is
  // manage. So an empty list connects nothing and disconnects nothing.
  const stale =
    unique.length === 0
      ? []
      : await db.host.findMany({
          where: {
            grantedBy: "luma",
            events: { some: { id: eventId } },
            email: { notIn: unique },
          },
          select: { id: true },
        });

  await db.event.update({
    where: { id: eventId },
    data: {
      // Import and Refresh from Luma already hold the host list, so they get
      // here without a call of their own. Stamping the clock anyway stops the
      // admin page they redirect to from spending one on the same answer.
      hostsSyncedAt: new Date(),
      hosts: {
        connect: hosts.map((host) => ({ id: host.id })),
        disconnect: stale.map((host) => ({ id: host.id })),
      },
    },
  });

  // After the connect, so the mail describes access that already exists to be
  // granted. Never allowed to fail the sync: the host list is the point of
  // this function, and it is already written by here.
  try {
    await notifyAdminsOfPendingHosts(eventId, unique);
  } catch (error) {
    console.error("[stamp] pending host notification failed:", error);
  }
}

/**
 * Mails the admins about addresses Luma named that nobody has confirmed.
 *
 * One message per sync rather than per host, because importing an event
 * discovers its whole host list at once and four separate mails about the
 * same event is a worse way to say the same thing.
 *
 * The stamp is claimed before the send, not after. Two events syncing the
 * same new address at the same moment would otherwise both find it
 * unannounced and both write to the admin about it; `updateManyAndReturn`
 * makes the claim and says which rows it won in one statement.
 */
async function notifyAdminsOfPendingHosts(eventId: string, emails: string[]) {
  if (emails.length === 0) return;

  const admins = adminEmails();
  if (admins.length === 0) return;

  const claimed = await db.host.updateManyAndReturn({
    where: {
      email: { in: emails },
      confirmedAt: null,
      pendingNotifiedAt: null,
    },
    data: { pendingNotifiedAt: new Date() },
    select: { id: true, email: true },
  });
  if (claimed.length === 0) return;

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { name: true },
  });

  const sent = await Promise.allSettled(
    admins.map((admin) =>
      sendHostPendingEmail({
        email: admin,
        hostEmails: claimed.map((host) => host.email),
        eventName: event?.name ?? "an event",
        url: `${publicOrigin()}/admin`,
      }),
    ),
  );

  // One admin with a dead address should not hold the queue hostage, so the
  // claim stands as long as somebody was reached. Nobody reached means nobody
  // knows, and that is worth releasing the stamp and trying again for.
  if (sent.some((result) => result.status === "fulfilled")) return;

  for (const result of sent) {
    if (result.status === "rejected") {
      console.error("[stamp] pending host email failed:", result.reason);
    }
  }
  await db.host.updateMany({
    where: { id: { in: claimed.map((host) => host.id) } },
    data: { pendingNotifiedAt: null },
  });
}

/**
 * Discovery costs one Luma request, and the calendar budget is 200 a minute
 * shared with the door-scan roster sync. So it claims a slot the same way
 * `syncRosterIfStale` does, and only ever from a page an organizer opened.
 */
const HOST_SYNC_TTL_MS = 15 * 60 * 1000;

async function claimHostSyncSlot(
  eventId: string,
  ttlMs: number,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - ttlMs);
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Event"
    SET "hostsSyncedAt" = now()
    WHERE id = ${eventId}
      AND ("hostsSyncedAt" IS NULL OR "hostsSyncedAt" < ${staleBefore})
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Refreshes one event's host list if nobody has in the last TTL. Ended nights
 * are left alone: their host list is settled, and re-reading it is a Luma
 * call spent on an answer that cannot have changed.
 */
export async function syncEventHostsIfStale(event: {
  id: string;
  lumaEventId: string;
  startAt: Date | null;
  endAt: Date | null;
}): Promise<void> {
  if (hasEnded(event)) return;
  if (!(await claimHostSyncSlot(event.id, HOST_SYNC_TTL_MS))) return;

  try {
    const imported = await getLumaEvent(event.lumaEventId);
    await syncEventHostsFromLuma(event.id, imported.hosts);
  } catch (error) {
    // No rollback of the claimed slot, unlike the roster sync. That one rolls
    // back because a guest is watching a locked page for their codes; here
    // nobody is waiting, and backing off the full TTL after a Luma failure is
    // the behaviour we want. An admin who needs it now has Refresh from Luma.
    console.error(`[stamp] host sync failed for ${event.lumaEventId}:`, error);
  }
}

import { db } from "@/lib/db";

/**
 * Who did what in `/admin`. With one organizer the answer was always "me";
 * with a host per city, "it was already like that" stops being an answer.
 *
 * Written for anything that moves codes, writes what guests are told to
 * open, changes who can manage, or decides the ballot. Reads and syncs are
 * left out: they are noise, and a log nobody can scan is a log nobody reads.
 */
export type AuditAction =
  | "event.create"
  | "event.hosts"
  | "codes.import"
  | "codes.reassign"
  | "howto.save"
  | "voting.open"
  | "voting.close"
  | "host.invite"
  | "host.confirm"
  | "host.revoke";

/**
 * Never throws. An audit write failing must not undo the action it describes:
 * the host is already confirmed, the codes are already moved, and a 500 here
 * would tell the organizer otherwise and invite them to do it twice.
 */
export async function audit(entry: {
  actorEmail: string;
  action: AuditAction;
  eventSlug?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorEmail: entry.actorEmail,
        action: entry.action,
        eventSlug: entry.eventSlug ?? null,
        detail: entry.detail?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    console.error(`[stamp] audit write failed for ${entry.action}:`, error);
  }
}

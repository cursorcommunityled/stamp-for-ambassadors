import { createHash } from "node:crypto";
import { after } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { db } from "@/lib/db";
import { sendMagicLinkEmail } from "@/lib/mail";
import { check, LIMITS, pruneRateLimits } from "@/lib/rate-limit";
import { randomToken } from "@/lib/session";
import { normalizeEmail, safeNextPath } from "@/lib/utils";

const SIGN_IN_TTL_MS = 20 * 60 * 1000;

/**
 * A link we push at someone has to still work whenever they get round to
 * their phone, so it outlives the 20 minutes we give a link they just asked
 * for. It only ever lands on one event's status page.
 */
export const EVENT_LINK_TTL_MS = 12 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mints a one-time link without sending anything. */
export async function createMagicLink(
  rawEmail: string,
  nextPath: string,
  ttlMs: number = SIGN_IN_TTL_MS,
): Promise<string> {
  const token = randomToken();

  await db.magicLink.create({
    data: {
      email: normalizeEmail(rawEmail),
      tokenHash: hashToken(token),
      nextPath: safeNextPath(nextPath),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  return `${appOrigin()}/auth/verify?token=${token}`;
}

/**
 * The sign-in form is public and accepts any address, so without a cooldown
 * anyone can aim it at a stranger's inbox and hold the button down.
 */
const SEND_COOLDOWN_MS = 60 * 1000;

/** How long a link keeps working after its first use. See `consumeMagicLink`. */
const REPLAY_GRACE_MS = 15 * 60 * 1000;

/**
 * Nothing ever deleted these, so every link ever issued stayed on the table
 * with its hash and the path it was headed for. Cleared past the point any of
 * it can still be used: the longest-lived link is the twelve-hour one pushed
 * with a credits email, plus the replay window on top.
 */
const LINK_RETENTION_MS = EVENT_LINK_TTL_MS + REPLAY_GRACE_MS;

/**
 * Swept from `issueMagicLink` because it is the one write path a person
 * triggers by hand, which makes it the cheapest place to put housekeeping
 * that must not need a cron. Never throws: a failed sweep is untidy, not
 * broken, and must not cost somebody their sign-in.
 */
async function prune(): Promise<void> {
  try {
    await Promise.all([
      db.magicLink.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - LINK_RETENTION_MS) } },
      }),
      pruneRateLimits(LINK_RETENTION_MS),
    ]);
  } catch (error) {
    console.error(`[stamp] magic link prune failed:`, error);
  }
}

export class SendLimitError extends Error {
  constructor(readonly retryAfter: number) {
    super("Too many links requested for that address.");
    this.name = "SendLimitError";
  }
}

export async function issueMagicLink(
  rawEmail: string,
  nextPath: string,
): Promise<void> {
  const email = normalizeEmail(rawEmail);

  // A link minted in the last minute is still in their inbox and still valid
  // for twenty more. Returning quietly rather than complaining keeps the form
  // from answering "does this address have an account".
  const recent = await db.magicLink.count({
    where: {
      email,
      createdAt: { gt: new Date(Date.now() - SEND_COOLDOWN_MS) },
    },
  });
  if (recent > 0) return;

  // Counted here rather than in the caller, so the cooldown above absorbs
  // someone clicking resend and only a send that really happens spends from
  // the budget. Bulk credit emails go through `createMagicLink` and are not
  // touched: nothing an attacker can reach triggers those.
  const quota = await check(`signin:email:${email}`, LIMITS.signInPerEmail);
  if (!quota.ok) throw new SendLimitError(quota.retryAfter);

  // Housekeeping, not correctness: links are single-use and expiry is checked
  // on read, so the only thing an old row does is sit there with its hash.
  // Deferred past the response rather than left dangling, so it cannot add
  // latency to a sign-in and cannot be cut off half-done either.
  after(prune);

  const url = await createMagicLink(email, nextPath);
  try {
    await sendMagicLinkEmail(email, url);
  } catch (error) {
    // The row minted above is what the cooldown counts. Left behind after a
    // failed send it would swallow the next minute of attempts, so the guest
    // gets told to check an inbox that nothing was ever sent to.
    const token = new URL(url).searchParams.get("token");
    if (token) {
      await db.magicLink.deleteMany({ where: { tokenHash: hashToken(token) } });
    }
    throw error;
  }
}

export async function inspectMagicLink(token: string): Promise<{
  email: string;
  nextPath: string;
} | null> {
  if (!token || token.length < 32) return null;
  const link = await db.magicLink.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!link) return null;
  return { email: link.email, nextPath: safeNextPath(link.nextPath) };
}

export async function consumeMagicLink(token: string): Promise<{
  email: string;
  nextPath: string;
} | null> {
  if (!token || token.length < 32) return null;
  const tokenHash = hashToken(token);
  const link = await db.magicLink.findUnique({ where: { tokenHash } });
  if (!link) return null;
  if (link.expiresAt.getTime() < Date.now()) return null;

  const used = await db.magicLink.updateMany({
    where: {
      id: link.id,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });

  if (used.count === 0) {
    // Someone reached this link first. Where that someone is a mail scanner,
    // refusing the guest leaves them holding a dead link and unable to mint
    // another until the cooldown lifts. Honour it for a short while after the
    // first touch instead. The window never outlives the link.
    const claimed = await db.magicLink.findUnique({
      where: { id: link.id },
      select: { consumedAt: true },
    });
    const firstUse = claimed?.consumedAt?.getTime();
    if (!firstUse || Date.now() - firstUse > REPLAY_GRACE_MS) return null;
  }

  return { email: link.email, nextPath: safeNextPath(link.nextPath) };
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(normalizeEmail(email));
}

/**
 * Only confirmed hosts. Luma names hosts without saying what they are allowed
 * to do, so an unconfirmed row means "Luma listed this address", not "this
 * address may manage". Filtering here tightens `isHostEmail`,
 * `isOrganizerEmail`, and `requireOrganizer` in one place.
 */
export async function findHost(email: string) {
  return db.host.findFirst({
    where: { email: normalizeEmail(email), confirmedAt: { not: null } },
  });
}

/** Sees pending rows too. For telling "waiting on an admin" apart from "not a host". */
export async function findHostIncludingPending(email: string) {
  return db.host.findUnique({
    where: { email: normalizeEmail(email) },
    include: { events: { select: { slug: true, name: true } } },
  });
}

export async function isHostEmail(email: string): Promise<boolean> {
  return Boolean(await findHost(email));
}

export async function isOrganizerEmail(email: string): Promise<boolean> {
  return isAdminEmail(email) || (await isHostEmail(email));
}

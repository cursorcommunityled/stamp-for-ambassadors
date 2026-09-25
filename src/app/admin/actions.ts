"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  requireAdmin,
  requireEventManager,
  requireOrganizer,
} from "@/app/actions";
import { audit } from "@/lib/audit";
import { issueMagicLink } from "@/lib/auth";
import { parseCsvCodes } from "@/lib/claim";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/codes";
import { eventSnapshot, hasEnded, isFixtureEvent } from "@/lib/events";
import { isAppointedHost, syncEventHostsFromLuma } from "@/lib/hosts";
import { getLumaEvent, LumaError, resolveLumaEventId } from "@/lib/luma";
import { publicOrigin } from "@/lib/app-url";
import { maySendMail, sendTestEmail } from "@/lib/mail";
import { partnersFor } from "@/lib/partners";
import { deliverCredits, syncRosterNow } from "@/lib/roster";
import { normalizeEmail, slugify, uniqueSlug } from "@/lib/utils";

export type ActionResult = { error?: string; imported?: number; ok?: string } | undefined;

const createSchema = z.object({
  lumaEventId: z.string().trim().min(3, "Paste a Luma event id or URL."),
  perksRequireCheckIn: z.boolean(),
  hostEmail: z.string().trim().email().optional().or(z.literal("")),
});

function alreadyOnStampError(
  organizer: { admin: boolean; host: { id: string } | null },
  existing: { hosts: { id: string }[] },
) {
  if (organizer.admin) {
    return { error: "That Luma event is already on Stamp." };
  }
  if (isAppointedHost(existing, organizer.host?.id)) {
    return { error: "You already manage that event." };
  }
  return {
    error: "That event is already on Stamp. Ask an admin to appoint you as a host.",
  };
}

async function applyImportedEvent(
  slug: string,
  imported: ReturnType<typeof eventSnapshot>,
  extra: { perksRequireCheckIn?: boolean } = {},
) {
  const event = await db.event.update({
    where: { slug },
    data: { ...imported, ...extra },
  });
  revalidatePath("/");
  revalidatePath(`/e/${event.slug}`);
  revalidatePath(`/e/${event.slug}/status`);
  revalidatePath(`/admin/e/${event.slug}`);
  revalidatePath("/admin");
  return event;
}

export async function createEvent(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const organizer = await requireOrganizer();

  const parsed = createSchema.safeParse({
    lumaEventId: formData.get("lumaEventId"),
    perksRequireCheckIn: formData.get("perksRequireCheckIn") === "on",
    hostEmail: formData.get("hostEmail") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  let lumaEventId: string;
  try {
    const resolved = await resolveLumaEventId(parsed.data.lumaEventId);
    if (!resolved) {
      return { error: "Paste a Luma event URL or an evt- id." };
    }
    lumaEventId = resolved;
  } catch (error) {
    return {
      error:
        error instanceof LumaError
          ? error.message
          : "Could not read that event from Luma.",
    };
  }

  const existing = await db.event.findUnique({
    where: { lumaEventId },
    select: { slug: true, hosts: { select: { id: true } } },
  });
  if (existing) {
    return alreadyOnStampError(organizer, existing);
  }

  let imported;
  try {
    imported = await getLumaEvent(lumaEventId);
  } catch (error) {
    return {
      error:
        error instanceof LumaError
          ? error.message
          : "Could not read that event from Luma.",
    };
  }

  // A host brings their own night, and Luma is what says whose it is. An
  // empty or unreadable host list matches nobody, so it fails closed.
  if (!organizer.admin) {
    const email = normalizeEmail(organizer.email);
    if (!imported.hosts.some((host) => normalizeEmail(host) === email)) {
      return {
        error: "Luma does not list you as a host of that event. Ask an admin to import it.",
      };
    }
  }

  const hostIds: string[] = [];
  if (organizer.admin) {
    const hostEmail = parsed.data.hostEmail
      ? normalizeEmail(parsed.data.hostEmail)
      : "";
    if (hostEmail) {
      const host = await db.host.findUnique({ where: { email: hostEmail } });
      if (!host) return { error: "Invite that host before assigning an event." };
      hostIds.push(host.id);
    }
  } else if (organizer.host) {
    hostIds.push(organizer.host.id);
  }

  const base = slugify(imported.name);
  const slug = await uniqueSlug(base, async (candidate) => {
    const found = await db.event.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    return Boolean(found);
  });

  let event;
  try {
    event = await db.event.create({
      data: {
        ...eventSnapshot(imported),
        slug,
        perksRequireCheckIn: parsed.data.perksRequireCheckIn,
        hosts: hostIds.length
          ? { connect: hostIds.map((id) => ({ id })) }
          : undefined,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db.event.findUnique({
      where: { lumaEventId },
      select: { hosts: { select: { id: true } } },
    });
    if (raced) return alreadyOnStampError(organizer, raced);
    throw error;
  }

  await audit({
    actorEmail: organizer.email,
    action: "event.create",
    eventSlug: event.slug,
    detail: lumaEventId,
  });

  try {
    await syncEventHostsFromLuma(event.id, imported.hosts);
  } catch (error) {
    console.error(`[stamp] host sync failed for ${event.slug}:`, error);
  }

  try {
    await syncRosterNow(event);
  } catch (error) {
    console.error(`[stamp] first roster sync failed for ${event.slug}:`, error);
  }

  revalidatePath("/");
  revalidatePath("/admin");
  redirect(`/admin/e/${event.slug}`);
}

export async function refreshEventFromLuma(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const slug = String(formData.get("eventSlug") ?? "");
  const { event } = await requireEventManager(slug);

  try {
    const imported = await getLumaEvent(event.lumaEventId);
    await applyImportedEvent(event.slug, eventSnapshot(imported));
    await syncEventHostsFromLuma(event.id, imported.hosts);
    const roster = await syncRosterNow(event);
    if (roster.error) {
      return {
        ok: "Details refreshed. Guest list could not be updated — try again in a moment.",
      };
    }
    return { ok: "Event details and guest list refreshed from Luma." };
  } catch (error) {
    return {
      error:
        error instanceof LumaError
          ? error.message
          : "Could not refresh that event from Luma.",
    };
  }
}

export async function inviteHost(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = z
    .string()
    .trim()
    .email("That does not look like an email.")
    .safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter an email." };
  }

  const email = normalizeEmail(parsed.data);
  // Confirmed on the spot: an admin typed this address, which is the whole
  // thing confirmation is checking for. Also promotes a pending Luma row.
  await db.host.upsert({
    where: { email },
    create: {
      email,
      grantedBy: admin.email,
      confirmedAt: new Date(),
      confirmedBy: admin.email,
    },
    update: {
      grantedBy: admin.email,
      confirmedAt: new Date(),
      confirmedBy: admin.email,
    },
  });
  await audit({ actorEmail: admin.email, action: "host.invite", detail: email });

  try {
    await issueMagicLink(email, "/admin");
  } catch {
    return { error: "Host saved, but the invite link could not be sent." };
  }

  revalidatePath("/admin");
  return { ok: `Invited ${email}.` };
}

const hostIdSchema = z.string().trim().min(1);

/**
 * The gate on Luma-discovered hosts. Luma's host list has no access level, so
 * a check-in volunteer and the person running the night arrive identical; an
 * admin saying which is which is the only thing that can tell them apart.
 */
export async function confirmHost(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = hostIdSchema.safeParse(formData.get("hostId"));
  if (!parsed.success) return { error: "Unknown host." };

  const host = await db.host.findUnique({ where: { id: parsed.data } });
  if (!host) return { error: "Unknown host." };
  if (host.confirmedAt) return { ok: `${host.email} is already confirmed.` };

  await db.host.update({
    where: { id: host.id },
    data: { confirmedAt: new Date(), confirmedBy: admin.email },
  });
  await audit({
    actorEmail: admin.email,
    action: "host.confirm",
    detail: host.email,
  });

  revalidatePath("/admin");
  return { ok: `${host.email} can now manage their events.` };
}

/**
 * Takes manage away without deleting the row, so the event links survive and
 * a later Luma sync cannot quietly hand access back: `syncEventHostsFromLuma`
 * only ever reconnects events, never sets `confirmedAt`.
 */
export async function revokeHost(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = hostIdSchema.safeParse(formData.get("hostId"));
  if (!parsed.success) return { error: "Unknown host." };

  const host = await db.host.findUnique({ where: { id: parsed.data } });
  if (!host) return { error: "Unknown host." };

  await db.host.update({
    where: { id: host.id },
    data: {
      confirmedAt: null,
      confirmedBy: null,
      // Revoking drops them back into the unconfirmed pile, which is what the
      // pending mail watches. Stamped here so the next Luma sync does not
      // write to the admin asking them to confirm the person they just
      // turned down.
      pendingNotifiedAt: new Date(),
    },
  });
  await audit({
    actorEmail: admin.email,
    action: "host.revoke",
    detail: host.email,
  });

  revalidatePath("/admin");
  return { ok: `${host.email} can no longer manage events.` };
}

export async function assignEventHosts(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const slug = String(formData.get("eventSlug") ?? "");
  const hostIds = formData
    .getAll("hostId")
    .map((value) => String(value))
    .filter(Boolean);

  const event = await db.event.findUnique({ where: { slug } });
  if (!event) return { error: "Unknown event." };

  const hosts =
    hostIds.length === 0
      ? []
      : await db.host.findMany({ where: { id: { in: hostIds } } });
  if (hosts.length !== hostIds.length) return { error: "Unknown host." };

  await db.event.update({
    where: { id: event.id },
    data: {
      hosts: { set: hosts.map((host) => ({ id: host.id })) },
    },
  });
  await audit({
    actorEmail: admin.email,
    action: "event.hosts",
    eventSlug: event.slug,
    detail: hosts.map((host) => host.email).join(", ") || "none",
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/e/${event.slug}`);
  return { ok: "Hosts updated. Admins still manage this event." };
}

function revalidateInventory(slug: string) {
  revalidatePath(`/admin/e/${slug}`);
  revalidatePath(`/e/${slug}`);
  revalidatePath(`/e/${slug}/status`);
}

/** A partner this event can already use, matched on the name as typed. */
async function partnerNamed(eventId: string, name: string) {
  const slug = slugify(name);
  const partners = await db.sponsor.findMany({ where: partnersFor(eventId) });
  const matches = partners.filter((partner) => slugify(partner.name) === slug);
  return matches.find((partner) => partner.eventId === eventId) ?? matches[0] ?? null;
}

async function newSponsorPlace(name: string) {
  const last = await db.sponsor.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const slug = await uniqueSlug(slugify(name), async (candidate) =>
    Boolean(await db.sponsor.findUnique({ where: { slug: candidate } })),
  );
  return { slug, sortOrder: (last?.sortOrder ?? 0) + 1 };
}

async function resolveSponsor(
  formData: FormData,
  event: { id: string },
  organizer: { admin: boolean },
) {
  const newName = String(formData.get("newPartnerName") ?? "").trim();
  if (newName) {
    // Same partner, so its copy stays as written.
    const existing = await partnerNamed(event.id, newName);
    if (existing) return existing;
    return db.sponsor.create({
      data: {
        ...(await newSponsorPlace(newName)),
        name: newName,
        perk: String(formData.get("newPartnerPerk") ?? "").trim() || null,
        instructions:
          String(formData.get("newPartnerInstructions") ?? "").trim() || null,
        // A host writes for their own night. Only an admin adds to the list
        // every event picks from.
        eventId: organizer.admin ? null : event.id,
      },
    });
  }

  const sponsorSlug = String(formData.get("sponsorSlug") ?? "");
  return db.sponsor.findFirst({
    where: { slug: sponsorSlug, ...partnersFor(event.id) },
  });
}

const guideSchema = z.object({
  eventSlug: z.string().trim().min(1),
  name: z.string().trim().min(1, "Name the partner.").max(80),
  perk: z.string().trim().max(120).optional().or(z.literal("")),
  instructions: z
    .string()
    .trim()
    .min(1, "Write the steps.")
    .max(2000),
});

/**
 * A how-to with no codes, for this event's guests only. The copy is stored
 * for this deploy. It is not part of the repo, so a real offer never has to
 * be committed.
 */
export async function saveGuide(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { organizer, event } = await requireEventManager(
    String(formData.get("eventSlug") ?? ""),
  );
  const parsed = guideSchema.safeParse({
    eventSlug: formData.get("eventSlug"),
    name: formData.get("name"),
    perk: formData.get("perk"),
    instructions: formData.get("instructions"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the steps." };
  }

  const perk = parsed.data.perk?.trim() || null;
  const existing = await partnerNamed(event.id, parsed.data.name);
  // Only a how-to written on this event can be rewritten here. The shared
  // list shows on other nights, so its copy is not this event's to change.
  if (existing && existing.eventId !== event.id) {
    return { error: `${existing.name} is already in the partner list. Give this how-to its own name.` };
  }
  if (existing) {
    const hasCodes = (await db.code.count({ where: { sponsorId: existing.id } })) > 0;
    await db.sponsor.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        perk,
        instructions: parsed.data.instructions,
        // A partner that already has codes keeps showing only on nights
        // with a file. A name with no codes becomes a standing how-to.
        guide: hasCodes ? existing.guide : true,
      },
    });
  } else {
    await db.sponsor.create({
      data: {
        ...(await newSponsorPlace(parsed.data.name)),
        name: parsed.data.name,
        perk,
        instructions: parsed.data.instructions,
        guide: true,
        eventId: event.id,
      },
    });
  }
  await audit({
    actorEmail: organizer.email,
    action: "howto.save",
    eventSlug: event.slug,
    detail: parsed.data.name,
  });

  revalidateInventory(event.slug);
  return { ok: `${parsed.data.name} will show its steps to guests stamped at this event.` };
}

export async function importCodes(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const eventSlug = String(formData.get("eventSlug") ?? "");
  const { organizer, event } = await requireEventManager(eventSlug);
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    const name = String(formData.get("newPartnerName") ?? "").trim();
    if (!name) {
      return { error: "Choose a CSV, or name a new partner and write the steps." };
    }
    const steps = new FormData();
    steps.set("eventSlug", eventSlug);
    steps.set("name", name);
    steps.set("perk", String(formData.get("newPartnerPerk") ?? ""));
    steps.set("instructions", String(formData.get("newPartnerInstructions") ?? ""));
    return saveGuide(undefined, steps);
  }
  if (file.size > 1_000_000) {
    return { error: "That file is too large." };
  }

  const sponsor = await resolveSponsor(formData, event, organizer);
  if (!sponsor) {
    return { error: "Pick a partner, or name a new one." };
  }

  const codes = parseCsvCodes(await file.text());
  if (codes.length === 0) {
    return { error: "No codes found in that file." };
  }

  const result = await db.code.createMany({
    data: codes.map((code) => ({
      eventId: event.id,
      sponsorId: sponsor.id,
      code,
    })),
    skipDuplicates: true,
  });
  await audit({
    actorEmail: organizer.email,
    action: "codes.import",
    eventSlug: event.slug,
    detail: `${result.count} ${sponsor.slug} codes from ${file.name}`,
  });

  if (!hasEnded(event)) await deliverCredits(event.id);
  revalidateInventory(event.slug);
  return { imported: result.count };
}

/** Drops one leftover. Claimed rows stay — that code already left the room. */
export async function removeCode(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const slug = String(formData.get("eventSlug") ?? "");
  const { event } = await requireEventManager(slug);
  const codeId = String(formData.get("codeId") ?? "");

  const deleted = await db.code.deleteMany({
    where: { id: codeId, eventId: event.id, claimedByAttendeeId: null },
  });
  if (deleted.count === 0) {
    return { error: "That code is already claimed or gone." };
  }

  revalidateInventory(event.slug);
  return { ok: "Code removed." };
}

/** Clears the leftover pile for one partner. Claimed rows stay. */
export async function removeUnclaimed(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const slug = String(formData.get("eventSlug") ?? "");
  const { event } = await requireEventManager(slug);
  const sponsorSlug = String(formData.get("sponsorSlug") ?? "");
  const sponsor = await db.sponsor.findUnique({ where: { slug: sponsorSlug } });
  if (!sponsor) return { error: "Unknown partner." };

  const deleted = await db.code.deleteMany({
    where: {
      eventId: event.id,
      sponsorId: sponsor.id,
      claimedByAttendeeId: null,
    },
  });

  revalidateInventory(event.slug);
  return { ok: `Removed ${deleted.count} leftover ${deleted.count === 1 ? "code" : "codes"}.` };
}

const projectSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(120),
  builders: z.string().trim().min(1, "Say who built it.").max(200),
  description: z.string().trim().max(600).optional().or(z.literal("")),
});

/** Everywhere the ballot or its results are read. */
function revalidateVoting(slug: string) {
  revalidatePath(`/admin/e/${slug}/vote`);
  revalidatePath(`/e/${slug}/vote`);
  // Both sides carry a card into the ballot, so opening or closing has to
  // reach the pages that describe it as well as the ballot itself.
  revalidatePath(`/admin/e/${slug}`);
  revalidatePath(`/e/${slug}/status`);
}

/**
 * Typed in live while a team is still presenting, so this stays as short as
 * the moment allows: a name, who built it, and a description only if there
 * was time to write one.
 */
export async function addProject(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const slug = String(formData.get("eventSlug") ?? "");
  const { event } = await requireEventManager(slug);

  const parsed = projectSchema.safeParse({
    name: formData.get("name"),
    builders: formData.get("builders"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const last = await db.project.findFirst({
    where: { eventId: event.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  await db.project.create({
    data: {
      eventId: event.id,
      name: parsed.data.name,
      builders: parsed.data.builders,
      description: parsed.data.description || null,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  revalidateVoting(event.slug);
  return { ok: `Added ${parsed.data.name}.` };
}

/** Removing a project drops the votes cast for it, by cascade. */
export async function removeProject(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const slug = String(formData.get("eventSlug") ?? "");
  const { event } = await requireEventManager(slug);
  const projectId = String(formData.get("projectId") ?? "");

  // Scoped to this event, so a host cannot delete another night's row by id.
  const deleted = await db.project.deleteMany({
    where: { id: projectId, eventId: event.id },
  });
  if (deleted.count === 0) return { error: "That project is already gone." };

  revalidateVoting(event.slug);
  return { ok: "Project removed." };
}

/**
 * Opens and closes the ballot by hand.
 *
 * Reopening restarts `votingOpenedAt` rather than keeping the first one. That
 * timestamp is what `votingState` measures its own auto-close from, so a host
 * clearing an accidental close an hour later would otherwise be handed a
 * ballot with an hour already run off it — and reopening the morning after
 * would shut again on the same press.
 */
export async function setVoting(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const slug = String(formData.get("eventSlug") ?? "");
  const { organizer, event } = await requireEventManager(slug);
  const intent = String(formData.get("intent") ?? "");

  if (intent !== "open" && intent !== "close") {
    return { error: "Unknown voting action." };
  }

  if (intent === "open") {
    const projects = await db.project.count({ where: { eventId: event.id } });
    if (projects === 0) {
      return { error: "Add at least one project before opening the vote." };
    }
    await db.event.update({
      where: { id: event.id },
      data: { votingOpenedAt: new Date(), votingClosedAt: null },
    });
    await audit({
      actorEmail: organizer.email,
      action: "voting.open",
      eventSlug: event.slug,
      detail: `${projects} on the ballot`,
    });
    revalidateVoting(event.slug);
    return { ok: "Voting is open. Attendees can vote from their status page." };
  }

  await db.event.update({
    where: { id: event.id },
    data: { votingClosedAt: new Date() },
  });
  await audit({
    actorEmail: organizer.email,
    action: "voting.close",
    eventSlug: event.slug,
  });
  revalidateVoting(event.slug);
  return { ok: "Voting closed. Results are on this page and the attendees'." };
}

export async function sendSetupTestEmail(): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!maySendMail()) {
    return {
      error:
        "Mail is not sent from here. On Render, with a public address and a Resend key, this button posts a test to your inbox.",
    };
  }
  try {
    await sendTestEmail(admin.email, publicOrigin());
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not send the test.",
    };
  }
  return { ok: `Sent a test to ${admin.email}.` };
}

export async function reassignLeftovers(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const fromSlug = String(formData.get("fromSlug") ?? "");
  const toSlug = String(formData.get("toSlug") ?? "");
  const sponsorSlug = String(formData.get("sponsorSlug") ?? "");
  const { organizer, event: from } = await requireEventManager(fromSlug);
  const { event: to } = await requireEventManager(toSlug);

  if (!organizer.admin) {
    const hostId = organizer.host?.id;
    if (!isAppointedHost(from, hostId) || !isAppointedHost(to, hostId)) {
      return { error: "You can only move leftovers between events you manage." };
    }
  }

  const sponsor = await db.sponsor.findUnique({ where: { slug: sponsorSlug } });
  if (!sponsor) {
    return { error: "Pick a destination event and a sponsor." };
  }
  if (from.id === to.id) {
    return { error: "Pick a different event to move leftovers to." };
  }
  if (hasEnded(to)) {
    return { error: "Leftovers can only move to an upcoming event." };
  }
  if (isFixtureEvent(from) || isFixtureEvent(to)) {
    return { error: "Preview events cannot send or receive leftover codes." };
  }

  const moved = await db.code.updateMany({
    where: {
      eventId: from.id,
      sponsorId: sponsor.id,
      claimedByAttendeeId: null,
    },
    data: { eventId: to.id },
  });
  await audit({
    actorEmail: organizer.email,
    action: "codes.reassign",
    eventSlug: from.slug,
    detail: `${moved.count} ${sponsor.slug} codes to ${to.slug}`,
  });

  await deliverCredits(to.id);

  revalidatePath(`/admin/e/${from.slug}`);
  revalidatePath(`/admin/e/${to.slug}`);
  return {
    ok: `Moved ${moved.count} leftover ${moved.count === 1 ? "code" : "codes"}.`,
  };
}

import { z } from "zod";

/**
 * Luma public API. Keys are calendar-scoped: one key covers every event on
 * its calendar and nothing else. This app never writes back to Luma, so a
 * leaked key cannot alter an event.
 *
 * Rate limit is 200 requests/minute per calendar. One lookup per claim stays
 * well under that.
 */

/** Overridable only so the test suite can point at a fake Luma. */
const BASE_URL = process.env.LUMA_API_URL?.trim() || "https://public-api.luma.com";

export class LumaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LumaError";
  }
}

function apiKey(): string {
  const key = process.env.LUMA_API_KEY;
  if (!key) {
    throw new LumaError(
      "LUMA_API_KEY is not set. Generate one at luma.com/calendar/manage/api-keys for the calendar this event lives on.",
    );
  }
  return key;
}

async function lumaGet<T>(
  path: string,
  params: Record<string, string | undefined> = {},
  attempt = 0,
): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "x-luma-api-key": apiKey(), Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new LumaError("Could not reach Luma. Try again in a moment.");
    }
    throw error;
  }

  if (response.status === 429 && attempt < 1) {
    await new Promise((r) => setTimeout(r, 1000));
    return lumaGet<T>(path, params, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new LumaError(
        "Luma rejected the API key. Check it is the key for the calendar this event belongs to.",
        response.status,
      );
    }
    throw new LumaError(
      `Luma request failed (${response.status}). ${body.slice(0, 200)}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

const ticketSchema = z
  .object({
    checked_in_at: z.string().nullish(),
  })
  .passthrough();

const guestSchema = z
  .object({
    id: z.string().optional(),
    api_id: z.string().optional(),
    user_email: z.string().optional(),
    email: z.string().optional(),
    user_name: z.string().nullish(),
    name: z.string().nullish(),
    approval_status: z.string(),
    registered_at: z.string().nullish(),
    checked_in_at: z.string().nullish(),
    event_tickets: z.array(ticketSchema).optional(),
    tickets: z.array(ticketSchema).optional(),
    user: z
      .object({
        email: z.string().optional(),
        name: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type NormalizedGuest = {
  lumaGuestId: string;
  email: string;
  name: string | null;
  approvalStatus: string;
  registeredAt: Date | null;
  checkedInAt: Date | null;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeGuest(
  guest: z.infer<typeof guestSchema>,
): NormalizedGuest | null {
  const lumaGuestId = guest.id ?? guest.api_id;
  const email = (
    guest.user_email ??
    guest.email ??
    guest.user?.email
  )?.trim().toLowerCase();
  if (!lumaGuestId || !email) return null;

  const tickets = guest.event_tickets ?? guest.tickets ?? [];
  const checkIns = [parseDate(guest.checked_in_at), ...tickets.map((ticket) =>
    parseDate(ticket.checked_in_at),
  )]
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    lumaGuestId,
    email,
    name: guest.user_name?.trim() || guest.name?.trim() || guest.user?.name?.trim() || null,
    approvalStatus: guest.approval_status,
    registeredAt: parseDate(guest.registered_at),
    checkedInAt: checkIns[0] ?? null,
  };
}

function unwrapGuest(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "guest" in raw) {
    return (raw as { guest: unknown }).guest;
  }
  return raw;
}

const addressSchema = z
  .object({
    address: z.string().nullish(),
    city: z.string().nullish(),
    region: z.string().nullish(),
    country: z.string().nullish(),
    city_state: z.string().nullish(),
    full_address: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

const lumaHostSchema = z
  .object({
    email: z.string().optional(),
    user_email: z.string().optional(),
    user: z
      .object({
        email: z.string().optional(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const lumaEventSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    start_at: z.string().nullish(),
    end_at: z.string().nullish(),
    timezone: z.string().nullish(),
    cover_url: z.string().nullish(),
    url: z.string().nullish(),
    description: z.string().nullish(),
    geo_address_json: addressSchema.nullish(),
    location_type: z.string().nullish(),
    hosts: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type ImportedLumaEvent = {
  lumaEventId: string;
  name: string;
  startAt: Date | null;
  endAt: Date | null;
  timezone: string | null;
  location: string | null;
  coverUrl: string | null;
  lumaUrl: string | null;
  description: string | null;
  /** Luma event hosts. This is who may manage the night on Stamp. */
  hosts: string[];
};

function hostEmailsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const emails = new Set<string>();
  for (const entry of raw) {
    const parsed = lumaHostSchema.safeParse(entry);
    if (!parsed.success) continue;
    const email = (
      parsed.data.email ??
      parsed.data.user_email ??
      parsed.data.user?.email
    )
      ?.trim()
      .toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

function unwrapEvent(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "event" in raw) {
    return (raw as { event: unknown }).event;
  }
  return raw;
}

function formatLumaLocation(
  address: z.infer<typeof addressSchema> | null | undefined,
  locationType: string | null | undefined,
): string | null {
  if (address) {
    const label =
      address.city_state?.trim() ||
      [address.city, address.country].filter(Boolean).join(", ") ||
      address.full_address?.trim() ||
      address.address?.trim() ||
      address.description?.trim() ||
      null;
    if (label) return label;
  }

  if (
    locationType &&
    locationType !== "offline" &&
    locationType !== "missing"
  ) {
    return locationType === "unknown" ? "Online" : `Online · ${locationType}`;
  }

  return null;
}

const EXCERPT_MAX = 280;
/** Under this, ending on a sentence throws away more than the tidiness buys. */
const EXCERPT_MIN = 180;

function excerptDescription(
  value: string | null | undefined,
  eventName: string,
): string | null {
  if (!value) return null;
  let text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Luma descriptions often open by repeating the event title, which the page
  // already carries as its heading and in the cover art. Only separators are
  // eaten after it, so a description like "Name (Netaville) …" keeps its
  // bracket rather than being left starting mid-phrase.
  const title = eventName.trim();
  if (title && text.toLowerCase().startsWith(title.toLowerCase())) {
    text = text.slice(title.length).replace(/^[\s:;,.|·—–-]+/, "");
  }

  if (!text) return null;
  if (text.length <= EXCERPT_MAX) return text;

  // Cut where a reader expects a cut. Slicing at a fixed count leaves the
  // stray head of the next word ("…and motivated peers. A…"), which reads as
  // a broken render rather than an excerpt. A full stop late in the window
  // ends the copy outright; short of that, the last whole word takes the
  // ellipsis.
  const window = text.slice(0, EXCERPT_MAX - 2);
  const sentence = window.match(/^[\s\S]*[.!?](?=\s|$)/);
  if (sentence && sentence[0].length >= EXCERPT_MIN) {
    return sentence[0].trimEnd();
  }

  const lastSpace = window.lastIndexOf(" ");
  const word = lastSpace > 0 ? window.slice(0, lastSpace) : window;
  return `${word.replace(/[\s.,;:!?—–-]+$/, "")}…`;
}

/**
 * Fetch one event the calendar key can see. 404 means the id is unknown or
 * lives on a different calendar.
 */
export async function getLumaEvent(
  lumaEventId: string,
): Promise<ImportedLumaEvent> {
  try {
    const raw = await lumaGet<unknown>("/v1/events/get", {
      event_id: lumaEventId,
    });
    const parsed = lumaEventSchema.safeParse(unwrapEvent(raw));
    if (!parsed.success) {
      throw new LumaError("Luma returned an event this app cannot read.");
    }

    const event = parsed.data;
    const name = event.name.trim();
    const siblingHosts =
      raw && typeof raw === "object" && "hosts" in raw
        ? (raw as { hosts: unknown }).hosts
        : undefined;
    return {
      lumaEventId: event.id,
      name,
      startAt: parseDate(event.start_at),
      endAt: parseDate(event.end_at),
      timezone: event.timezone?.trim() || null,
      location: formatLumaLocation(event.geo_address_json, event.location_type),
      coverUrl: event.cover_url?.trim() || null,
      lumaUrl: event.url?.trim() || null,
      description: excerptDescription(event.description, name),
      hosts: hostEmailsFrom(event.hosts ?? siblingHosts),
    };
  } catch (error) {
    if (error instanceof LumaError && error.status === 404) {
      throw new LumaError(
        "That Luma event is not on this calendar, or the id is wrong.",
        404,
      );
    }
    throw error;
  }
}

const LUMA_HOSTS = new Set(["luma.com", "www.luma.com", "lu.ma", "www.lu.ma"]);
const PAGE_SIZE = 100;
/** 50 pages of 100 covers any community event; the cap stops a cursor loop. */
const MAX_PAGES = 50;

export function parseLumaEventId(input: string): string | null {
  const match = input.trim().match(/evt-[A-Za-z0-9]+/);
  return match?.[0] ?? null;
}

/** First path segment of a luma.com / lu.ma link, or a bare slug. */
export function lumaEventSlug(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || parseLumaEventId(trimmed)) return null;

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (LUMA_HOSTS.has(url.hostname.toLowerCase())) {
      const slug = url.pathname.replace(/^\//, "").split("/").filter(Boolean)[0];
      if (slug && !RESERVED_LUMA_PATHS.has(slug.toLowerCase())) return slug;
    }
  } catch {
    // Not a URL.
  }

  if (/^[A-Za-z0-9][A-Za-z0-9-]{2,}$/.test(trimmed)) return trimmed;
  return null;
}

const RESERVED_LUMA_PATHS = new Set([
  "calendar",
  "home",
  "signin",
  "login",
  "event",
  "e",
  "user",
  "settings",
]);

const listEntrySchema = z
  .object({
    id: z.string(),
    url: z.string().nullish(),
  })
  .passthrough();

const eventListPageSchema = z.object({
  entries: z.array(z.unknown()),
  has_more: z.boolean().nullish(),
  next_cursor: z.string().nullish(),
});

function slugFromLumaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!LUMA_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed.pathname.replace(/^\//, "").split("/").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Public Luma pages are `luma.com/slug`, not `evt-…`. The calendar list is
 * what maps one to the other for a key that can actually manage the event.
 */
async function findCalendarEventIdBySlug(slug: string): Promise<string | null> {
  const wanted = slug.toLowerCase();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = await lumaGet<unknown>("/v1/calendars/events/list", {
      pagination_limit: String(PAGE_SIZE),
      pagination_cursor: cursor,
    });
    const parsed = eventListPageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new LumaError("Luma returned a calendar this app cannot read.");
    }

    for (const entry of parsed.data.entries) {
      const item = listEntrySchema.safeParse(entry);
      if (!item.success) continue;
      const entrySlug = slugFromLumaUrl(item.data.url);
      if (entrySlug && entrySlug.toLowerCase() === wanted) return item.data.id;
    }

    if (!parsed.data.has_more || !parsed.data.next_cursor) break;
    cursor = parsed.data.next_cursor;
  }

  return null;
}

/**
 * Accepts an evt- id, a luma.com / lu.ma URL, or the public slug.
 * Returns null when the paste is not a Luma event at all.
 */
export async function resolveLumaEventId(input: string): Promise<string | null> {
  const eventId = parseLumaEventId(input);
  if (eventId) return eventId;

  const slug = lumaEventSlug(input);
  if (!slug) return null;

  const found = await findCalendarEventIdBySlug(slug);
  if (!found) {
    throw new LumaError(
      "That Luma event is not on this calendar, or the link is wrong.",
      404,
    );
  }
  return found;
}

/**
 * Look up one guest by email (also accepts gst-, g-, or a ticket key).
 * Returns null when Luma has no matching guest on this event.
 */
export async function getGuestByEmail(
  lumaEventId: string,
  email: string,
): Promise<NormalizedGuest | null> {
  try {
    const raw = await lumaGet<unknown>("/v1/events/guests/get", {
      event_id: lumaEventId,
      id: email,
    });
    const parsed = guestSchema.safeParse(unwrapGuest(raw));
    if (!parsed.success) {
      throw new LumaError("Luma returned a guest this app cannot read.");
    }
    const guest = normalizeGuest(parsed.data);
    if (!guest) {
      throw new LumaError("Luma returned a guest this app cannot read.");
    }
    return guest;
  } catch (error) {
    if (error instanceof LumaError && error.status === 404) return null;
    throw error;
  }
}

const guestPageSchema = z.object({
  entries: z.array(z.unknown()),
  has_more: z.boolean().nullish(),
  next_cursor: z.string().nullish(),
});

/**
 * Every guest on the event, following the cursor to the end.
 *
 * One call of this replaces a per-attendee lookup on every page view, which
 * is what keeps a full room inside the 200 requests/minute calendar budget.
 * An entry Luma returns in a shape we cannot read is skipped rather than
 * failing the whole sync. One odd registration must not lock out the room.
 */
export async function listGuests(
  lumaEventId: string,
): Promise<NormalizedGuest[]> {
  const guests: NormalizedGuest[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = await lumaGet<unknown>("/v1/events/guests/list", {
      event_id: lumaEventId,
      pagination_limit: String(PAGE_SIZE),
      pagination_cursor: cursor,
    });

    const parsed = guestPageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new LumaError("Luma returned a guest list this app cannot read.");
    }

    for (const entry of parsed.data.entries) {
      const parsedGuest = guestSchema.safeParse(unwrapGuest(entry));
      if (!parsedGuest.success) continue;
      const guest = normalizeGuest(parsedGuest.data);
      if (guest) guests.push(guest);
    }

    if (!parsed.data.has_more || !parsed.data.next_cursor) break;
    cursor = parsed.data.next_cursor;
  }

  return guests;
}

/** One cheap call, so an admin page can tell a bad key from a good one. */
export async function pingLuma(): Promise<void> {
  await lumaGet<unknown>("/v1/calendars/events/list", {
    pagination_limit: "1",
  });
}

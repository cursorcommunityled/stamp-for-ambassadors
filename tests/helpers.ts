import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { ADMIN_EMAIL, DATABASE_URL, FAKE_LUMA_URL, OUTBOX } from "./env";
import type { FakeEvent, FakeGuest } from "./fake-luma";

export { ADMIN_EMAIL };

let pool: pg.Pool | null = null;

/** Raw SQL against the test database, for setup and for checking what the app wrote. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}

/** Unique per call, so specs never collide on emails, slugs, or Luma ids. */
export function uid(prefix = "t"): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

// ── Fake Luma ────────────────────────────────────────────────────────────

async function lumaControl(path: string, body: unknown = {}) {
  const response = await fetch(`${FAKE_LUMA_URL}/__fake/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`fake Luma ${path}: ${response.status}`);
  return response.json();
}

export const luma = {
  event: (event: FakeEvent) => lumaControl("event", event),
  removeEvent: (id: string) => lumaControl("remove-event", { id }),
  hosts: (eventId: string, hosts: string[]) => lumaControl("hosts", { eventId, hosts }),
  guest: (eventId: string, guest: FakeGuest) => lumaControl("guest", { eventId, guest }),
  checkIn: (eventId: string, email: string, approve = false) =>
    lumaControl("checkin", { eventId, email, approve }),
  mode: (mode: "ok" | "error" | "unauthorized" | "slow") => lumaControl("mode", { mode }),
  calls: async (): Promise<string[]> =>
    (await (await fetch(`${FAKE_LUMA_URL}/__fake/calls`)).json()).calls,
};

const HOUR = 3600_000;

/** A Luma event happening right now, with the given guests on its list. */
export function liveEvent(
  overrides: Partial<FakeEvent> & { guests?: FakeGuest[] } = {},
): FakeEvent {
  const id = `evt-${uid("live")}`;
  return {
    id,
    slug: id.replace("evt-", "night-"),
    name: `Build Night ${id.slice(-5)}`,
    start_at: new Date(Date.now() - HOUR).toISOString(),
    end_at: new Date(Date.now() + 4 * HOUR).toISOString(),
    timezone: "Europe/Skopje",
    city: "Skopje",
    hosts: [],
    guests: [],
    ...overrides,
  };
}

export function guest(
  email: string,
  overrides: Partial<FakeGuest> = {},
): FakeGuest {
  return {
    id: `gst-${uid("g")}`,
    email,
    name: email.split("@")[0].replace(/\W/g, " "),
    approval_status: "approved",
    registered_at: new Date(Date.now() - 24 * HOUR).toISOString(),
    checked_in_at: null,
    ...overrides,
  };
}

// ── Sign-in ──────────────────────────────────────────────────────────────

/**
 * Mints a one-time link the same way the app does and follows it. For specs
 * that are about what happens after sign-in, not the sign-in form itself.
 */
export async function signIn(page: Page, email: string, next = "/") {
  const token = randomBytes(32).toString("hex");
  await sql(
    `INSERT INTO "MagicLink" (id, email, "tokenHash", "nextPath", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, now() + interval '20 minutes', now() - interval '2 minutes')`,
    [randomUUID(), email.toLowerCase(), createHash("sha256").update(token).digest("hex"), next],
  );
  await page.goto(`/auth/verify?token=${token}`);
}

type Mail = { to: string; subject: string; text: string };

export function outbox(to?: string): Mail[] {
  let raw = "";
  try {
    raw = readFileSync(OUTBOX, "utf8");
  } catch {
    return [];
  }
  const mails = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Mail);
  return to ? mails.filter((m) => m.to === to.toLowerCase()) : mails;
}

/** The link in the newest mail to this address, waiting for it to arrive. */
export async function linkFromMail(to: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(() => {
      const mail = outbox(to).at(-1);
      link = mail?.text.match(/https?:\/\/\S+/)?.[0];
      return link;
    })
    .toBeTruthy();
  return link!;
}

/** Gives each test its own "IP", so per-IP sign-in limits never leak between specs. */
export async function ownIp(page: Page) {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
}

// ── Admin shortcuts ──────────────────────────────────────────────────────

/** Imports a fake Luma event through the real admin form and returns its slug. */
export async function importEvent(
  page: Page,
  event: FakeEvent,
  opts: { requireCheckIn?: boolean; paste?: string } = {},
): Promise<string> {
  await luma.event(event);
  await page.goto("/admin");
  await page.getByText("New event").first().click();
  await page.getByLabel("Luma event").fill(opts.paste ?? event.id);
  const checkbox = page.locator('input[name="perksRequireCheckIn"]');
  if ((opts.requireCheckIn ?? true) !== (await checkbox.isChecked())) {
    await checkbox.click();
  }
  await page.getByRole("button", { name: "Import event" }).click();
  await page.waitForURL(/\/admin\/e\/[^/]+$/);
  return page.url().split("/admin/e/")[1];
}

/** Adds codes for one partner by uploading a CSV through the event page. */
export async function uploadCodes(
  page: Page,
  slug: string,
  sponsorSlug: string,
  codes: string[],
) {
  await page.goto(`/admin/e/${slug}`);
  // With no pool yet the form sits open on the page; after that it is folded.
  const fold = page.locator("summary", { hasText: "Add codes" });
  if (await fold.count()) await fold.click();
  await page.locator("select").filter({ has: page.locator("option[value='cursor'], option[value='__new__']") }).first().selectOption(sponsorSlug);
  await page.locator('input[name="file"]').setInputFiles({
    name: "codes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(["code", ...codes].join("\n")),
  });
  await page.getByRole("button", { name: "Upload CSV" }).click();
  // The "Imported…" line is replaced as soon as the page refreshes the pool.
  await expect(page.getByText(/\d+ left · \d+ total/)).toBeVisible();
}

export async function eventId(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }>(`SELECT id FROM "Event" WHERE slug = $1`, [slug]);
  return row.id;
}

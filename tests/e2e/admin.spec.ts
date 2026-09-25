import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  closeDb,
  eventId,
  guest,
  importEvent,
  liveEvent,
  luma,
  ownIp,
  signIn,
  sql,
  uid,
  uploadCodes,
} from "../helpers";

test.afterAll(closeDb);
test.afterEach(async () => {
  await luma.mode("ok");
});
test.beforeEach(async ({ page }) => {
  await ownIp(page);
});

test("imports by id and by public URL, and refuses a duplicate", async ({ page }) => {
  const event = liveEvent();
  await signIn(page, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(page, event);
  await expect(page.getByText(event.id)).toBeVisible();

  await page.goto("/admin");
  await page.getByText("New event").first().click();
  await page.getByLabel("Luma event").fill(`https://luma.com/${event.slug}`);
  await page.getByRole("button", { name: "Import event" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("That Luma event is already on Stamp.");

  const other = liveEvent({ name: "URL Night" });
  const otherSlug = await importEvent(page, other, {
    paste: `https://luma.com/${other.slug}`,
  });
  expect(otherSlug).not.toBe(slug);
  await expect(page.getByRole("heading", { name: "URL Night" })).toBeVisible();
});

test("a link that is not on this calendar is refused", async ({ page }) => {
  await signIn(page, ADMIN_EMAIL, "/admin");
  await page.goto("/admin");
  await page.getByText("New event").first().click();
  await page.getByLabel("Luma event").fill("https://luma.com/not-on-this-calendar");
  await page.getByRole("button", { name: "Import event" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText(
    "That Luma event is not on this calendar, or the link is wrong.",
  );
});

test("a Luma outage during import is reported and leaves no event", async ({ page }) => {
  const event = liveEvent({ name: "Outage Night" });
  await luma.event(event);
  await luma.mode("error");
  await signIn(page, ADMIN_EMAIL, "/admin");
  await page.goto("/admin");
  await page.getByText("New event").first().click();
  await page.getByLabel("Luma event").fill(event.id);
  await page.getByRole("button", { name: "Import event" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Luma request failed");
  const rows = await sql(`SELECT id FROM "Event" WHERE "lumaEventId" = $1`, [event.id]);
  expect(rows).toHaveLength(0);
});

test("uploads codes, adds a partner, removes leftovers, and records it", async ({ page }) => {
  const event = liveEvent();
  await signIn(page, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(page, event);
  await uploadCodes(page, slug, "cursor", ["KEEP-1", "DROP-1", "DROP-2"]);

  await page.getByRole("button", { name: "Remove all leftovers" }).click();
  await expect(page.getByText("Nothing uploaded yet.")).toBeVisible();

  const upload = page.locator("form").filter({ has: page.locator("option[value='__new__']") }).first();
  await upload.locator("select").selectOption("__new__");
  await upload.getByLabel("Partner name").fill("Wispr Flow");
  await upload.getByLabel("Perk").fill("3 months Pro");
  await upload.locator('input[name="file"]').setInputFiles({
    name: "wispr.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("code\nWISPR-1\n"),
  });
  await upload.getByRole("button", { name: "Save partner" }).click();
  await expect(page.getByRole("heading", { name: "Wispr Flow" })).toBeVisible();

  await page.goto("/admin");
  await page.getByText("Activity").first().click();
  await expect(page.getByText("codes.import").first()).toBeVisible();
});

test("a new partner with steps and no CSV is saved as a how-to", async ({ page }) => {
  const name = `Guide ${uid("partner")}`;
  await signIn(page, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(page, liveEvent());

  const upload = page.locator("form").filter({ has: page.locator("option[value='__new__']") }).first();
  await upload.locator("select").selectOption("__new__");
  await upload.getByLabel("Partner name").fill(name);
  await upload.getByLabel("How to redeem").fill("Open the partner site.");
  await upload.getByRole("button", { name: "Save partner" }).click();
  await expect(
    upload.getByText(`${name} will show its steps to guests stamped at this event.`),
  ).toBeVisible();
  // An admin's how-to belongs to its event too. Only a partner with codes
  // joins the shared list.
  const [row] = await sql<{ guide: boolean; eventId: string | null }>(
    `SELECT guide, "eventId" FROM "Sponsor" WHERE name = $1`,
    [name],
  );
  expect(row.guide).toBe(true);
  expect(row.eventId).toBe(await eventId(slug));
});

test("moves unclaimed codes to another upcoming event and leaves claimed ones", async ({
  page,
}) => {
  const email = `${uid("claimed")}@example.test`;
  const from = liveEvent({
    guests: [guest(email, { checked_in_at: new Date().toISOString() })],
  });
  const to = liveEvent({ name: "Next Week" });
  await signIn(page, ADMIN_EMAIL, "/admin");
  const fromSlug = await importEvent(page, from);
  const toSlug = await importEvent(page, to);
  await uploadCodes(page, fromSlug, "cursor", ["STAYS", "MOVES"]);

  const [claimed] = await sql<{ id: string }>(
    `SELECT a.id FROM "EventAttendee" a JOIN "Event" e ON e.id = a."eventId"
     WHERE e.slug = $1 AND a.email = $2`,
    [fromSlug, email],
  );
  await sql(
    `UPDATE "Code" SET "claimedByAttendeeId" = $1, "claimedAt" = now() WHERE code = 'STAYS'`,
    [claimed.id],
  );

  await page.goto(`/admin/e/${fromSlug}`);
  await page.locator("summary", { hasText: "Leftovers" }).click();
  await page.locator('select[name="toSlug"]').selectOption(toSlug);
  await page.getByRole("button", { name: "Move leftovers" }).click();
  await expect(page.getByText("Moved 1 leftover code.")).toBeVisible();

  const toId = await eventId(toSlug);
  const [moved] = await sql<{ n: string }>(
    `SELECT count(*) AS n FROM "Code" WHERE "eventId" = $1 AND code = 'MOVES'`,
    [toId],
  );
  const [stayed] = await sql<{ n: string }>(
    `SELECT count(*) AS n FROM "Code" WHERE code = 'STAYS' AND "claimedByAttendeeId" IS NOT NULL`,
  );
  expect(Number(moved.n)).toBe(1);
  expect(Number(stayed.n)).toBe(1);
});

test("refresh pulls a renamed event back from Luma", async ({ page }) => {
  const event = liveEvent({ name: "Old Name" });
  await signIn(page, ADMIN_EMAIL, "/admin");
  await importEvent(page, event);
  await luma.event({ ...event, name: "New Name" });
  await page.getByText("Luma details").first().click();
  await page.getByRole("button", { name: "Refresh from Luma" }).click();
  await expect(page.getByText("Event details and guest list refreshed from Luma.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New Name" })).toBeVisible();
});

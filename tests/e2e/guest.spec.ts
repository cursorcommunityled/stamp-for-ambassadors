import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  closeDb,
  eventId,
  guest,
  importEvent,
  linkFromMail,
  liveEvent,
  luma,
  ownIp,
  signIn,
  sql,
  uid,
  uploadCodes,
} from "../helpers";

test.afterAll(closeDb);

test.beforeEach(async ({ page }) => {
  await ownIp(page);
});

/** A live event on Stamp with a Cursor pool, imported by the admin. */
async function setUpNight(
  browser: import("@playwright/test").Browser,
  guests: ReturnType<typeof guest>[],
  opts: { requireCheckIn?: boolean; codes?: number } = {},
) {
  const event = liveEvent({ guests });
  const context = await browser.newContext();
  const admin = await context.newPage();
  await signIn(admin, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(admin, event, { requireCheckIn: opts.requireCheckIn });
  const count = opts.codes ?? 5;
  if (count > 0) {
    await uploadCodes(
      admin,
      slug,
      "cursor",
      Array.from({ length: count }, () => uid("CODE-").toUpperCase()),
    );
  }
  await context.close();
  return { event, slug };
}

test("a guest signs in through the form and the emailed link", async ({ page, browser }) => {
  const email = `${uid("form")}@example.test`;
  const { slug } = await setUpNight(browser, [guest(email)]);

  await page.goto(`/e/${slug}`);
  await page.getByLabel("Email on the ticket").fill(email);
  await page.getByRole("button", { name: "Send me a verification link" }).click();
  await page.waitForURL(/\/check-email/);

  const link = await linkFromMail(email);
  expect(link).toContain("/auth/verify?token=");
  await page.goto(link);
  await page.waitForURL(`**/e/${slug}/status`);
  await expect(page.getByRole("heading", { name: "Not yet." })).toBeVisible();
});

test("a bad email is refused before anything is sent", async ({ page, browser }) => {
  const { slug } = await setUpNight(browser, [], { codes: 0 });
  await page.goto(`/e/${slug}`);
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByLabel("Email on the ticket").fill("not-an-email");
  await page.getByRole("button", { name: "Send me a verification link" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("That does not look like an email.");
});

test("someone not on the guest list is told so", async ({ page, browser }) => {
  const { slug } = await setUpNight(browser, []);
  await signIn(page, `${uid("stranger")}@example.test`, `/e/${slug}/status`);
  await expect(page.getByRole("heading", { name: "Not on this list." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register on Luma ↗" })).toBeVisible();
});

for (const [status, title] of [
  ["pending_approval", "Waiting on approval."],
  ["waitlist", "Waiting on approval."],
  ["declined", "Registration declined."],
] as const) {
  test(`a ${status} registration stays locked`, async ({ page, browser }) => {
    const email = `${uid(status)}@example.test`;
    const { slug } = await setUpNight(browser, [guest(email, { approval_status: status })]);
    await signIn(page, email, `/e/${slug}/status`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
  });
}

test("the door scan unlocks credits, and they are delivered without a click", async ({
  page,
  browser,
}) => {
  const email = `${uid("door")}@example.test`;
  const { event, slug } = await setUpNight(browser, [guest(email, { name: "Ana Door" })]);

  await signIn(page, email, `/e/${slug}/status`);
  await expect(page.getByRole("heading", { name: "Not yet." })).toBeVisible();

  await luma.checkIn(event.id, email);
  await page.getByRole("button", { name: "Check again" }).click();

  await expect(page.getByRole("heading", { name: "Ana, you're stamped." })).toBeVisible();
  await expect(page.getByRole("link", { name: /CODE-/ })).toBeVisible();

  const [row] = await sql<{ n: string }>(
    `SELECT count(*) AS n FROM "Code" c JOIN "EventAttendee" a ON a.id = c."claimedByAttendeeId"
     WHERE a.email = $1 AND c."eventId" = $2`,
    [email, await eventId(slug)],
  );
  expect(Number(row.n)).toBe(1);
});

test("an event without a door scan unlocks on an approved registration", async ({
  page,
  browser,
}) => {
  const email = `${uid("nodoor")}@example.test`;
  const { slug } = await setUpNight(browser, [guest(email, { name: "Bo Open" })], {
    requireCheckIn: false,
  });
  await signIn(page, email, `/e/${slug}/status`);
  await expect(page.getByRole("heading", { name: "Bo, you're stamped." })).toBeVisible();
});

test("a guest who registers after the import is found on their first visit", async ({
  page,
  browser,
}) => {
  const email = `${uid("late")}@example.test`;
  const { event, slug } = await setUpNight(browser, []);
  await luma.guest(event.id, guest(email, { name: "Late Walker", checked_in_at: new Date().toISOString() }));
  await signIn(page, email, `/e/${slug}/status`);
  await expect(page.getByRole("heading", { name: "Late, you're stamped." })).toBeVisible();
});

test("the claim button hands out one code per guest and says when the pool is dry", async ({
  page,
  browser,
}) => {
  const first = `${uid("first")}@example.test`;
  const second = `${uid("second")}@example.test`;
  const now = new Date().toISOString();
  const { slug } = await setUpNight(
    browser,
    [guest(first, { checked_in_at: now }), guest(second, { checked_in_at: now })],
    { codes: 0 },
  );

  // Both stamped before any codes exist, so nothing is delivered yet.
  const admin = await browser.newPage();
  await signIn(admin, ADMIN_EMAIL, "/admin");
  // One code for two people.
  await uploadCodes(admin, slug, "cursor", ["ONLY-ONE"]);
  await admin.close();

  const [owner] = await sql<{ email: string }>(
    `SELECT a.email FROM "Code" c JOIN "EventAttendee" a ON a.id = c."claimedByAttendeeId"
     WHERE c.code = 'ONLY-ONE'`,
  );
  expect([first, second]).toContain(owner.email);
  const loser = owner.email === first ? second : first;

  await signIn(page, loser, `/e/${slug}/status`);
  await expect(page.getByText("Out of codes. Find an organizer.")).toBeVisible();

  const response = await page.request.post("/api/claim", {
    data: { eventSlug: slug, sponsor: "cursor" },
  });
  expect(response.status()).toBe(409);
});

test("a second claim returns the same code instead of a new one", async ({ page, browser }) => {
  const email = `${uid("twice")}@example.test`;
  const { slug } = await setUpNight(browser, [
    guest(email, { checked_in_at: new Date().toISOString() }),
  ]);
  await signIn(page, email, `/e/${slug}/status`);
  const a = await (await page.request.post("/api/claim", { data: { eventSlug: slug, sponsor: "cursor" } })).json();
  const b = await (await page.request.post("/api/claim", { data: { eventSlug: slug, sponsor: "cursor" } })).json();
  expect(a.code).toBeTruthy();
  expect(b.code).toBe(a.code);
});

test("claiming without a session or for an unknown partner is refused", async ({ page, browser }) => {
  const email = `${uid("api")}@example.test`;
  const { slug } = await setUpNight(browser, [
    guest(email, { checked_in_at: new Date().toISOString() }),
  ]);
  const anonymous = await page.request.post("/api/claim", {
    data: { eventSlug: slug, sponsor: "cursor" },
  });
  expect(anonymous.status()).toBe(401);

  await signIn(page, email, `/e/${slug}/status`);
  const unknown = await page.request.post("/api/claim", {
    data: { eventSlug: slug, sponsor: "nobody" },
  });
  expect(unknown.ok()).toBeFalsy();
  const garbage = await page.request.post("/api/claim", { data: "{" });
  expect(garbage.status()).toBeGreaterThanOrEqual(400);
  expect(garbage.status()).toBeLessThan(500);
});

test("a Luma outage does not lock out a guest we already know", async ({ page, browser }) => {
  const email = `${uid("outage")}@example.test`;
  const { slug } = await setUpNight(browser, [
    guest(email, { name: "Cy Known", checked_in_at: new Date().toISOString() }),
  ]);
  await luma.mode("error");
  try {
    await signIn(page, email, `/e/${slug}/status`);
    await expect(page.getByRole("heading", { name: "Cy, you're stamped." })).toBeVisible();
  } finally {
    await luma.mode("ok");
  }
});

test("a Luma outage tells an unknown guest to retry rather than 'not on list'", async ({
  page,
  browser,
}) => {
  const { slug } = await setUpNight(browser, []);
  await luma.mode("error");
  try {
    await signIn(page, `${uid("unknown")}@example.test`, `/e/${slug}/status`);
    await expect(page.getByText("Retrying")).toBeVisible();
  } finally {
    await luma.mode("ok");
  }
});

test("an ended event is read-only and hands out nothing", async ({ page, browser }) => {
  const email = `${uid("ended")}@example.test`;
  const DAY = 86_400_000;
  const event = liveEvent({
    start_at: new Date(Date.now() - 3 * DAY).toISOString(),
    end_at: new Date(Date.now() - 3 * DAY + 3 * 3600_000).toISOString(),
    guests: [guest(email, { checked_in_at: new Date(Date.now() - 3 * DAY).toISOString() })],
  });
  const admin = await browser.newPage();
  await signIn(admin, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(admin, event);
  // Codes uploaded to a finished night must not be handed to its old guests.
  await uploadCodes(admin, slug, "cursor", ["LATE-1", "LATE-2"]);
  await admin.close();

  const [assigned] = await sql<{ n: string }>(
    `SELECT count(*) AS n FROM "Code" WHERE "eventId" = $1 AND "claimedByAttendeeId" IS NOT NULL`,
    [await eventId(slug)],
  );
  expect(Number(assigned.n)).toBe(0);

  await page.goto(`/e/${slug}`);
  await expect(page.getByText("This one is over.")).toBeVisible();
  await signIn(page, email, `/e/${slug}/status`);
  await expect(page.getByRole("heading", { name: "This event has wrapped." })).toBeVisible();
  const claim = await page.request.post("/api/claim", {
    data: { eventSlug: slug, sponsor: "cursor" },
  });
  expect(claim.ok()).toBeFalsy();
});

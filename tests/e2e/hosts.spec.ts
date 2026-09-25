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
} from "../helpers";

test.afterAll(closeDb);
test.beforeEach(async ({ page }) => {
  await ownIp(page);
});

test("a Luma host waits, then manages only their event, and a revoke sticks", async ({
  page,
  browser,
}) => {
  const hostEmail = `${uid("host")}@example.test`;
  const mine = liveEvent({ name: "Hosted Night", hosts: [hostEmail] });
  const other = liveEvent({ name: "Someone Else" });

  await signIn(page, ADMIN_EMAIL, "/admin");
  const mineSlug = await importEvent(page, mine);
  await importEvent(page, other);

  await page.goto("/admin");
  await page.getByText("Pending hosts").first().click();
  await expect(page.getByText(hostEmail).first()).toBeVisible();

  const host = await browser.newPage();
  await ownIp(host);
  await signIn(host, hostEmail, "/admin");
  await expect(host.getByRole("heading", { name: "Almost." })).toBeVisible();
  await expect(host.getByText("Waiting on an admin")).toBeVisible();

  await page.getByRole("button", { name: `Confirm ${hostEmail}` }).click();
  await page.getByText("Hosts", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: `Revoke ${hostEmail}` })).toBeVisible();

  await host.goto("/admin");
  await expect(host.getByRole("heading", { name: "Your events." })).toBeVisible();
  await expect(host.getByText("Hosted Night")).toBeVisible();
  await expect(host.getByText("Someone Else")).toHaveCount(0);
  await host.goto(`/admin/e/${mineSlug}`);
  await expect(host.getByRole("heading", { name: "Hosted Night" })).toBeVisible();

  await page.goto("/admin");
  await page.getByText("Hosts", { exact: true }).first().click();
  await page.getByRole("button", { name: `Revoke ${hostEmail}` }).click();
  await expect(page.getByText("Pending hosts")).toBeVisible();

  await luma.hosts(mine.id, [hostEmail]);
  await page.goto(`/admin/e/${mineSlug}`);
  await page.getByText("Luma details").first().click();
  await page.getByRole("button", { name: "Refresh from Luma" }).click();
  await expect(page.getByText("refreshed from Luma")).toBeVisible();

  await host.goto("/admin");
  await expect(host.getByRole("heading", { name: "Almost." })).toBeVisible();
  await host.close();
});

test("an invited host can manage immediately, but only imports events Luma lists them on", async ({
  page,
  browser,
}) => {
  const email = `${uid("invited")}@example.test`;
  await signIn(page, ADMIN_EMAIL, "/admin");
  await page.goto("/admin");
  await page.getByText("Hosts", { exact: true }).first().click();
  await page.getByLabel("Host email").fill(email);
  await page.getByRole("button", { name: "Invite host" }).click();
  await expect(page.getByText(`Invited ${email}.`)).toBeVisible();

  const link = await linkFromMail(email);
  const host = await browser.newPage();
  await host.goto(link);
  await host.waitForURL("**/admin");
  await expect(host.getByRole("heading", { name: "Your events." })).toBeVisible();

  const notTheirs = liveEvent({ name: "Not Theirs" });
  await luma.event(notTheirs);
  await host.getByText("New event").first().click();
  await host.getByLabel("Luma event").fill(notTheirs.id);
  await host.getByRole("button", { name: "Import event" }).click();
  await expect(host.locator("p[role=alert]")).toContainText(
    "Luma does not list you as a host of that event.",
  );
  const rows = await sql(`SELECT id FROM "Event" WHERE "lumaEventId" = $1`, [notTheirs.id]);
  expect(rows).toHaveLength(0);

  const event = liveEvent({ name: "Invited Import", hosts: [email], guests: [guest(email)] });
  const slug = await importEvent(host, event);
  await expect(host.getByRole("heading", { name: "Invited Import" })).toBeVisible();
  expect(slug).toBeTruthy();
  await host.close();
});

test("a host's how-to reaches only their own guests and leaves shared partners alone", async ({
  page,
  browser,
}) => {
  const email = `${uid("howto")}@example.test`;
  const mine = `${uid("mine")}@example.test`;
  const theirs = `${uid("theirs")}@example.test`;
  const partner = `Steps ${uid("partner")}`;
  const scanned = { checked_in_at: new Date().toISOString() };

  await signIn(page, ADMIN_EMAIL, "/admin");
  const otherSlug = await importEvent(page, liveEvent({ guests: [guest(theirs, scanned)] }));
  await page.goto("/admin");
  await page.getByText("Hosts", { exact: true }).first().click();
  await page.getByLabel("Host email").fill(email);
  await page.getByRole("button", { name: "Invite host" }).click();
  await expect(page.getByText(`Invited ${email}.`)).toBeVisible();

  const host = await browser.newPage();
  await ownIp(host);
  await host.goto(await linkFromMail(email));
  await host.waitForURL("**/admin");
  const hostSlug = await importEvent(
    host,
    liveEvent({ name: "Host Night", hosts: [email], guests: [guest(mine, scanned)] }),
  );

  const upload = host.locator("form").filter({ has: host.locator("option[value='__new__']") }).first();
  await upload.locator("select").selectOption("__new__");
  await upload.getByLabel("Partner name").fill(partner);
  await upload.getByLabel("How to redeem").fill("https://example.test/redeem");
  await upload.getByRole("button", { name: "Save partner" }).click();
  await expect(
    upload.getByText(`${partner} will show its steps to guests stamped at this event.`),
  ).toBeVisible();
  const [row] = await sql<{ eventId: string | null }>(
    `SELECT "eventId" FROM "Sponsor" WHERE name = $1`,
    [partner],
  );
  expect(row.eventId).toBe(await eventId(hostSlug));

  await host.locator("summary", { hasText: "How-to" }).click();
  const howTo = host.locator("form").filter({ has: host.getByRole("button", { name: "Save how-to" }) });
  await howTo.getByLabel("Partner name").fill("Cursor");
  await howTo.getByLabel("Steps").fill("https://evil.example/phish");
  await howTo.getByRole("button", { name: "Save how-to" }).click();
  await expect(
    howTo.getByText("Cursor is already in the partner list. Give this how-to its own name."),
  ).toBeVisible();
  const [cursor] = await sql<{ instructions: string | null }>(
    `SELECT instructions FROM "Sponsor" WHERE slug = 'cursor'`,
  );
  expect(cursor.instructions ?? "").not.toContain("evil.example");

  const guestPage = await browser.newPage();
  await ownIp(guestPage);
  await signIn(guestPage, mine, `/e/${hostSlug}/status`);
  await expect(guestPage.getByRole("heading", { name: /you're stamped/ })).toBeVisible();
  await expect(guestPage.getByRole("heading", { name: partner })).toBeVisible();

  await signIn(page, theirs, `/e/${otherSlug}/status`);
  await expect(page.getByRole("heading", { name: /you're stamped/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: partner })).toHaveCount(0);

  await signIn(page, ADMIN_EMAIL, `/admin/e/${otherSlug}`);
  await expect(page.locator("option", { hasText: partner })).toHaveCount(0);
  await host.reload();
  await expect(host.locator("option", { hasText: partner })).toHaveCount(1);

  await guestPage.close();
  await host.close();
});

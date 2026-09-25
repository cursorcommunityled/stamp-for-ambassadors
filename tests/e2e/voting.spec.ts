import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  closeDb,
  eventId,
  guest,
  importEvent,
  liveEvent,
  ownIp,
  signIn,
  sql,
  uid,
} from "../helpers";

test.afterAll(closeDb);
test.beforeEach(async ({ page }) => {
  await ownIp(page);
});

test("the open mic: add, open, vote, move, close, reopen, and remove", async ({
  page,
  browser,
}) => {
  const stamped = `${uid("voter")}@example.test`;
  const waiting = `${uid("wait")}@example.test`;
  const event = liveEvent({
    guests: [
      guest(stamped, { name: "Ada Voter", checked_in_at: new Date().toISOString() }),
      guest(waiting, { name: "Bea Waiting" }),
    ],
  });

  const admin = await browser.newPage();
  await ownIp(admin);
  await signIn(admin, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(admin, event);

  await admin.goto(`/admin/e/${slug}/vote`);
  await admin.getByRole("button", { name: "Open voting" }).click();
  await expect(admin.locator("p[role=alert]")).toHaveText(
    "Add at least one project before opening the vote.",
  );

  await admin.getByLabel("Project").fill("Bus Radar");
  await admin.getByLabel("Built by").fill("Ada");
  await admin.getByRole("button", { name: "Add to ballot" }).click();
  await expect(admin.getByText("Added Bus Radar.")).toBeVisible();
  await admin.getByRole("button", { name: "Open voting" }).click();
  await expect(admin.getByRole("heading", { name: "Voting is open." })).toBeVisible();

  await signIn(page, waiting, `/e/${slug}/status?view=voting`);
  await expect(page.getByText("Get stamped and you get a vote.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vote" })).toHaveCount(0);

  const voter = await browser.newPage();
  await ownIp(voter);
  await signIn(voter, stamped, `/e/${slug}/status?view=voting`);
  await voter.getByRole("button", { name: "Vote" }).click();
  await expect(voter.getByText("Your vote")).toBeVisible();

  await admin.getByLabel("Project").fill("Recipe Remix");
  await admin.getByLabel("Built by").fill("Bo");
  await admin.getByRole("button", { name: "Add to ballot" }).click();
  await expect(admin.getByText("Added Recipe Remix.")).toBeVisible();

  await voter.reload();
  const remix = voter.locator("li", { hasText: "Recipe Remix" });
  await remix.getByRole("button", { name: "Move here" }).click();
  await expect(remix.getByText("Your vote")).toBeVisible();
  const [moved] = await sql<{ name: string }>(
    `SELECT p.name FROM "Vote" v JOIN "Project" p ON p.id = v."projectId" WHERE v."eventId" = $1`,
    [await eventId(slug)],
  );
  expect(moved.name).toBe("Recipe Remix");

  await admin.getByRole("button", { name: "Close voting" }).click();
  await expect(admin.getByText("Voting closed.")).toBeVisible();
  await voter.reload();
  await expect(voter.getByText("Recipe Remix won.")).toBeVisible();

  await voter.goto(`/e/${slug}/projects`);
  await expect(voter.getByText("Recipe Remix")).toBeVisible();
  await expect(voter.getByText("What the room saw, in the order the votes settled.")).toBeVisible();

  await admin.getByRole("button", { name: "Reopen voting" }).click();
  await expect(admin.getByRole("heading", { name: "Voting is open." })).toBeVisible();

  await admin.getByRole("button", { name: "Remove" }).first().click();
  await expect(admin.getByText("Project removed.")).toBeVisible();
  await admin.close();
  await voter.close();
});

test("a ballot left open for six hours closes itself", async ({ page, browser }) => {
  const email = `${uid("late")}@example.test`;
  const event = liveEvent({
    guests: [guest(email, { checked_in_at: new Date().toISOString() })],
  });
  const admin = await browser.newPage();
  await signIn(admin, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(admin, event);
  await admin.goto(`/admin/e/${slug}/vote`);
  await admin.getByLabel("Project").fill("Night Bus");
  await admin.getByLabel("Built by").fill("Cy");
  await admin.getByRole("button", { name: "Add to ballot" }).click();
  await admin.getByRole("button", { name: "Open voting" }).click();
  await expect(admin.getByRole("heading", { name: "Voting is open." })).toBeVisible();
  await admin.close();

  await sql(
    `UPDATE "Event" SET "votingOpenedAt" = now() - interval '7 hours' WHERE slug = $1`,
    [slug],
  );

  await signIn(page, email, `/e/${slug}/status?view=voting`);
  await expect(page.getByRole("button", { name: "Vote" })).toHaveCount(0);
  await expect(page.getByText("Voting closed without a single vote.")).toBeVisible();
});

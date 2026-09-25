import { createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { APP_URL } from "../env";
import {
  ADMIN_EMAIL,
  closeDb,
  guest,
  importEvent,
  linkFromMail,
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

const COOKIE = "stamp_ambassadors_session";
const SECRET = "test-only-secret-7c1f0e9a4b2d8c6e5f3a1b0c9d8e7f6a5b4c3d2e1f0a9b8c";

function sessionCookie(email: string, secret = SECRET) {
  const payload = Buffer.from(
    JSON.stringify({
      email,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

test("an expired link and a long-used link both bounce", async ({ page }) => {
  const event = liveEvent();
  const admin = page;
  await signIn(admin, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(admin, event);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/");

  const expired = randomBytes(32).toString("hex");
  await sql(
    `INSERT INTO "MagicLink" (id, email, "tokenHash", "nextPath", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, now() - interval '1 minute', now() - interval '30 minutes')`,
    [
      randomUUID(),
      "expired@example.test",
      createHash("sha256").update(expired).digest("hex"),
      `/e/${slug}/status`,
    ],
  );
  await page.goto(`/auth/verify?token=${expired}`);
  await expect(page.getByText("That link expired.")).toBeVisible();

  const used = randomBytes(32).toString("hex");
  await sql(
    `INSERT INTO "MagicLink" (id, email, "tokenHash", "nextPath", "expiresAt", "consumedAt", "createdAt")
     VALUES ($1, $2, $3, $4, now() + interval '10 minutes', now() - interval '20 minutes', now() - interval '30 minutes')`,
    [
      randomUUID(),
      "used@example.test",
      createHash("sha256").update(used).digest("hex"),
      `/e/${slug}/status`,
    ],
  );
  await page.goto(`/auth/verify?token=${used}`);
  await expect(page.getByText("That link expired.")).toBeVisible();
});

test("a link used twice inside the grace window still signs in", async ({ page }) => {
  const email = `${uid("replay")}@example.test`;
  const token = randomBytes(32).toString("hex");
  await sql(
    `INSERT INTO "MagicLink" (id, email, "tokenHash", "nextPath", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, '/', now() + interval '20 minutes', now() - interval '2 minutes')`,
    [randomUUID(), email, createHash("sha256").update(token).digest("hex")],
  );
  await page.goto(`/auth/verify?token=${token}`);
  await page.waitForURL("**/");
  await page.context().clearCookies();
  await page.goto(`/auth/verify?token=${token}`);
  await page.waitForURL("**/");
  await expect(page.getByRole("heading", { name: /Attend/ })).toBeVisible();
});

test("a next path off this site is dropped", async ({ page }) => {
  const email = `${uid("redirect")}@example.test`;
  const token = randomBytes(32).toString("hex");
  await sql(
    `INSERT INTO "MagicLink" (id, email, "tokenHash", "nextPath", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, now() + interval '20 minutes', now() - interval '2 minutes')`,
    [
      randomUUID(),
      email,
      createHash("sha256").update(token).digest("hex"),
      "https://evil.example/phish",
    ],
  );
  await page.goto(`/auth/verify?token=${token}`);
  await page.waitForURL("**/");
  expect(page.url()).not.toContain("evil.example");
});

test("a forged cookie and a non-admin never reach manage", async ({ page, browser }) => {
  const event = liveEvent({ guests: [guest(`${uid("guest")}@example.test`)] });
  await signIn(page, ADMIN_EMAIL, "/admin");
  await importEvent(page, event);

  const stranger = await browser.newContext();
  await stranger.addCookies([
    {
      name: COOKIE,
      value: sessionCookie(ADMIN_EMAIL, "wrong-secret-wrong-secret-wrong-secret"),
      url: APP_URL,
    },
  ]);
  const forged = await stranger.newPage();
  await forged.goto("/admin");
  await forged.waitForURL(/\/signin/);
  expect(forged.url()).not.toContain("/admin/e/");
  await stranger.close();

  const guestPage = await browser.newPage();
  await ownIp(guestPage);
  await guestPage.context().addCookies([
    { name: COOKIE, value: sessionCookie(`${uid("nobody")}@example.test`), url: APP_URL },
  ]);
  await guestPage.goto("/admin");
  await guestPage.waitForURL("**/admin/pending");
  await expect(guestPage.getByRole("heading", { name: "Not a host yet." })).toBeVisible();
  await expect(guestPage.getByRole("link", { name: event.name })).toHaveCount(0);
  await guestPage.close();
});

test("the host door on the home page signs a host into manage", async ({ page, browser }) => {
  const email = `${uid("door")}@example.test`;
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in to manage it →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Organizer sign in." })).toBeVisible();
  await page.getByLabel("Your organizer email").fill(email);
  await page.getByRole("button", { name: "Send me a verification link" }).click();
  await page.waitForURL("**/check-email**");

  await page.goto(await linkFromMail(email));
  await page.waitForURL("**/admin/pending");
  await expect(page.getByRole("heading", { name: "Not a host yet." })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign in to manage it/ })).toHaveCount(0);

  const admin = await browser.newPage();
  await ownIp(admin);
  await signIn(admin, ADMIN_EMAIL, "/admin");
  await admin.getByText("Hosts", { exact: true }).first().click();
  await admin.getByLabel("Host email").fill(email);
  await admin.getByRole("button", { name: "Invite host" }).click();
  await expect(admin.getByText(`Invited ${email}.`)).toBeVisible();
  await admin.close();

  await page.reload();
  await page.waitForURL("**/admin");
  await expect(page.getByRole("heading", { name: "Your events." })).toBeVisible();
});

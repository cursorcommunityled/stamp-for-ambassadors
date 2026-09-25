import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, closeDb, importEvent, liveEvent, ownIp, signIn } from "../helpers";

test.afterAll(closeDb);

test("the event page is usable on a phone, including dark mode", async ({ page, browser }) => {
  const event = liveEvent({ name: "Phone Night" });
  const admin = await browser.newPage();
  await signIn(admin, ADMIN_EMAIL, "/admin");
  const slug = await importEvent(admin, event);
  await admin.close();

  await ownIp(page);
  await page.goto(`/e/${slug}`);
  await expect(page.getByRole("heading", { name: "Phone Night" })).toBeVisible();
  await expect(page.getByLabel("Email on the ticket")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send me a verification link" })).toBeVisible();

  const box = await page.getByLabel("Email on the ticket").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

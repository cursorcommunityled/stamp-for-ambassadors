/**
 * Regenerates the PNGs in docs/images/ from the local preview fixture.
 * Needs `npm run dev` on :3002 and a seeded database.
 *
 *   npx tsx preview.ts
 *   npx tsx docs/capture-screenshots.ts
 */
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { adminEmails, createMagicLink } from "../src/lib/auth";
import { db } from "../src/lib/db";

const ORIGIN = "http://localhost:3002";
const OUT = new URL("./images/", import.meta.url);
const VIEWPORT = { width: 1280, height: 860 };

async function shot(
  page: import("playwright").Page,
  path: string,
  file: string,
) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: new URL(file, OUT).pathname,
    animations: "disabled",
  });
}

/** Live city nights stay off the public landing still. */
async function hideLiveHome(page: import("playwright").Page) {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important }",
  });
  await page.evaluate(() => {
    document.getElementById("events")?.remove();
    for (const p of [...document.querySelectorAll("p")]) {
      if (p.textContent?.trim() === "No events yet.") {
        p.closest("div")?.remove();
      }
    }
    const cta = document.querySelector(".home-hero-copy a");
    if (cta instanceof HTMLAnchorElement) {
      cta.textContent = "Open Build with Cursor";
      cta.href = "/e/preview";
    }
  });
}

/** Live city nights and host emails stay off the playbook stills. */
async function hideCityNights(page: import("playwright").Page) {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important }",
  });
  await page.evaluate(() => {
    for (const p of [...document.querySelectorAll("p.eyebrow")]) {
      const label = p.textContent?.replace(/\s+/g, " ").trim();
      if (label === "Upcoming" || label === "Past" || label === "Past events") {
        (p.closest("section") ?? p.parentElement)?.remove();
      }
    }
    document.querySelector('select[name="hostEmail"]')?.closest("div")?.remove();

    const hasEmpty = [...document.querySelectorAll("p")].some(
      (p) => p.textContent?.trim() === "No events yet.",
    );
    const setup = [...document.querySelectorAll("p.eyebrow")].find(
      (p) => p.textContent?.replace(/\s+/g, " ").trim() === "Setup",
    );
    const setupWrap = setup?.parentElement;
    if (!hasEmpty && setupWrap) {
      const empty = document.createElement("p");
      empty.className = "mt-14 text-sm text-mute";
      empty.textContent = "No events yet.";
      setupWrap.parentElement?.insertBefore(empty, setupWrap);
    }
  });
}

async function main() {
  await mkdir(new URL(".", OUT), { recursive: true });

  const event = await db.event.findUnique({ where: { slug: "preview" } });
  if (!event) {
    throw new Error("Run `npx tsx preview.ts` first.");
  }

  if (!event.votingOpenedAt) {
    await db.event.update({
      where: { id: event.id },
      data: { votingOpenedAt: new Date(), votingClosedAt: null },
    });
  }

  const admin = adminEmails()[0];
  if (!admin) throw new Error("ADMIN_EMAILS is empty.");

  const adminUrl = await createMagicLink(admin, "/admin", 6 * 3600_000);
  const stampedUrl = await createMagicLink(
    "stamped@preview.invalid",
    "/e/preview/status",
    6 * 3600_000,
  );
  const voteUrl = await createMagicLink(
    "stamped@preview.invalid",
    "/e/preview/status?view=voting",
    6 * 3600_000,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });

  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  await hideLiveHome(page);
  await page.locator(".ink-field-canvas").waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: new URL("attendee-home.png", OUT).pathname,
    animations: "disabled",
  });

  await shot(page, "/e/preview", "attendee-event.png");

  await page.goto(`${ORIGIN}/signin?next=/admin`, { waitUntil: "networkidle" });
  await page.locator('input[name="email"]').fill("you@example.com");
  await page.screenshot({
    path: new URL("admin-signin.png", OUT).pathname,
    animations: "disabled",
  });

  await page.goto(stampedUrl, { waitUntil: "networkidle" });
  await page.screenshot({
    path: new URL("attendee-status.png", OUT).pathname,
    animations: "disabled",
    fullPage: true,
  });
  await page.goto(voteUrl, { waitUntil: "networkidle" });
  await page.screenshot({
    path: new URL("attendee-vote.png", OUT).pathname,
    animations: "disabled",
    fullPage: true,
  });

  await page.goto(adminUrl, { waitUntil: "networkidle" });
  await hideCityNights(page);
  await page.screenshot({
    path: new URL("admin-home.png", OUT).pathname,
    animations: "disabled",
  });

  const newEvent = page.locator("details.fold", { hasText: "New event" });
  await newEvent.locator("summary").click();
  await page.locator('input[name="lumaEventId"]').fill("https://luma.com/build-with-cursor");
  await page.waitForTimeout(200);
  await page.screenshot({
    path: new URL("admin-import.png", OUT).pathname,
    animations: "disabled",
    fullPage: true,
  });

  await page.goto(`${ORIGIN}/admin/e/preview`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: new URL("admin-event.png", OUT).pathname,
    animations: "disabled",
  });

  await page.goto(`${ORIGIN}/admin/e/preview/vote`, {
    waitUntil: "networkidle",
  });
  await page.screenshot({
    path: new URL("admin-vote.png", OUT).pathname,
    animations: "disabled",
    fullPage: true,
  });

  await browser.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

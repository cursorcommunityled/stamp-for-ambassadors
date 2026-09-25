/**
 * Records docs/images/walkthrough.webm.
 *
 * Host: import, upload codes, hold on the pool.
 * Guest: log in — locked until the door scan, then credits.
 * Host: open mic. Guest: vote. Host: late team, close.
 *
 * Needs `npm run dev` and `npx tsx preview.ts`. Resets the fixture's codes,
 * projects, and ballot so the clicks are real. Run stills *before* this if
 * you want both from the same seed.
 */
import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const execFileAsync = promisify(execFile);
import { adminEmails, createMagicLink } from "../src/lib/auth";
import { db } from "../src/lib/db";
const ORIGIN = "http://localhost:3002";
const OUT = new URL("./images/", import.meta.url);
const PAPER = "#efeee9";
const INK = "#2a2a28";

async function hold(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

function titleHtml(eyebrow: string, title: string, line: string) {
  // System fonts only. A Google Fonts stylesheet arriving mid-card is what
  // flipped the paper from cool gray to warm in the first second.
  return `<!doctype html>
<html style="background:${PAPER};color-scheme:only light">
  <head>
    <meta charset="utf-8">
    <style>
      html,body{margin:0;height:100%;background:${PAPER};color:${INK}}
      body{
        display:flex;flex-direction:column;justify-content:center;
        padding:0 5.5rem;
        font-family:ui-sans-serif,system-ui,sans-serif;
      }
      .eyebrow{margin:0;font-size:11px;letter-spacing:.2em;text-transform:uppercase;opacity:.4}
      h1{margin:16px 0 0;font-size:58px;font-weight:400;letter-spacing:-.035em;line-height:1.02}
      .line{margin:20px 0 0;max-width:26rem;font-size:18px;line-height:1.5;opacity:.58}
    </style>
  </head>
  <body>
    <p class="eyebrow">${eyebrow}</p>
    <h1>${title}</h1>
    <p class="line">${line}</p>
  </body>
</html>`;
}

async function titleCard(
  page: Page,
  eyebrow: string,
  title: string,
  line: string,
  holdMs = 2200,
) {
  // One navigation off localhost. setContent kept the previous URL and
  // about:blank is white — both showed up as a two-color open.
  await page.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(titleHtml(eyebrow, title, line))}`,
    { waitUntil: "domcontentloaded" },
  );
  await hold(page, holdMs);
}

/** New-page frames are the wrong color. Cut them; -c copy seeks to a keyframe. */
async function dropLeadIn(webm: string) {
  const ffmpeg = `${homedir()}/Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac`;
  const tmp = `${webm}.cut.webm`;
  await execFileAsync(ffmpeg, [
    "-y",
    "-i",
    webm,
    "-ss",
    "0.80",
    "-c:v",
    "libvpx",
    "-b:v",
    "1800k",
    "-deadline",
    "good",
    "-cpu-used",
    "2",
    "-an",
    tmp,
  ]);
  await rename(tmp, webm);
}

async function mark(page: Page, side: "guest" | "host") {
  await page.evaluate((side) => {
    document.getElementById("stamp-walk-mark")?.remove();
    const el = document.createElement("div");
    el.id = "stamp-walk-mark";
    el.textContent = side === "guest" ? "Guest" : "Host";
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:22px",
      "transform:translateX(-50%)",
      "z-index:99999",
      "padding:7px 14px",
      "background:#2a2a28",
      "color:#efeee9",
      "font:12px/1 Inter,ui-sans-serif,system-ui,sans-serif",
      "letter-spacing:.08em",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(el);
  }, side);
}

async function hideOverlay(page: Page) {
  await page
    .addStyleTag({
      content: "nextjs-portal { display: none !important }",
    })
    .catch(() => undefined);
}

async function pageCrashed(page: Page) {
  return page
    .getByText(/This page couldn.t load/i)
    .isVisible()
    .catch(() => false);
}

async function enter(
  page: Page,
  url: string,
  side: "guest" | "host",
  ready?: string | RegExp,
) {
  // networkidle never settles on `next dev` (HMR websocket). Wait for the
  // heading we actually need, and retry once if Next painted its crash UI.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await hideOverlay(page);
  if (await pageCrashed(page)) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await hideOverlay(page);
  }
  if (ready) {
    await page.getByRole("heading", { name: ready }).waitFor({
      timeout: 20_000,
    });
  }
  if (await pageCrashed(page)) {
    throw new Error(`Next crash UI on ${url}`);
  }
  await mark(page, side);
}

async function hostLink(nextPath: string) {
  const admin = adminEmails()[0];
  if (!admin) throw new Error("ADMIN_EMAILS is empty.");
  return createMagicLink(admin, nextPath, 6 * 3600_000);
}

async function typeInto(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  text: string,
  delay = 42,
) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(text, { delay });
}

async function hideCityNights(page: Page) {
  await page.evaluate(() => {
    for (const p of [...document.querySelectorAll("p.eyebrow")]) {
      const label = p.textContent?.replace(/\s+/g, " ").trim();
      if (label === "Upcoming" || label === "Past" || label === "Past events") {
        (p.closest("section") ?? p.parentElement)?.remove();
      }
    }
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

async function addProject(
  page: Page,
  name: string,
  builders: string,
  description?: string,
) {
  const form = page.locator("form").filter({
    has: page.locator('input[name="name"]'),
  });
  await form.scrollIntoViewIfNeeded();
  await hold(page, 500);
  await typeInto(page, form.locator('input[name="name"]'), name);
  await typeInto(page, form.locator('input[name="builders"]'), builders);
  if (description) {
    await typeInto(
      page,
      form.locator('textarea[name="description"]'),
      description,
      28,
    );
  }
  await hold(page, 350);
  await form.getByRole("button", { name: "Add to ballot" }).click();
  await page.getByText(`Added ${name}`).waitFor({ timeout: 15_000 });
  await mark(page, "host");
  await hold(page, 1400);
}

async function resetFixture(eventId: string) {
  await db.project.deleteMany({ where: { eventId } });
  await db.code.deleteMany({ where: { eventId } });
  await db.event.update({
    where: { id: eventId },
    data: { votingOpenedAt: null, votingClosedAt: null },
  });
}

async function main() {
  await mkdir(new URL(".", OUT), { recursive: true });

  const event = await db.event.findUnique({ where: { slug: "preview" } });
  if (!event) throw new Error("Run `npx tsx preview.ts` first.");
  await resetFixture(event.id);

  const adminHomeUrl = await hostLink("/admin");
  const guestWaitingUrl = await createMagicLink(
    "waiting@preview.invalid",
    "/e/preview/status",
    6 * 3600_000,
  );
  const guestStatusUrl = await createMagicLink(
    "stamped@preview.invalid",
    "/e/preview/status",
    6 * 3600_000,
  );
  const guestVoteUrl = await createMagicLink(
    "stamped@preview.invalid",
    "/e/preview/status?view=voting",
    6 * 3600_000,
  );

  const tmp = new URL("./.walkthrough/", import.meta.url);
  await mkdir(tmp, { recursive: true });
  const csv = new URL("./codes.csv", tmp);
  await writeFile(
    csv,
    [
      "code",
      "CURSOR-BERLIN-001",
      "CURSOR-BERLIN-002",
      "CURSOR-BERLIN-003",
      "CURSOR-BERLIN-004",
      "CURSOR-BERLIN-005",
      "CURSOR-BERLIN-006",
      "",
    ].join("\n"),
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    colorScheme: "light",
    recordVideo: { dir: tmp.pathname, size: { width: 1280, height: 860 } },
  });
  const page = await context.newPage();

  await titleCard(
    page,
    "Stamp",
    "The build night, handled.",
    "Import the Luma event. Load the codes. Run the mic.",
    3200,
  );

  await titleCard(
    page,
    "You",
    "Sign in.",
    "A link to the inbox you were invited with. No password.",
  );

  await enter(page, `${ORIGIN}/signin?next=/admin`, "host", "Organizer sign in.");
  await typeInto(page, page.locator('input[name="email"]'), "you@example.com");
  await hold(page, 1600);

  await enter(page, adminHomeUrl, "host", /Events\.|Your events\./);
  await hideCityNights(page);
  await mark(page, "host");
  await hold(page, 1400);

  const newEvent = page.locator("details.fold", { hasText: "New event" });
  await newEvent.locator("summary").click();
  await hold(page, 500);
  await typeInto(
    page,
    page.locator('input[name="lumaEventId"]'),
    "https://luma.com/build-with-cursor",
  );
  await hold(page, 1800);

  await titleCard(
    page,
    "You",
    "It's in.",
    "Title, time, place, cover, from Luma. Now the codes.",
  );

  await enter(page, `${ORIGIN}/admin/e/preview`, "host", "Build with Cursor");
  await hold(page, 1600);
  await page.getByText("Nothing uploaded yet.").scrollIntoViewIfNeeded();
  await hold(page, 800);
  await page.locator('input[name="file"]').setInputFiles(fileURLToPath(csv));
  await hold(page, 700);
  await page.getByRole("button", { name: "Upload CSV" }).click();
  await page.getByText("Nothing uploaded yet.").waitFor({
    state: "hidden",
    timeout: 20_000,
  });
  await mark(page, "host");
  await hold(page, 1200);
  await page.getByRole("heading", { name: "Cursor", exact: true }).scrollIntoViewIfNeeded();
  await hold(page, 1400);
  await page.evaluate(() => window.scrollBy({ top: 320, behavior: "smooth" }));
  await hold(page, 2000);

  await titleCard(
    page,
    "The door",
    "Credits are in.",
    "Guests sign in with their Luma email. The pool stays locked until you scan them. That's who showed up, and who can claim.",
  );

  await db.code.updateMany({
    where: { eventId: event.id, claimedByAttendeeId: { not: null } },
    data: { claimedByAttendeeId: null, claimedAt: null },
  });
  await db.eventAttendee.updateMany({
    where: { eventId: event.id },
    data: { creditsAssignedAt: null, notifiedAt: null },
  });

  await context.clearCookies();
  await enter(page, `${ORIGIN}/e/preview`, "guest", "Build with Cursor");
  await typeInto(
    page,
    page.locator('input[name="email"]'),
    "stefan@example.com",
  );
  await hold(page, 1600);

  await enter(page, guestWaitingUrl, "guest", "Not yet.");
  await hold(page, 2400);

  await db.code.updateMany({
    where: { eventId: event.id, claimedByAttendeeId: { not: null } },
    data: { claimedByAttendeeId: null, claimedAt: null },
  });
  await db.eventAttendee.updateMany({
    where: { eventId: event.id },
    data: { creditsAssignedAt: null, notifiedAt: null },
  });

  await enter(page, guestStatusUrl, "guest", /you're stamped/);
  await hold(page, 2000);
  const claim = page
    .locator("li.credit")
    .filter({ hasText: "Cursor" })
    .getByRole("button", { name: "Claim" });
  if (await claim.count()) {
    await claim.click();
    await page.getByText(/Claim your credits|CURSOR-BERLIN/).waitFor({
      timeout: 15_000,
    });
  }
  await mark(page, "guest");
  await hold(page, 1600);

  await titleCard(
    page,
    "Open mic",
    "Type them in as they present.",
    "Then open the vote. Late teams can still go on the ballot.",
  );

  await enter(
    page,
    await hostLink("/admin/e/preview/vote"),
    "host",
    "Not open yet.",
  );
  await hold(page, 1000);
  await addProject(
    page,
    "Grant finder",
    "Ana & Marko",
    "Matches you to public grants from a short form.",
  );
  await addProject(page, "Door list", "Lea K.");
  await page.getByRole("heading", { name: "On the ballot" }).scrollIntoViewIfNeeded();
  await hold(page, 1600);
  await page.getByRole("button", { name: "Open voting" }).scrollIntoViewIfNeeded();
  await hold(page, 500);
  await page.getByRole("button", { name: "Open voting" }).click();
  await page.getByRole("heading", { name: "Voting is open." }).waitFor({
    timeout: 15_000,
  });
  await mark(page, "host");
  await hold(page, 1800);

  await titleCard(
    page,
    "Guests",
    "The room votes.",
    "One tap. They can move it until you close.",
  );

  await enter(page, guestVoteUrl, "guest", /you're stamped/);
  await hold(page, 1800);
  await page.getByRole("button", { name: "Vote" }).first().click();
  await page.getByText("Your vote").waitFor({ timeout: 15_000 });
  await mark(page, "guest");
  await hold(page, 2000);

  await titleCard(
    page,
    "You",
    "Still live.",
    "A late team still goes on. Then you close.",
  );

  await enter(
    page,
    await hostLink("/admin/e/preview/vote"),
    "host",
    "Voting is open.",
  );
  await hold(page, 1400);
  await addProject(page, "Demo clock", "Nik & Sofi");
  await page.getByRole("heading", { name: "On the ballot" }).scrollIntoViewIfNeeded();
  await hold(page, 1800);
  await page.getByRole("button", { name: "Close voting" }).scrollIntoViewIfNeeded();
  await hold(page, 500);
  await page.getByRole("button", { name: "Close voting" }).click();
  await page.getByRole("heading", { name: "Voting is closed." }).waitFor({
    timeout: 15_000,
  });
  await mark(page, "host");
  await hold(page, 2400);

  await titleCard(
    page,
    "Stamp",
    "That's the build night.",
    "Import. Credits. The mic. One deploy.",
  );

  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const dest = new URL("walkthrough.webm", OUT).pathname;
    const src = await video.path();
    await rename(src, dest);
    await dropLeadIn(dest);
  }
  await rm(tmp, { recursive: true, force: true });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

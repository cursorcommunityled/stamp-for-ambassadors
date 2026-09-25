/**
 * Outbound mail. Resend only from the deployed Render service, and only when
 * the link points at a public origin. Anywhere else the body is printed.
 * A laptop with the live key and the real Luma roster must not mail guests.
 */

import { originIsPublic } from "@/lib/app-url";
import { appName, appTagline } from "@/lib/brand";

/**
 * Render sets `RENDER=true` on the service and nowhere else. The live Resend
 * key also sits in this machine's `.env`, so the key being present is not
 * evidence that anyone should receive mail.
 */
export function maySendMail(): boolean {
  return (
    process.env.RENDER === "true" &&
    originIsPublic() &&
    Boolean(process.env.RESEND_API_KEY?.trim())
  );
}

const PAPER = "#efeee9";
const INK = "#2a2a28";
const MUTE = "#8a8a84";
const LINE = "#dcdbd6";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const URL_ONLY = /^https?:\/\/\S+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The same words as the text part, marked up. A message carrying nothing but
 * plain text and one bare link is shaped exactly like phishing, and a filter
 * that has never seen this domain before has every reason to act on that.
 *
 * Blank entries in `lines` separate paragraphs; a line that is only a URL
 * becomes the button, with the address repeated underneath for anyone whose
 * client will not follow it.
 */
function htmlFrom(lines: string[], cta: string): string {
  const blocks: string[] = [];
  let block: string[] = [];
  for (const line of lines) {
    if (line === "") {
      if (block.length) blocks.push(block.join(" "));
      block = [];
      continue;
    }
    block.push(line);
  }
  if (block.length) blocks.push(block.join(" "));

  const body = blocks
    .map((text) => {
      if (!URL_ONLY.test(text)) {
        return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${INK}">${escapeHtml(text)}</p>`;
      }
      const href = escapeHtml(text);
      return (
        `<p style="margin:0 0 12px"><a href="${href}" style="display:inline-block;background:${INK};color:${PAPER};text-decoration:none;padding:12px 20px;font-size:15px">${escapeHtml(cta)}</a></p>` +
        `<p style="margin:0 0 16px;font-size:12px;line-height:20px;color:${MUTE};word-break:break-all">Or paste this into your browser: ${href}</p>`
      );
    })
    .join("");

  return [
    `<!doctype html><html lang="en"><body style="margin:0;padding:0;background:${PAPER}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER}">`,
    `<tr><td align="center" style="padding:32px 16px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;text-align:left;font-family:${FONT}">`,
    `<tr><td style="padding-bottom:24px;font-size:15px;font-weight:600;letter-spacing:0.02em;color:${INK}">${escapeHtml(appName())}</td></tr>`,
    `<tr><td>${body}</td></tr>`,
    `<tr><td style="padding-top:20px;border-top:1px solid ${LINE};font-size:12px;line-height:20px;color:${MUTE}">${escapeHtml(appTagline())}</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}

async function send(input: {
  email: string;
  subject: string;
  lines: string[];
  cta: string;
  logLabel: string;
}) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? `${appName()} <stamp@localhost>`;
  const text = input.lines.join("\n");

  // Not deployed, or deployed without a public origin and a key. Printing is
  // how a laptop signs someone in. A Render service that lands here has to
  // fail out loud: reporting success while writing to a log leaves a room
  // full of people waiting on mail that was never posted.
  if (!maySendMail()) {
    if (process.env.RENDER === "true") {
      throw new Error(
        !key
          ? "RESEND_API_KEY is not set. Mail would go to the log instead of the guest."
          : "APP_URL points at localhost. Mail would go out with a link nobody can open.",
      );
    }
    console.log(`\n[stamp] ${input.logLabel} for ${input.email} (not sent):\n${text}\n`);
    // The test suite reads sign-in links from here instead of a terminal.
    const outbox = process.env.MAIL_OUTBOX?.trim();
    if (outbox) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(
        outbox,
        `${JSON.stringify({ to: input.email, subject: input.subject, text })}\n`,
      );
    }
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: input.subject,
      text,
      html: htmlFrom(input.lines, input.cta),
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Could not send mail to ${input.email}. ${body.slice(0, 200)}`);
  }
}

export async function sendMagicLinkEmail(email: string, url: string) {
  await send({
    email,
    subject: "Your stamp link",
    logLabel: "Magic link",
    cta: `Open ${appName()}`,
    lines: [
      "Open this link to prove you own this email. It expires in 20 minutes.",
      "",
      url,
      "",
      "If you didn't ask for this, ignore it.",
    ],
  });
}

/**
 * Sent to the admins when Luma names someone a host. The queue on `/admin`
 * is the only other place this shows up, and nobody refreshes a page on the
 * chance that something has appeared on it, so without this a host can sit
 * locked out of a night they are supposed to be running.
 *
 * A plain link rather than a magic link: an admin already knows how to sign
 * in, and there is no reason to put working credentials in a message whose
 * whole subject is someone asking for access.
 */
export async function sendHostPendingEmail(input: {
  email: string;
  hostEmails: string[];
  eventName: string;
  url: string;
}) {
  const count = input.hostEmails.length;
  const many = count > 1;
  await send({
    email: input.email,
    subject: many
      ? `${count} hosts need approval for ${input.eventName}`
      : `A host needs approval for ${input.eventName}`,
    logLabel: "Host approval",
    cta: `Review on ${appName()}`,
    lines: [
      many
        ? `Luma lists ${count} new hosts on ${input.eventName}.`
        : `Luma lists a new host on ${input.eventName}.`,
      "",
      input.hostEmails.join(", "),
      "",
      many
        ? "None of them can manage anything until you confirm them under Pending hosts."
        : "They cannot manage anything until you confirm them under Pending hosts.",
      "",
      input.url,
      "",
      "Luma says who is named on a night, not who may run it. Confirm only the people who should.",
    ],
  });
}

/**
 * Sent the moment the door scan lands, so the attendee never has to work out
 * that this app exists or go looking for their codes.
 */
export async function sendCreditsReadyEmail(input: {
  email: string;
  url: string;
  eventName: string;
  codeCount: number;
}) {
  const noun = input.codeCount === 1 ? "credit is" : "credits are";
  await send({
    email: input.email,
    subject: `Your ${input.eventName} credits are ready`,
    logLabel: "Credits ready",
    cta: "See your credits",
    lines: [
      `You're checked in at ${input.eventName}.`,
      "",
      `Your ${input.codeCount} partner ${noun} waiting.`,
      "Open this link to see them. No sign-in needed, it already knows it's you.",
      "",
      input.url,
      "",
      "Now go build something.",
    ],
  });
}

/** One message to the admin who pressed the button, so they can see mail arrive. */
export async function sendTestEmail(email: string, url: string) {
  await send({
    email,
    subject: `${appName()} mail test`,
    logLabel: "Mail test",
    cta: `Open ${appName()}`,
    lines: [
      "This is a test from your Stamp setup.",
      "If you are reading it, sign-in links will reach the room.",
      "",
      url,
    ],
  });
}

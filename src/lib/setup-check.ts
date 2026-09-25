import { originIsPublic } from "@/lib/app-url";
import { isAdminEmail } from "@/lib/auth";
import { pingLuma, LumaError } from "@/lib/luma";
import { maySendMail } from "@/lib/mail";
import { rejectWeakSecret } from "@/lib/session";

export type Check = { label: string; ok: boolean; detail: string };

function originsMatch(): boolean {
  const app = process.env.APP_URL?.trim().replace(/\/$/, "");
  const render = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, "");
  if (!app || !render) return true;
  return app === render;
}

export function appUrlCheck(): Check {
  if (!originIsPublic()) {
    return {
      label: "Public address",
      ok: false,
      detail:
        "APP_URL is missing or points at this computer. Set it to the site's public address, or leave it empty on Render so the service address is used.",
    };
  }
  if (!originsMatch()) {
    return {
      label: "Public address",
      ok: false,
      detail: "APP_URL does not match this service's address. Links in mail will go to the wrong place.",
    };
  }
  return {
    label: "Public address",
    ok: true,
    detail: "Mail links will open on the public site.",
  };
}

export function secretCheck(): Check {
  const value = process.env.AUTH_SECRET ?? "";
  try {
    rejectWeakSecret(value);
    return {
      label: "Session secret",
      ok: true,
      detail: "AUTH_SECRET is long enough to sign sessions.",
    };
  } catch (error) {
    return {
      label: "Session secret",
      ok: false,
      detail: error instanceof Error ? error.message : "AUTH_SECRET is not usable.",
    };
  }
}

export function adminCheck(email: string): Check {
  if (isAdminEmail(email)) {
    return {
      label: "Your admin access",
      ok: true,
      detail: `${email} is in ADMIN_EMAILS.`,
    };
  }
  return {
    label: "Your admin access",
    ok: false,
    detail: `${email} is not in ADMIN_EMAILS. Add it, or the next deploy will lock you out.`,
  };
}

export function mailCheck(): Check {
  const key = Boolean(process.env.RESEND_API_KEY?.trim());
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) {
    return {
      label: "Mail",
      ok: false,
      detail: !key
        ? "RESEND_API_KEY is not set, so sign-in links are only printed to the log."
        : "EMAIL_FROM is not set. Resend needs a from-address on a domain you have verified.",
    };
  }
  if (!maySendMail()) {
    return {
      label: "Mail",
      ok: false,
      detail:
        "The Resend key and from-address are set, but mail is only sent from the Render service with a public address.",
    };
  }
  return {
    label: "Mail",
    ok: true,
    detail: `Sign-in mail sends from ${from}.`,
  };
}

const LUMA_TTL_MS = 5 * 60 * 1000;
let lumaCache: { at: number; check: Check } | null = null;

/** Cached so opening the admin page does not spend a Luma call every time. */
export async function lumaCheck(): Promise<Check> {
  if (lumaCache && Date.now() - lumaCache.at < LUMA_TTL_MS) return lumaCache.check;

  let check: Check;
  try {
    await pingLuma();
    check = {
      label: "Luma",
      ok: true,
      detail: "The calendar key was accepted.",
    };
  } catch (error) {
    check = {
      label: "Luma",
      ok: false,
      detail:
        error instanceof LumaError
          ? error.message
          : "Could not reach Luma. Try again in a moment.",
    };
  }
  if (check.ok) lumaCache = { at: Date.now(), check };
  return check;
}

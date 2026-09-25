/**
 * Where this instance lives. Read here rather than in each caller, because
 * the four places that used to resolve it had drifted into slightly different
 * rules, and one of them decides whether a magic link works at all.
 *
 * Blank counts as absent. A Render blueprint form that asks for APP_URL and
 * is left empty hands us "", which would otherwise beat the fallback Render
 * fills in for us and take sign-in down on a variable nobody meant to set.
 */
function configuredOrigin(): string | undefined {
  return [process.env.APP_URL, process.env.RENDER_EXTERNAL_URL]
    .map((value) => value?.trim())
    .find(Boolean)
    ?.replace(/\/$/, "");
}

function isLoopback(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return true;
  }
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Strict. Getting this wrong in production is silent and total: the mail goes
 * out, the link points at localhost, and nobody can sign in. So a deployed
 * instance has to say where it lives, and that place has to be one a phone
 * can open.
 */
export function appOrigin(): string {
  const configured = configuredOrigin();
  if (process.env.NODE_ENV === "production" && (!configured || isLoopback(configured))) {
    throw new Error(
      "APP_URL must be the public origin. Magic links would point at localhost.",
    );
  }
  if (configured) return configured;
  return "http://localhost:3002";
}

/**
 * Whether a link built from `appOrigin()` works for someone who is not sitting
 * at this machine. The local database holds the real Luma roster, and the
 * Resend key in `.env` is the live one, so this is what decides whether a
 * message is allowed to reach a registered address.
 */
export function originIsPublic(): boolean {
  const configured = configuredOrigin();
  return configured !== undefined && !isLoopback(configured);
}

/**
 * Lenient. For absolute URLs in metadata and share images, where a localhost
 * fallback renders a wrong preview and throwing renders no page at all.
 */
export function publicOrigin(): string {
  return configuredOrigin() ?? "http://localhost:3002";
}

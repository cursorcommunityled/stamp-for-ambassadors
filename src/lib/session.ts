import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "stamp_ambassadors_session";
/**
 * The community meets monthly, so a week-long session made every regular
 * re-verify their inbox for nothing. Ninety days spans several events.
 */
const SESSION_SECONDS = 60 * 60 * 24 * 90;

type SessionPayload = {
  email: string;
  exp: number;
};

const MIN_SECRET_LENGTH = 32;

const PLACEHOLDERS = [
  "change-me",
  "changeme",
  "secret",
  "test",
  "password",
  "replace-me",
  "replaceme",
  "your-secret-here",
  "todo",
  "xxx",
];

const GENERATE = "Generate one with: openssl rand -hex 32";

/**
 * A guessable secret is total. Admin is decided purely by the email inside
 * the session cookie, so anyone who can guess this can mint a cookie that
 * says they are the admin, and nothing else in the app would notice.
 *
 * Worse, it fails quietly: a deploy with AUTH_SECRET="changeme" works
 * perfectly for everyone who uses it normally. So the check lives on the path
 * a real value cannot be avoided on, rather than in a setup script someone
 * copying this for their own city would skip.
 */
export function rejectWeakSecret(value: string): void {
  const normalized = value.trim().toLowerCase();

  if (PLACEHOLDERS.includes(normalized)) {
    throw new Error(`AUTH_SECRET is still a placeholder. ${GENERATE}`);
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters. ${GENERATE}`,
    );
  }
  // A long run of one repeated character passes a length check with almost no
  // entropy behind it.
  if (new Set(normalized).size < 8) {
    throw new Error(
      `AUTH_SECRET has too little variety to be random. ${GENERATE}`,
    );
  }
}

/** The value `rejectWeakSecret` has already passed, so it runs once. */
let checked: string | undefined;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error(
      "AUTH_SECRET is not set. Copy .env.example to .env and generate one.",
    );
  }
  // Only in production. Locally a short secret is somebody trying the app out
  // for the first time, and refusing to run over it teaches them nothing.
  if (process.env.NODE_ENV === "production" && checked !== value) {
    rejectWeakSecret(value);
    checked = value;
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function encode(session: SessionPayload): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(token: string): SessionPayload | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (
      typeof session.email !== "string" ||
      typeof session.exp !== "number" ||
      session.exp * 1000 < Date.now()
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<{ email: string } | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const session = decode(token);
  if (!session) return null;
  return { email: session.email };
}

export async function createSession(email: string) {
  const jar = await cookies();
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  jar.set(COOKIE, encode({ email, exp }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

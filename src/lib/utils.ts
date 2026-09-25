import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "event";
}

export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) return base;
  let n = 2;
  while (await exists(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  const head = user.slice(0, 2);
  return `${head}${"•".repeat(Math.max(3, user.length - 2))}@${domain}`;
}

/**
 * Where a guest lands after following their link, so it has to stay on this
 * site. "//host", "/\host", and percent-encoded spellings of both read as
 * absolute URLs to one browser or another, which would turn sign-in into a way
 * to bounce people somewhere else. Only a plain path gets through.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (value === "/") return "/";
  if (!/^\/[a-z0-9._~-]/i.test(value)) return "/";
  return value;
}

export function eventPathFromNext(nextPath: string): string | null {
  const match = nextPath.match(/^\/e\/([^/?#]+)/);
  return match ? `/e/${match[1]}` : null;
}

/** The host door: the organizer form, whose link opens manage. */
export const HOST_SIGN_IN_PATH = "/signin?next=%2Fadmin";

export function expiredLinkPath(nextPath?: string | null): string {
  const next = safeNextPath(nextPath);
  const eventPath = eventPathFromNext(next);
  if (eventPath) return `${eventPath}?error=expired`;
  if (next.startsWith("/admin")) return `${HOST_SIGN_IN_PATH}&error=expired`;
  return "/?error=expired";
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/app-url";
import { ClaimError, claimCode } from "@/lib/claim";
import { db } from "@/lib/db";
import { hasEnded } from "@/lib/events";
import { callerIp, check, LIMITS } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  eventSlug: z.string().min(1),
  sponsor: z.string().min(1),
});

/**
 * Defence in depth. The session cookie is `sameSite: lax`, which already
 * withholds it from a cross-site POST, so this is the second lock rather than
 * the first. A request with no `Origin` at all is allowed through: curl and
 * some older clients send none, and the cookie rule still covers the browser
 * case this is aimed at.
 */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(appOrigin()).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { error: "bad_origin", message: "That request did not come from Stamp." },
      { status: 403 },
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in with your email first." },
      { status: 401 },
    );
  }

  // Per email first, because that is the key an abuser has to buy another of.
  // The per-IP key is a whole venue on one wifi, so it is set only to catch a
  // script and must never be the thing that stops a room from claiming.
  for (const [key, limit] of [
    [`claim:email:${session.email}`, LIMITS.claimPerEmail],
    [`claim:ip:${callerIp(request.headers)}`, LIMITS.claimPerIp],
  ] as const) {
    const quota = await check(key, limit);
    if (!quota.ok) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many tries. Give it a moment." },
        { status: 429, headers: { "Retry-After": String(quota.retryAfter) } },
      );
    }
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", message: "Missing event or sponsor." },
      { status: 400 },
    );
  }

  const event = await db.event.findUnique({
    where: { slug: parsed.data.eventSlug },
    select: {
      id: true,
      lumaEventId: true,
      perksRequireCheckIn: true,
      startAt: true,
      endAt: true,
    },
  });
  if (!event) {
    return NextResponse.json(
      { error: "not_found", message: "That event is not here." },
      { status: 404 },
    );
  }
  if (hasEnded(event)) {
    return NextResponse.json(
      { error: "ended", message: "Credits closed with the doors." },
      { status: 403 },
    );
  }

  try {
    const result = await claimCode({
      eventId: event.id,
      lumaEventId: event.lumaEventId,
      perksRequireCheckIn: event.perksRequireCheckIn,
      email: session.email,
      sponsorSlug: parsed.data.sponsor,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ClaimError) {
      const status =
        error.code === "unauthenticated"
          ? 401
          : error.code === "out_of_codes"
            ? 409
            : error.code === "unknown_sponsor"
              ? 400
              : 403;
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status },
      );
    }
    throw error;
  }
}

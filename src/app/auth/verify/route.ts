import { redirect } from "next/navigation";
import { consumeMagicLink, inspectMagicLink, isOrganizerEmail } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { expiredLinkPath, safeNextPath } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Next answers HEAD by running GET, and link checkers in mail security products
 * reach every URL in a message before the guest ever sees it. Without this, a
 * scanner testing the link is what spends it.
 */
export async function HEAD() {
  return new Response(null, { status: 200 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await consumeMagicLink(token);

  if (!result) {
    const peek = await inspectMagicLink(token);
    redirect(expiredLinkPath(peek?.nextPath));
  }

  await createSession(result.email);

  const next = safeNextPath(result.nextPath);
  // Same form as guests, and the decision is two local reads. Every person at
  // the door signs in through here, so nothing on this path may call Luma.
  // If they already manage a night and were not heading to a specific event
  // page, open manage.
  if (
    !next.startsWith("/e/") &&
    !next.startsWith("/admin") &&
    (await isOrganizerEmail(result.email))
  ) {
    redirect("/admin");
  }
  redirect(next);
}

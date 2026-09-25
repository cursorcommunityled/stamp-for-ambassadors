import { redirect } from "next/navigation";

/**
 * Voting used to be its own page. It is a panel on the status page now, so
 * crossing to it no longer reloads the heading, the seal and the clock it
 * shares with credits. The route stays as a forward: it is in links already
 * handed out, and the vote action still names it when it revalidates.
 */
export default async function EventVotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/e/${slug}/status?view=voting`);
}

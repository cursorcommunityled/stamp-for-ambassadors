import { notFound, redirect } from "next/navigation";
import { projectCatalog } from "@/lib/catalog";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Old project URLs. The list already holds the name, the pitch, and the count. */
export default async function EventProjectPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug, projectId } = await params;
  const event = await db.event.findUnique({
    where: { slug },
    select: {
      id: true,
      votingOpenedAt: true,
      votingClosedAt: true,
    },
  });
  if (!event) notFound();

  const { rows } = await projectCatalog(event);
  if (!rows.some((row) => row.id === projectId)) notFound();

  redirect(`/e/${slug}/projects`);
}

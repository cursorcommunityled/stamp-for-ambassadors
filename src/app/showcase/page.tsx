import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageIntro } from "@/components/page-intro";
import { ProjectCatalog } from "@/components/project-catalog";
import { pastShowcases } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function ShowcasePage() {
  const nights = await pastShowcases();

  return (
    <AppShell
      breadcrumb={<span>Project showcase</span>}
      creditsNote
    >
      <PageIntro
        eyebrow="Open mic"
        size="page"
        title="Project showcase"
        description={
          nights.length > 0
            ? "What the room built."
            : "A build night lands here once it has a ballot."
        }
      />

      {nights.map((night) => (
        <section key={night.slug} className="mt-16 border-t border-line pt-12">
          <p className="eyebrow">{night.when ?? "Past event"}</p>
          <h2 className="mt-3 font-display text-2xl tracking-heading">
            <Link
              href={`/e/${night.slug}/projects`}
              className="hover:opacity-60"
            >
              {night.name}
            </Link>
          </h2>
          <ProjectCatalog rows={night.rows} closed={night.closed} />
        </section>
      ))}

      <Link
        href="/"
        className="mt-12 inline-block text-sm text-mute hover:text-ink"
      >
        All events →
      </Link>
    </AppShell>
  );
}

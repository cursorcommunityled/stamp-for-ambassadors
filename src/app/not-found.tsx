import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusSeal } from "@/components/status-seal";

export default function NotFound() {
  return (
    <AppShell>
      <div className="flex flex-col items-start justify-between gap-10 md:flex-row">
        <div>
          <p className="eyebrow">404</p>
          <h1 className="mt-4 font-display text-5xl tracking-heading text-ink">
            That page is not here.
          </h1>
          <Link
            href="/"
            className="mt-10 inline-block text-sm text-ink hover:opacity-60"
          >
            Back →
          </Link>
        </div>
        <StatusSeal locked="not_on_list" stamped={false} />
      </div>
    </AppShell>
  );
}

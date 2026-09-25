"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Watches for the door scan so nobody stands there hitting reload.
 *
 * This polls our own database, never Luma. The roster sync behind the page
 * has its own TTL, so a room full of open tabs still costs one Luma call a
 * minute. While someone is waiting, a label is shown. After they are stamped
 * the same pulse keeps running silently so the rest of the room's scans and
 * credit delivery still move even if nobody is left waiting.
 */
export function CheckInWatcher({
  intervalMs = 5000,
  label,
}: {
  intervalMs?: number;
  label?: string | null;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let timeout: number | undefined;

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      setChecking(true);
      router.refresh();
      timeout = window.setTimeout(() => setChecking(false), 700);
    };

    const interval = window.setInterval(tick, intervalMs);
    const kickoff = window.setTimeout(tick, 1500);
    document.addEventListener("visibilitychange", tick);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(kickoff);
      if (timeout) window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);

  if (!label) return null;

  return (
    <p
      className="mt-6 inline-flex items-center gap-2.5 text-[11px] tracking-wide text-mute"
      aria-live="polite"
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-ink transition-opacity duration-500",
          checking ? "opacity-100" : "opacity-25",
        )}
        aria-hidden
      />
      {checking ? "Checking…" : label}
    </p>
  );
}

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Quiet program times for a stamped attendee. Credits are the page;
 * this just sits to the side so people know when building and open mic are.
 */
export function EventClock({
  startAt,
  openMicAt,
  endAt,
  timezone,
  layout = "stack",
  className,
}: {
  startAt: string | null;
  openMicAt: string | null;
  endAt: string | null;
  timezone: string | null;
  layout?: "stack" | "row";
  className?: string;
}) {
  const start = startAt ? Date.parse(startAt) : null;
  const openMic = openMicAt ? Date.parse(openMicAt) : null;
  const end = endAt ? Date.parse(endAt) : null;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  if (start === null && openMic === null) return null;

  const ready = now !== null;
  const buildingUntil = openMic ?? end;
  const building =
    ready && start !== null ? windowPhase(now, start, buildingUntil) : null;
  const mic =
    ready && openMic !== null ? windowPhase(now, openMic, end) : null;

  return (
    <aside
      className={cn(layout === "row" ? "w-full" : "shrink-0 md:w-44", className)}
      aria-label="Event schedule"
    >
      <p className="sr-only">
        {[
          start !== null
            ? `Building starts at ${wallTime(start, timezone)}.`
            : null,
          openMic !== null
            ? `Open mic and voting start at ${wallTime(openMic, timezone)}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")}
      </p>
      <dl
        className={
          layout === "row" ? "flex flex-wrap gap-x-10 gap-y-3" : "flex flex-col gap-3"
        }
      >
        {start !== null ? (
          <Beat
            label="Building"
            when={wallTime(start, timezone)}
            remain={building?.remain ?? 0}
            status={building?.status ?? null}
          />
        ) : null}
        {openMic !== null ? (
          <Beat
            label="Open mic"
            when={wallTime(openMic, timezone)}
            remain={mic?.remain ?? 0}
            status={mic?.status ?? null}
          />
        ) : null}
      </dl>
    </aside>
  );
}

function Beat({
  label,
  when,
  remain,
  status,
}: {
  label: string;
  when: string;
  remain: number;
  status: "upcoming" | "live" | "done" | null;
}) {
  const face =
    status === "live"
      ? "Live"
      : status === "upcoming"
        ? formatRemain(remain)
        : when;

  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={
          status === "live"
            ? "mt-1 font-mono text-xs tabular text-brand"
            : "mt-1 font-mono text-xs tabular text-mute"
        }
        aria-hidden
      >
        {status === null ? when : face}
        {status === "upcoming" || status === "live" ? (
          <span className="text-mute"> · {when}</span>
        ) : null}
      </dd>
    </div>
  );
}

function windowPhase(
  now: number,
  start: number,
  until: number | null,
): { remain: number; status: "upcoming" | "live" | "done" } {
  if (now < start) return { remain: start - now, status: "upcoming" };
  if (until !== null && now >= until) return { remain: 0, status: "done" };
  return { remain: 0, status: "live" };
}

function formatRemain(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

function wallTime(ms: number, timezone: string | null): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || undefined,
  }).format(ms);
}

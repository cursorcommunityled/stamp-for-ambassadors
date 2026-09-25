import Link from "next/link";
import { Plate } from "@/components/plate";
import { eventCover, formatEventWhen, type EventCard } from "@/lib/events";
import { cn } from "@/lib/utils";

export function EventGrid({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  return (
    <ul
      className={cn(
        "mt-8 grid gap-x-8 gap-y-12 sm:grid-cols-2",
        count >= 3 && "lg:grid-cols-3",
      )}
    >
      {children}
    </ul>
  );
}

export function EventChoice({
  event,
  action = "Open",
}: {
  event: EventCard;
  action?: string;
}) {
  const when = formatEventWhen(event.startAt, event.timezone);

  return (
    <li className="max-w-sm">
      <Link href={`/e/${event.slug}`} className="group block">
        {/* Square, because Luma covers are. A 4/3 box cropped a quarter of
            the art away, usually the part carrying the event name. */}
        <Plate src={eventCover(event)} alt="" className="aspect-square" />
        <div className="mt-4 flex items-start justify-between gap-6">
          <div>
            <p className="font-display text-2xl tracking-heading group-hover:opacity-60">
              {event.name}
            </p>
            <p className="mt-1 text-sm text-mute">
              {[when, event.location].filter(Boolean).join(" · ") ||
                "Date to be announced"}
            </p>
          </div>
          <span className="shrink-0 text-sm text-mute group-hover:text-ink">
            {action} →
          </span>
        </div>
      </Link>
    </li>
  );
}

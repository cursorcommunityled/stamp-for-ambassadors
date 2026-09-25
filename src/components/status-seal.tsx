import { cn } from "@/lib/utils";
import type { StampLock } from "@/lib/claim";

export function StatusSeal({
  locked,
  stamped,
}: {
  locked: StampLock | null;
  stamped: boolean;
}) {
  const label = stamped
    ? "Stamped"
    : locked === "not_checked_in"
      ? "At the door"
      : locked === "not_on_list"
        ? "Not listed"
        : locked === "not_approved"
          ? "Not approved"
          : "Waiting";

  return (
    <div
      className={cn(
        "stamp-seal shrink-0 self-start",
        stamped && "stamp-seal-ink",
        locked === "not_on_list" || locked === "not_approved"
          ? "stamp-seal-warn"
          : null,
      )}
      aria-hidden
    >
      {label}
    </div>
  );
}

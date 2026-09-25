"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type View = "credits" | "voting";

/**
 * Credits and voting, two jobs on one night. They used to be two pages, and
 * crossing between them reloaded a heading, a seal and a clock that were the
 * same on both sides — which reads as leaving. One page now: the header holds
 * still and only the panel under the toggle changes.
 *
 * Both panels are rendered and one is hidden, so switching back to a ballot
 * mid-vote finds it exactly as it was left.
 */
export function EventViews({
  initial,
  votingReady,
  votingOpen,
  credits,
  voting,
  className,
}: {
  initial: View;
  /** The ballot exists and has somewhere to go. */
  votingReady: boolean;
  /**
   * Open rather than closed. Worth marking: the host opens the ballot while
   * everyone is reading the credits panel, and all that happens here is a
   * greyed word quietly becoming a link, on a page that reloads itself every
   * ten seconds. Nobody looks up for that, which is why the mark moves.
   */
  votingOpen: boolean;
  credits: React.ReactNode;
  voting: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<View>(initial);
  const showing: View = votingReady ? view : "credits";

  function select(next: View) {
    setView(next);
    // Keeps the address bar honest without a navigation, so a refresh or a
    // pasted link opens on the panel they were reading.
    window.history.replaceState(
      null,
      "",
      next === "voting" ? "?view=voting" : window.location.pathname,
    );
  }

  return (
    <>
      <nav className={cn("event-menu", className)} aria-label="This event">
        <ViewTab
          href="?view=credits"
          current={showing === "credits"}
          onPick={() => select("credits")}
        >
          Credits
        </ViewTab>
        <span className="event-menu-rule" aria-hidden />
        {votingReady ? (
          <ViewTab
            href="?view=voting"
            current={showing === "voting"}
            live={votingOpen}
            onPick={() => select("voting")}
          >
            {/* Ahead of the word and tight against it, so it marks Voting and
                not the row. Trailing the pair as "Credits / Voting · Open
                now!" it read as a banner over both. */}
            {votingOpen ? <span className="event-menu-live" aria-hidden /> : null}
            Voting
            {votingOpen ? <span className="sr-only">, open now</span> : null}
          </ViewTab>
        ) : (
          <span className="event-menu-item is-wait">
            Voting
            <span className="sr-only">, not open yet</span>
          </span>
        )}
      </nav>

      <div hidden={showing !== "credits"}>{credits}</div>
      {votingReady ? <div hidden={showing !== "voting"}>{voting}</div> : null}
    </>
  );
}

function ViewTab({
  href,
  current,
  live,
  onPick,
  children,
}: {
  href: string;
  current: boolean;
  /** Something is happening behind this word right now. */
  live?: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  if (current) {
    return (
      <span
        className={cn("event-menu-item is-current", live && "is-live")}
        aria-current="true"
      >
        {children}
      </span>
    );
  }

  // A real href, so the panel is still reachable by a middle-click, a copied
  // link, or a browser that never ran the script. The plain click never
  // leaves the page.
  return (
    <a
      href={href}
      className={cn("event-menu-item", live && "is-live")}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        onPick();
      }}
    >
      {children}
    </a>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ClaimButton({
  eventSlug,
  sponsorSlug,
  remaining,
}: {
  eventSlug: string;
  sponsorSlug: string;
  remaining: number;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function claim() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventSlug, sponsor: sponsorSlug }),
      });
      const data = (await response.json()) as {
        code?: string;
        message?: string;
      };
      if (!response.ok || !data.code) {
        setError(data.message ?? "Could not assign a code.");
        return;
      }
      setCode(data.code);
    } catch {
      setError("Could not assign a code. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (code) {
    return <RevealedCode code={code} sponsorSlug={sponsorSlug} />;
  }

  // Same words as the server sends when a pool empties mid-claim. A dead end
  // reads as a bug and gets reported as one; the pool running dry is expected,
  // and the rest of the handout happens in person.
  if (remaining <= 0) {
    return (
      <p className="shrink-0 text-sm text-mute">Out of codes. Find an organizer.</p>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      {error ? (
        <p role="alert" className="max-w-[16rem] text-right text-sm text-severity-high">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="primary" size="md" disabled={pending} onClick={claim}>
        {pending ? "Claiming…" : "Claim"}
      </Button>
    </div>
  );
}

/**
 * Some pools hold personal referral links rather than codes. A link is opened,
 * not pasted. Full URLs stay behind "Open your link" so they do not blow the
 * row apart on a phone; a short token (Cursor's SKOPJE-…) stays visible and
 * the box itself is the link.
 */
export function RevealedCode({
  code,
  sponsorSlug,
}: {
  code: string;
  sponsorSlug?: string;
}) {
  const [copied, setCopied] = useState(false);
  const href = hrefForCode(code, sponsorSlug);
  const showToken = Boolean(href) && !/^https?:\/\//i.test(code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href ?? code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  // break-all so an unusually long code wraps inside its column instead of
  // widening it and pulling the row out of line with its neighbours.
  const boxClass =
    "inline-block max-w-full break-all bg-ink px-3 py-2 text-sm text-paper hover:opacity-85";

  return (
    <div className="credit-copy flex shrink-0 items-center justify-end gap-3">
      {/* Beside the chip, not under it. Stacked, this line made every row
          holding a code taller than the rows whose action is a plain button,
          and the list lost its rhythm. Fixed width so "Copied" does not
          nudge the chip sideways. */}
      <button
        type="button"
        onClick={copy}
        title={href ? "Copy link" : "Copy code"}
        className="w-[3.1rem] shrink-0 text-right text-xs text-mute hover:text-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            showToken
              ? `${boxClass} font-mono tracking-[0.08em]`
              : boxClass
          }
        >
          {showToken ? code : sponsorSlug === "cursor" ? "Claim your credits ↗" : "Open your link ↗"}
        </a>
      ) : (
        <button
          type="button"
          onClick={copy}
          className={`${boxClass} font-mono tracking-[0.08em]`}
          title="Copy code"
        >
          {code}
        </button>
      )}
    </div>
  );
}

function hrefForCode(code: string, sponsorSlug?: string): string | null {
  const value = code.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (sponsorSlug === "cursor") {
    return `https://cursor.com/referral?code=${encodeURIComponent(value)}`;
  }
  return null;
}

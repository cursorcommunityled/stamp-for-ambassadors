import { ClaimButton, RevealedCode } from "@/components/claim-button";

export function SponsorCredit({
  sponsor,
  index,
  eventSlug,
  remaining,
  pool,
  mine,
  ended,
}: {
  sponsor: {
    id: string;
    slug: string;
    name: string;
    perk: string | null;
    redeemUrl: string | null;
    instructions: string | null;
    notes: string | null;
  };
  index: number;
  eventSlug: string;
  remaining: number;
  pool: number;
  mine?: string;
  ended: boolean;
}) {
  const localPool = pool > 0;
  const sharedCode = localPool ? null : sharedCodeFrom(sponsor.instructions);
  const start = startLinkFrom(sponsor.instructions);
  const howTo = instructionsWithoutCode(sponsor.instructions, start);
  const redeem =
    sponsor.redeemUrl && !sponsor.instructions?.includes(sponsor.redeemUrl)
      ? sponsor.redeemUrl
      : null;

  const hasCode = Boolean(mine || sharedCode);
  const canClaim = !ended && localPool && !hasCode;
  // When there is nothing to claim here, the partner's own site is the action.
  const startIsAction = Boolean(start) && !hasCode && !canClaim;
  // Worth folding only when there is something to read. A partner that hands
  // over a code and a link has no steps, and a toggle over one link is a step
  // of its own.
  const reading = Boolean(howTo) || Boolean(sponsor.notes);

  // Where there are steps, the partner's site is the first of them. Where
  // there are none, the name carries the link so the row stays one line
  // instead of trailing a lone "Open Exa" under itself.
  const startLink =
    start && !startIsAction && reading ? (
      <CreditOpen href={start} label={`Open ${sponsor.name}`} quiet />
    ) : null;
  const nameHref = start && !startIsAction && !reading ? start : null;
  const redeemLink = redeem ? (
    <a
      href={redeem}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-block text-sm text-ink underline decoration-line underline-offset-4 hover:opacity-60"
    >
      {sponsor.slug === "render" ? "Open Credit Balance" : "Redeem"} ↗
    </a>
  ) : null;

  const label = (
    <span className="credit-label">
      <h2 className="credit-name">
        {nameHref ? (
          <a
            href={nameHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-60"
          >
            {sponsor.name}
            <span className="text-sm text-mute"> ↗</span>
          </a>
        ) : (
          sponsor.name
        )}
      </h2>
      {sponsor.perk ? <span className="credit-perk">{sponsor.perk}</span> : null}
    </span>
  );

  return (
    <li className="credit">
      <p className="credit-index">{String(index).padStart(2, "0")}</p>
      {/* The name line doubles as the toggle, so a partner costs one line
          until somebody wants its steps. */}
      {reading ? (
        <details className="credit-fold">
          <summary>
            {label}
            <span className="credit-mark" aria-hidden />
          </summary>
          {startLink}
          {howTo ? <SponsorHowTo text={howTo} /> : null}
          {redeemLink}
          {sponsor.notes ? <SponsorNotes text={sponsor.notes} /> : null}
        </details>
      ) : (
        <div className="min-w-0">
          {label}
          {redeemLink}
        </div>
      )}
      <div className="credit-action">
        {mine ? (
          <RevealedCode code={mine} sponsorSlug={sponsor.slug} />
        ) : sharedCode ? (
          <RevealedCode code={sharedCode} sponsorSlug={sponsor.slug} />
        ) : canClaim ? (
          <ClaimButton
            eventSlug={eventSlug}
            sponsorSlug={sponsor.slug}
            remaining={remaining}
          />
        ) : startIsAction && start ? (
          <CreditOpen href={start} label={`Open ${sponsor.name}`} />
        ) : null}
      </div>
    </li>
  );
}

function CreditOpen({
  href,
  label,
  quiet,
}: {
  href: string;
  label: string;
  quiet?: boolean;
}) {
  if (quiet) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-sm text-ink underline decoration-line underline-offset-4 hover:opacity-60"
      >
        {label} ↗
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block bg-ink px-3 py-2 text-sm text-paper hover:opacity-85"
    >
      {label} ↗
    </a>
  );
}

function sharedCodeFrom(text: string | null | undefined) {
  const match = text?.match(/^Use code:\s+(\S+)/im);
  return match?.[1] ?? null;
}

/**
 * A bare URL on the first line is where the offer starts, not a step to read.
 * Promoting it out of the list keeps the numbered steps as actions and stops a
 * long link from wrapping across three lines above them.
 */
function startLinkFrom(text: string | null | undefined) {
  const first = text?.split("\n")[0]?.trim();
  return first && /^https?:\/\/\S+$/.test(first) ? first : null;
}

function instructionsWithoutCode(
  text: string | null | undefined,
  startLink: string | null,
) {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line && line !== startLink && !/^Use code:\s+\S+/i.test(line),
    )
    .join("\n");
}

function SponsorHowTo({ text }: { text: string }) {
  const steps = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (steps.length === 1) {
    return (
      <p className="credit-blurb">
        <LinkedText text={steps[0]} />
      </p>
    );
  }

  return (
    <ol className="credit-howto">
      {steps.map((step, index) => (
        <li key={`${index}-${step}`}>
          <span className="credit-step-n" aria-hidden>
            {index + 1}
          </span>
          <span className={/^https?:\/\//.test(step) ? "break-all" : undefined}>
            <LinkedText text={step} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function SponsorNotes({ text }: { text: string }) {
  const notes = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <details className="credit-notes">
      <summary>Good to know</summary>
      <div className="mt-2 space-y-1.5">
        {notes.map((note) => (
          <p key={note}>
            <LinkedText text={note} />
          </p>
        ))}
      </div>
    </details>
  );
}

function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-ink hover:opacity-60"
          >
            {part}
          </a>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

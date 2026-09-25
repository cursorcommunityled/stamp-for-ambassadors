"use client";

import { useActionState, useState } from "react";
import {
  importCodes,
  saveGuide,
  reassignLeftovers,
  removeCode,
  removeUnclaimed,
  type ActionResult,
} from "@/app/admin/actions";
import { Fold } from "@/components/fold";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

const NEW_PARTNER = "__new__";

function Result({ state }: { state: ActionResult }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-severity-high">
        {state.error}
      </p>
    );
  }
  if (state?.ok) {
    return <p className="text-sm text-mute">{state.ok}</p>;
  }
  if (typeof state?.imported === "number") {
    return <p className="text-sm text-mute">Imported {state.imported} new codes.</p>;
  }
  return null;
}

export function GuideForm({ eventSlug }: { eventSlug: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    saveGuide,
    undefined,
  );

  return (
    <form action={formAction} className="mt-6 flex max-w-md flex-col gap-5">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <Field label="Partner name">
        <Input name="name" required autoComplete="off" />
      </Field>
      <Field label="Perk" hint="Optional. Leave it blank if the amount should not be written down.">
        <Input name="perk" autoComplete="off" />
      </Field>
      <Field
        label="Steps"
        hint="One step per line. A URL on its own line becomes the open link. Stored for this deploy only."
      >
        <Textarea name="instructions" rows={4} required />
      </Field>
      <Result state={state} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : "Save how-to"}
      </Button>
    </form>
  );
}

export function UploadForm({
  eventSlug,
  sponsors,
}: {
  eventSlug: string;
  sponsors: { slug: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    importCodes,
    undefined,
  );
  const [partner, setPartner] = useState(sponsors[0]?.slug ?? NEW_PARTNER);
  const isNew = partner === NEW_PARTNER;

  return (
    <form action={formAction} className="mt-6 flex max-w-md flex-col gap-5">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <Field label="Partner">
        <select
          value={partner}
          onChange={(event) => setPartner(event.target.value)}
          className="h-11 w-full border-x-0 border-t-0 border-b border-ink/25 bg-transparent px-0 text-sm focus:border-ink focus:outline-none"
        >
          {sponsors.map((sponsor) => (
            <option key={sponsor.slug} value={sponsor.slug}>
              {sponsor.name}
            </option>
          ))}
          <option value={NEW_PARTNER}>New partner…</option>
        </select>
      </Field>
      {isNew ? (
        <>
          <Field label="Partner name">
            <Input name="newPartnerName" required placeholder="Wispr Flow" autoComplete="off" />
          </Field>
          <Field label="Perk" hint="Optional. What the attendee gets, in a few words.">
            <Input name="newPartnerPerk" placeholder="3 months Pro" autoComplete="off" />
          </Field>
          <Field
            label="How to redeem"
            hint="Optional. One step per line. A URL on its own becomes the open link."
          >
            <Textarea
              name="newPartnerInstructions"
              rows={3}
              placeholder={"https://example.com/redeem\nPaste the code. It is yours alone."}
            />
          </Field>
        </>
      ) : (
        <input type="hidden" name="sponsorSlug" value={partner} />
      )}
      <Field
        label="CSV"
        hint={
          isNew
            ? "Optional. One code per line. A header named code is skipped. Duplicates are ignored. Leave it empty to save the steps only."
            : "One code per line. A header named code is skipped. Duplicates are ignored."
        }
      >
        <Input name="file" type="file" accept=".csv,text/csv,text/plain" required={!isNew} />
      </Field>
      <Result state={state} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : isNew ? "Save partner" : "Upload CSV"}
      </Button>
    </form>
  );
}

export type PoolRow = {
  slug: string;
  name: string;
  leftover: { id: string; code: string }[];
  claims: {
    id: string;
    email: string;
    name: string | null;
    when: string | null;
  }[];
};

export function CodePool({
  eventSlug,
  pool,
}: {
  eventSlug: string;
  pool: PoolRow;
}) {
  const [removeState, removeAction, removing] = useActionState<
    ActionResult,
    FormData
  >(removeCode, undefined);
  const [clearState, clearAction, clearing] = useActionState<
    ActionResult,
    FormData
  >(removeUnclaimed, undefined);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const left = pool.leftover.length;
  const claimed = pool.claims.length;

  return (
    <div className="mt-2">
      {left > 0 ? (
        <form action={removeAction}>
          <input type="hidden" name="eventSlug" value={eventSlug} />
          <Fold title="Unclaimed" summary={`${left}`}>
            <ul className="divide-y divide-line border-y border-line">
              {pool.leftover.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-6 py-4"
                >
                  <p className="min-w-0 break-all font-mono text-sm tracking-tight">
                    {row.code}
                  </p>
                  <Button
                    type="submit"
                    name="codeId"
                    value={row.id}
                    variant="danger"
                    size="sm"
                    disabled={removing}
                    onClick={() => setRemovingId(row.id)}
                  >
                    {removing && removingId === row.id ? "Removing…" : "Remove"}
                  </Button>
                </li>
              ))}
            </ul>
            <Result state={removeState} />
          </Fold>
        </form>
      ) : (
        <p className="mt-4 text-sm text-mute">
          No leftovers. Every code has a guest.
        </p>
      )}

      {claimed > 0 ? (
        <Fold title="Claimed" summary={`${claimed}`}>
          <ul className="divide-y divide-line border-y border-line">
            {pool.claims.map((claim) => (
              <li
                key={claim.id}
                className="flex items-baseline justify-between gap-6 py-4"
              >
                <p className="font-mono text-sm tracking-tight">{claim.email}</p>
                <p className="shrink-0 text-[11px] text-mute">
                  {[claim.name, claim.when ? `scanned ${claim.when}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </Fold>
      ) : (
        <p className="mt-4 text-sm text-mute">
          Nobody has claimed yet. The door scan hands these out.
        </p>
      )}

      {left > 0 ? (
        <form action={clearAction} className="mt-2">
          <input type="hidden" name="eventSlug" value={eventSlug} />
          <input type="hidden" name="sponsorSlug" value={pool.slug} />
          <Result state={clearState} />
          <Button type="submit" variant="danger" size="sm" disabled={clearing}>
            {clearing ? "Removing…" : "Remove all leftovers"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function LeftoverForm({
  fromSlug,
  sponsors,
  events,
}: {
  fromSlug: string;
  sponsors: { slug: string; name: string }[];
  events: { slug: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    reassignLeftovers,
    undefined,
  );

  if (events.length === 0) {
    return (
      <p className="mt-4 text-sm text-mute">
        Create another event before moving leftovers.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-6 flex max-w-md flex-col gap-5">
      <input type="hidden" name="fromSlug" value={fromSlug} />
      <Field label="Sponsor">
        <select
          name="sponsorSlug"
          required
          className="h-11 w-full border-x-0 border-t-0 border-b border-ink/25 bg-transparent px-0 text-sm focus:border-ink focus:outline-none"
        >
          {sponsors.map((sponsor) => (
            <option key={sponsor.slug} value={sponsor.slug}>
              {sponsor.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Move unclaimed to">
        <select
          name="toSlug"
          required
          className="h-11 w-full border-x-0 border-t-0 border-b border-ink/25 bg-transparent px-0 text-sm focus:border-ink focus:outline-none"
        >
          {events.map((event) => (
            <option key={event.slug} value={event.slug}>
              {event.name}
            </option>
          ))}
        </select>
      </Field>
      <Result state={state} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Moving…" : "Move leftovers"}
      </Button>
    </form>
  );
}

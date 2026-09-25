"use client";

import { useActionState } from "react";
import { createEvent, type ActionResult } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function NewEventForm({
  hosts,
  admin,
}: {
  hosts: { email: string }[];
  admin: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    createEvent,
    undefined,
  );

  return (
    <form action={formAction} className="mt-8 flex max-w-md flex-col gap-6">
      <Field
        label="Luma event"
        hint={
          admin
            ? "Paste the Luma event link (luma.com/…) or an evt- id. Title, date, place, and cover come from Luma."
            : "Paste the Luma link (luma.com/…) or evt- id of an event Luma lists you as a host on. Title, date, place, and cover come from Luma."
        }
      >
        {/* No autoFocus: the form starts inside a shut fold, so focusing it
            on mount does nothing and would fight the fold if it ever did. */}
        <Input
          name="lumaEventId"
          required
          placeholder="https://luma.com/…"
          autoComplete="off"
        />
      </Field>
      {admin && hosts.length > 0 ? (
        <Field
          label="Host"
          hint="Optional. Appointed hosts can manage inventory. Admins always can too."
        >
          <select
            name="hostEmail"
            defaultValue=""
            className="h-11 w-full border-x-0 border-t-0 border-b border-ink/25 bg-transparent px-0 text-sm focus:border-ink focus:outline-none"
          >
            <option value="">None yet</option>
            {hosts.map((host) => (
              <option key={host.email} value={host.email}>
                {host.email}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <label className="flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          name="perksRequireCheckIn"
          defaultChecked
          className="mt-1"
        />
        <span>
          Require door check-in. Credits stay locked until you scan them
          in the Luma app.
        </span>
      </label>
      {state?.error ? (
        <p role="alert" className="text-sm text-severity-high">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Importing…" : "Import event"}
      </Button>
    </form>
  );
}

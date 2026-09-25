"use client";

import { useActionState } from "react";
import {
  assignEventHosts,
  confirmHost,
  inviteHost,
  refreshEventFromLuma,
  revokeHost,
  type ActionResult,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

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
  return null;
}

export function InviteHostForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    inviteHost,
    undefined,
  );

  return (
    <form action={formAction} className="mt-8 flex max-w-md flex-col gap-5">
      <Field
        label="Host email"
        hint="They get a stamp link to the organizer dashboard and can add Luma events they host."
      >
        <Input name="email" type="email" required placeholder="host@example.com" />
      </Field>
      <Result state={state} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Inviting…" : "Invite host"}
      </Button>
    </form>
  );
}

/**
 * Confirm or revoke one host. A button per row rather than a checkbox list:
 * this decides who can move another event's codes, so it should never be
 * something you change by mis-clicking on the way to Save.
 */
export function HostAccessForm({
  hostId,
  email,
  confirmed,
}: {
  hostId: string;
  email: string;
  confirmed: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    confirmed ? revokeHost : confirmHost,
    undefined,
  );

  return (
    <form action={formAction} className="flex shrink-0 flex-col items-end gap-2">
      <input type="hidden" name="hostId" value={hostId} />
      <Button
        type="submit"
        size="sm"
        variant={confirmed ? "ghost" : "primary"}
        disabled={pending}
        aria-label={`${confirmed ? "Revoke" : "Confirm"} ${email}`}
      >
        {pending
          ? confirmed
            ? "Revoking…"
            : "Confirming…"
          : confirmed
            ? "Revoke"
            : "Confirm"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function AssignHostsForm({
  eventSlug,
  hosts,
  appointedHostIds,
}: {
  eventSlug: string;
  hosts: { id: string; email: string }[];
  appointedHostIds: string[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    assignEventHosts,
    undefined,
  );

  // The page decides whether this section exists at all, so there is nothing
  // useful to say here about a host list that is empty.
  if (hosts.length === 0) return null;

  return (
    <form action={formAction} className="mt-6 flex max-w-md flex-col gap-5">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-[10px] uppercase tracking-[0.14em] text-mute">
          Appointed hosts
        </legend>
        {hosts.map((host) => (
          <label
            key={host.id}
            className="flex items-start gap-3 text-sm leading-6"
          >
            <input
              type="checkbox"
              name="hostId"
              value={host.id}
              defaultChecked={appointedHostIds.includes(host.id)}
              className="mt-1"
            />
            <span className="font-mono tracking-tight">{host.email}</span>
          </label>
        ))}
      </fieldset>
      <Result state={state} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : "Save hosts"}
      </Button>
    </form>
  );
}

export function RefreshLumaForm({ eventSlug }: { eventSlug: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    refreshEventFromLuma,
    undefined,
  );

  return (
    <form action={formAction} className="mt-6 flex max-w-md flex-col gap-4">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <Result state={state} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Refreshing…" : "Refresh from Luma"}
      </Button>
    </form>
  );
}

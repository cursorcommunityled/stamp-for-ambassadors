"use client";

import { useActionState } from "react";
import { sendStampLink, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function EmailForm({
  nextPath = "/",
  defaultEmail,
  label = "Email on the ticket",
  hint = "A one-time link. No password.",
}: {
  nextPath?: string;
  defaultEmail?: string;
  label?: string;
  hint?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    sendStampLink,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="next" value={nextPath} />
      <Field label={label} hint={hint}>
        <Input
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={defaultEmail}
          placeholder="you@example.com"
        />
      </Field>
      {state?.error ? (
        <p role="alert" className="text-sm text-severity-high">
          {state.error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="self-start"
        disabled={pending}
      >
        {pending ? "Sending…" : "Send me a verification link"}
      </Button>
    </form>
  );
}

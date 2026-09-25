"use client";

import { useActionState } from "react";
import { sendSetupTestEmail, type ActionResult } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export function SetupTestEmail() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    sendSetupTestEmail,
    undefined,
  );

  return (
    <form action={formAction} className="mt-6 flex flex-col items-start gap-3">
      {state?.error ? (
        <p role="alert" className="text-sm text-severity-high">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? <p className="text-sm text-mute">{state.ok}</p> : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Sending…" : "Send me a test email"}
      </Button>
    </form>
  );
}

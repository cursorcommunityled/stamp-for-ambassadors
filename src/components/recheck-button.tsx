"use client";

import { useActionState } from "react";
import { recheckMyStamp, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RecheckButton({
  eventSlug,
  className,
}: {
  eventSlug: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    recheckMyStamp,
    undefined,
  );

  return (
    <form action={formAction} className={cn("mt-6", className)}>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      {state?.error ? (
        <p role="alert" className="mb-3 text-sm text-severity-high">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Checking Luma…" : "Check again"}
      </Button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  addProject,
  removeProject,
  setVoting,
  type ActionResult,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { VotingState } from "@/lib/voting";

/**
 * Typed one-handed while a team is still presenting. React clears the fields
 * once the action resolves; the focus jump is ours, because the next project
 * is usually seconds behind this one.
 */
export function AddProjectForm({ eventSlug }: { eventSlug: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    addProject,
    undefined,
  );
  const name = useRef<HTMLInputElement>(null);

  // A fresh object every time the action returns, so this re-fires on each
  // add even when two projects in a row produce the same message.
  useEffect(() => {
    if (state?.ok) name.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="mt-6 flex max-w-md flex-col gap-5">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <Field label="Project">
        <Input ref={name} name="name" required maxLength={120} autoComplete="off" />
      </Field>
      <Field label="Built by" hint="However they introduced themselves.">
        <Input name="builders" required maxLength={200} autoComplete="off" />
      </Field>
      <Field label="Description" hint="Optional. One line is plenty.">
        <Textarea name="description" rows={2} maxLength={600} />
      </Field>
      {state?.error ? (
        <p role="alert" className="text-sm text-severity-high">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? <p className="text-sm text-mute">{state.ok}</p> : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Adding…" : "Add to ballot"}
      </Button>
    </form>
  );
}

/**
 * Rows arrive in the order to show them: running order while the ballot is
 * live, standings once it closes. `place` is what switches the leading number
 * from "the third to present" to "third".
 */
export function ProjectRoster({
  eventSlug,
  projects,
  showVotes,
}: {
  eventSlug: string;
  projects: {
    id: string;
    name: string;
    builders: string;
    votes: number;
    place: number | null;
  }[];
  showVotes: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    removeProject,
    undefined,
  );
  const [removing, setRemoving] = useState<string | null>(null);

  if (projects.length === 0) {
    return (
      <p className="mt-6 text-sm text-mute">
        Nothing on the ballot yet. Add the first project as it goes up.
      </p>
    );
  }

  const tied = projects.filter((project) => project.place === 1).length > 1;

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <ul className="border-y border-line">
        {projects.map((project, index) => (
          <li
            key={project.id}
            className={project.place === 1 ? "ticket is-winner" : "ticket"}
          >
            <div>
              <p className="font-display text-lg tracking-heading">
                {project.place !== null
                  ? `#${project.place}`
                  : String(index + 1).padStart(2, "0")}{" "}
                ·{" "}
                <Link
                  href={`/e/${eventSlug}/projects`}
                  className="hover:opacity-60"
                >
                  {project.name}
                </Link>
                {project.place === 1 ? (
                  <span className="ballot-won ml-3 align-middle">
                    {tied ? "Tied" : "Winner"}
                  </span>
                ) : null}
              </p>
              <p className="font-mono text-[11px] tracking-wide text-mute">
                {project.builders}
                {showVotes
                  ? ` · ${project.votes} ${project.votes === 1 ? "vote" : "votes"}`
                  : null}
              </p>
            </div>
            <Button
              type="submit"
              name="projectId"
              value={project.id}
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={() => setRemoving(project.id)}
            >
              {pending && removing === project.id ? "Removing…" : "Remove"}
            </Button>
          </li>
        ))}
      </ul>
      {state?.error ? (
        <p role="alert" className="mt-4 text-sm text-severity-high">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? <p className="mt-4 text-sm text-mute">{state.ok}</p> : null}
    </form>
  );
}

const FACE: Record<VotingState, { label: string; intent: "open" | "close" }> = {
  idle: { label: "Open voting", intent: "open" },
  open: { label: "Close voting", intent: "close" },
  closed: { label: "Reopen voting", intent: "open" },
};

/**
 * The page around this says what state the ballot is in, so all this owes the
 * host is the count climbing and the one button that changes it. The
 * denominator is the point: closing at 6 votes is fine in a room of 8 and
 * early in a room of 80.
 */
export function VotingSwitch({
  eventSlug,
  state: votingState,
  voters,
  eligible,
}: {
  eventSlug: string;
  state: VotingState;
  voters: number;
  eligible: number;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    setVoting,
    undefined,
  );
  const face = FACE[votingState];
  const showTally = votingState !== "idle";

  return (
    <form action={formAction} className="mt-10 max-w-md">
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="intent" value={face.intent} />
      {showTally ? (
        <p aria-live="polite">
          <span className="font-display text-5xl tracking-heading">
            {voters}
          </span>
          <span className="ml-3 text-sm text-mute">
            of {eligible} stamped {eligible === 1 ? "attendee" : "attendees"}{" "}
            voted
          </span>
        </p>
      ) : null}
      {state?.error ? (
        <p role="alert" className="mt-4 text-sm text-severity-high">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? <p className="mt-4 text-sm text-mute">{state.ok}</p> : null}
      <Button
        type="submit"
        variant={votingState === "open" ? "outline" : "primary"}
        disabled={pending}
        className={showTally || state ? "mt-7" : ""}
      >
        {pending ? "Saving…" : face.label}
      </Button>
    </form>
  );
}

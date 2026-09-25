"use client";

import { useActionState, useState } from "react";
import { castMyVote, type ActionResult } from "@/app/actions";
import { BallotFireworks } from "@/components/ballot-fireworks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BallotRow = {
  id: string;
  name: string;
  builders: string;
  description: string | null;
  /**
   * The count as it stands, refreshed by the page's own poll. Null only while
   * there is no ballot to count.
   *
   * These used to be hidden until the ballot closed, so that a visible leader
   * could not turn the last few votes into agreement with the room. Shown, on
   * the grounds that a room watching the numbers move is the point of doing
   * this in front of everyone.
   */
  votes: number | null;
  place: number | null;
};

/**
 * The ballot itself: everything an organizer wrote down, in the order it was
 * presented. One vote each, movable until the ballot closes, then the same
 * list re-reads as results. The page around it owns the heading and copy.
 */
export function ProjectBallot({
  eventSlug,
  projects,
  closed,
  myVoteId,
  readOnly,
}: {
  eventSlug: string;
  projects: BallotRow[];
  closed: boolean;
  myVoteId: string | null;
  /** Results, or a guest who is on the list but not yet stamped. */
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    castMyVote,
    undefined,
  );
  const [choosing, setChoosing] = useState<string | null>(null);
  const firsts = projects.filter((project) => project.place === 1);
  const firstWinnerId = firsts[0]?.id ?? null;
  const tied = firsts.length > 1;

  const rows = projects.map((project, index) => {
    const won = closed && project.place === 1;
    const label = (
      <span className="ballot-label">
        <h2 className="ballot-name">{project.name}</h2>
        <span className="ballot-builders">{project.builders}</span>
        {won ? (
          <span className="ballot-won">{tied ? "Tied" : "Winner"}</span>
        ) : null}
      </span>
    );

    return (
      <li
        key={project.id}
        className={cn("ballot", won && "is-winner")}
      >
        {won && project.id === firstWinnerId ? <BallotFireworks /> : null}
        <p className="ballot-index">
          {closed && project.place !== null
            ? `#${project.place}`
            : String(index + 1).padStart(2, "0")}
        </p>
        {/* The pitch folds away while there is still a vote to cast. It is
            what decides a close vote, but it is read once, and after that the
            list is scanned for the name you remember watching. Closed, there
            is nothing left to scan for and nothing to press: the list is a
            record of the night, so the pitch is just part of the entry. */}
        {project.description && !closed ? (
          <details className="ballot-fold">
            <summary>
              {label}
              <span className="ballot-mark" aria-hidden />
            </summary>
            <p className="ballot-blurb">{project.description}</p>
          </details>
        ) : (
          <div className="min-w-0">
            {label}
            {project.description ? (
              <p className="ballot-blurb">{project.description}</p>
            ) : null}
          </div>
        )}
        <div className="ballot-action">
          {project.votes !== null ? (
            <span className="ballot-tally">
              {project.votes} {project.votes === 1 ? "vote" : "votes"}
            </span>
          ) : null}
          {myVoteId === project.id ? (
            <span className="ballot-mine">Your vote</span>
          ) : readOnly ? null : (
            <Button
              type="submit"
              name="projectId"
              value={project.id}
              variant={myVoteId ? "outline" : "primary"}
              // Same size as a partner's claim button on the other panel.
              // "sm" put a 12px label next to a 14px one on the same page.
              size="md"
              disabled={pending}
              onClick={() => setChoosing(project.id)}
            >
              {pending && choosing === project.id
                ? "Voting…"
                : myVoteId
                  ? "Move here"
                  : "Vote"}
            </Button>
          )}
        </div>
      </li>
    );
  });

  const list = <ul className="mt-6 border-y border-line">{rows}</ul>;

  if (readOnly) return list;

  return (
    <form action={formAction}>
      <input type="hidden" name="eventSlug" value={eventSlug} />
      {list}
      {state?.error ? (
        <p role="alert" className="mt-4 text-sm text-severity-high">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

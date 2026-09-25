import { describe, expect, it } from "vitest";
import {
  formatEventWhen,
  hasEnded,
  isUpcomingEvent,
  openMicAt,
  sortEvents,
  splitEvents,
} from "@/lib/events";
import { hasVotes, rankProjects, votingState } from "@/lib/voting";

const HOUR = 3600_000;
const now = new Date("2026-09-24T18:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * HOUR);
const ahead = (h: number) => new Date(now.getTime() + h * HOUR);

describe("votingState", () => {
  it("is idle until opened", () => {
    expect(votingState({ votingOpenedAt: null, votingClosedAt: null }, now)).toBe("idle");
  });

  it("is open after opening and closed after closing", () => {
    expect(votingState({ votingOpenedAt: ago(1), votingClosedAt: null }, now)).toBe("open");
    expect(votingState({ votingOpenedAt: ago(2), votingClosedAt: ago(1) }, now)).toBe("closed");
  });

  it("closes itself six hours after opening", () => {
    expect(votingState({ votingOpenedAt: ago(5.9), votingClosedAt: null }, now)).toBe("open");
    expect(votingState({ votingOpenedAt: ago(6.1), votingClosedAt: null }, now)).toBe("closed");
  });
});

describe("rankProjects", () => {
  const projects = [
    { id: "a", name: "A", builders: "", description: null, sortOrder: 1 },
    { id: "b", name: "B", builders: "", description: null, sortOrder: 2 },
    { id: "c", name: "C", builders: "", description: null, sortOrder: 3 },
  ];

  it("orders by votes, then by running order", () => {
    const ranked = rankProjects(projects, new Map([["c", 3], ["b", 1], ["a", 1]]));
    expect(ranked.map((r) => r.project.id)).toEqual(["c", "a", "b"]);
  });

  it("gives tied projects the same place and skips the next one", () => {
    const ranked = rankProjects(projects, new Map([["a", 2], ["b", 2], ["c", 1]]));
    expect(ranked.map((r) => r.place)).toEqual([1, 1, 3]);
  });

  it("counts projects nobody voted for as zero", () => {
    const ranked = rankProjects(projects, new Map([["b", 1]]));
    expect(ranked.at(-1)?.votes).toBe(0);
  });

  it("hasVotes is false for an empty or all-zero tally", () => {
    expect(hasVotes(new Map())).toBe(false);
    expect(hasVotes(new Map([["a", 0]]))).toBe(false);
    expect(hasVotes(new Map([["a", 1]]))).toBe(true);
  });
});

describe("event dates", () => {
  it("stays live for six hours after the end", () => {
    expect(isUpcomingEvent({ startAt: ago(8), endAt: ago(5) }, now)).toBe(true);
    expect(hasEnded({ startAt: ago(10), endAt: ago(7) }, now)).toBe(true);
  });

  it("without an end time, stays live for eighteen hours after the start", () => {
    expect(isUpcomingEvent({ startAt: ago(17), endAt: null }, now)).toBe(true);
    expect(hasEnded({ startAt: ago(19), endAt: null }, now)).toBe(true);
  });

  it("an event with no dates at all counts as upcoming", () => {
    expect(hasEnded({ startAt: null, endAt: null }, now)).toBe(false);
  });

  it("splits into upcoming (soonest first) and past (latest first)", () => {
    const events = [
      { id: "old", startAt: ago(100), endAt: ago(97) },
      { id: "soon", startAt: ahead(2), endAt: ahead(5) },
      { id: "older", startAt: ago(200), endAt: ago(197) },
      { id: "later", startAt: ahead(50), endAt: ahead(53) },
    ];
    const { upcoming, past } = splitEvents(events, now);
    expect(upcoming.map((e) => e.id)).toEqual(["soon", "later"]);
    expect(past.map((e) => e.id)).toEqual(["old", "older"]);
  });

  it("puts undated events first in either list", () => {
    const sorted = sortEvents([{ startAt: ahead(1) }, { startAt: null }], true);
    expect(sorted[0].startAt).toBeNull();
  });

  it("does not crash on a timezone name Intl does not know", () => {
    expect(formatEventWhen(now, "Mars/Olympus_Mons")).toBeTruthy();
  });

  it("puts the open mic at 20:30 local time when that falls inside the event", () => {
    const start = new Date("2026-09-24T16:00:00Z"); // 18:00 in Skopje
    const end = new Date("2026-09-24T21:00:00Z");
    expect(openMicAt(start, end, "Europe/Skopje")?.toISOString()).toBe("2026-09-24T18:30:00.000Z");
  });

  it("has no open mic when 20:30 is outside the event", () => {
    const start = new Date("2026-09-24T07:00:00Z");
    const end = new Date("2026-09-24T10:00:00Z");
    expect(openMicAt(start, end, "Europe/Skopje")).toBeNull();
  });
});

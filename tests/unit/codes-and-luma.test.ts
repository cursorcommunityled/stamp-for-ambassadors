import { describe, expect, it } from "vitest";
import { parseCsvCodes } from "@/lib/claim";
import { lumaEventSlug, normalizeGuest, parseLumaEventId } from "@/lib/luma";

describe("parseCsvCodes", () => {
  it("skips a header row and blank lines", () => {
    expect(parseCsvCodes("code\nA-1\n\nA-2\n")).toEqual(["A-1", "A-2"]);
  });

  it("accepts other common header names", () => {
    expect(parseCsvCodes("Coupon\nX")).toEqual(["X"]);
    expect(parseCsvCodes("key\nX")).toEqual(["X"]);
  });

  it("only treats the first row as a header", () => {
    expect(parseCsvCodes("A-1\ncode\nA-2")).toEqual(["A-1", "code", "A-2"]);
  });

  it("takes the first column of comma, semicolon, and tab separated files", () => {
    expect(parseCsvCodes("code,email\nA-1,x@y.z")).toEqual(["A-1"]);
    expect(parseCsvCodes("A-1;note")).toEqual(["A-1"]);
    expect(parseCsvCodes("A-1\tnote")).toEqual(["A-1"]);
  });

  it("strips quotes and Windows line endings", () => {
    expect(parseCsvCodes('"code"\r\n"A-1"\r\n\'A-2\'\r\n')).toEqual(["A-1", "A-2"]);
  });

  it("drops duplicates case-insensitively, keeping the first spelling", () => {
    expect(parseCsvCodes("abc\nABC\nabc\ndef")).toEqual(["abc", "def"]);
  });

  it("keeps full referral URLs intact", () => {
    const url = "https://cursor.com/referral?code=XYZ-123";
    expect(parseCsvCodes(`code\n${url}`)).toEqual([url]);
  });

  it("ignores a UTF-8 byte order mark that Excel puts at the start", () => {
    expect(parseCsvCodes("\uFEFFcode\nA-1")).toEqual(["A-1"]);
  });
});

describe("Luma event references", () => {
  it("finds an evt- id wherever it is pasted", () => {
    expect(parseLumaEventId("evt-abc123")).toBe("evt-abc123");
    expect(parseLumaEventId("  https://luma.com/event/manage/evt-XyZ9  ")).toBe("evt-XyZ9");
    expect(parseLumaEventId("https://luma.com/build-night")).toBeNull();
  });

  it("reads the slug from luma.com and lu.ma links, with or without https", () => {
    expect(lumaEventSlug("https://luma.com/build-night")).toBe("build-night");
    expect(lumaEventSlug("https://lu.ma/build-night?tk=abc")).toBe("build-night");
    expect(lumaEventSlug("luma.com/build-night")).toBe("build-night");
    expect(lumaEventSlug("www.luma.com/build-night/")).toBe("build-night");
  });

  it("accepts a bare slug but not Luma's own pages or other sites", () => {
    expect(lumaEventSlug("build-night")).toBe("build-night");
    expect(lumaEventSlug("https://luma.com/calendar")).toBeNull();
    expect(lumaEventSlug("https://luma.com/home")).toBeNull();
    expect(lumaEventSlug("https://example.com/x")).toBeNull();
    expect(lumaEventSlug("")).toBeNull();
  });
});

describe("normalizeGuest", () => {
  it("reads the email from any of the fields Luma uses and lowercases it", () => {
    const base = { approval_status: "approved" };
    expect(normalizeGuest({ ...base, id: "g1", user_email: " A@B.C " })?.email).toBe("a@b.c");
    expect(normalizeGuest({ ...base, api_id: "g1", email: "x@y.z" })?.lumaGuestId).toBe("g1");
    expect(normalizeGuest({ ...base, id: "g1", user: { email: "u@v.w" } })?.email).toBe("u@v.w");
  });

  it("returns null without an id or an email", () => {
    expect(normalizeGuest({ approval_status: "approved", user_email: "a@b.c" })).toBeNull();
    expect(normalizeGuest({ approval_status: "approved", id: "g1" })).toBeNull();
  });

  it("uses the earliest check-in across the guest and their tickets", () => {
    const guest = normalizeGuest({
      id: "g1",
      user_email: "a@b.c",
      approval_status: "approved",
      checked_in_at: null,
      event_tickets: [
        { checked_in_at: "2026-09-01T20:30:00Z" },
        { checked_in_at: "2026-09-01T19:00:00Z" },
        { checked_in_at: null },
      ],
    });
    expect(guest?.checkedInAt?.toISOString()).toBe("2026-09-01T19:00:00.000Z");
  });

  it("treats an unparseable date as not checked in", () => {
    const guest = normalizeGuest({
      id: "g1",
      user_email: "a@b.c",
      approval_status: "approved",
      checked_in_at: "not a date",
    });
    expect(guest?.checkedInAt).toBeNull();
  });
});

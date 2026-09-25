import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin, originIsPublic, publicOrigin } from "@/lib/app-url";
import { maySendMail } from "@/lib/mail";
import { rejectWeakSecret } from "@/lib/session";
import { expiredLinkPath, maskEmail, safeNextPath, slugify } from "@/lib/utils";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeNextPath", () => {
  it("keeps plain paths on this site", () => {
    expect(safeNextPath("/e/night/status")).toBe("/e/night/status");
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("/")).toBe("/");
  });

  it("refuses anything a browser could read as another site", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "/%2F%2Fevil.com",
      "javascript:alert(1)",
      "evil.com",
      "",
      null,
      undefined,
    ]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });

  it("sends an expired link back to the event it was for", () => {
    expect(expiredLinkPath("/e/night/status")).toBe("/e/night?error=expired");
    expect(expiredLinkPath("/admin")).toBe("/signin?next=%2Fadmin&error=expired");
    expect(expiredLinkPath("//evil.com")).toBe("/?error=expired");
  });
});

describe("small helpers", () => {
  it("slugify makes readable, safe slugs", () => {
    expect(slugify("Build Night: Skopje #3")).toBe("build-night-skopje-3");
    expect(slugify("Čaj & Kod")).toBe("caj-kod");
    expect(slugify("!!!")).toBe("event");
    expect(slugify("x".repeat(100))).toHaveLength(60);
  });

  it("maskEmail hides most of the address", () => {
    expect(maskEmail("stefan@example.com")).toBe("st••••@example.com");
    expect(maskEmail("not-an-email")).toBe("•••");
  });
});

describe("app address", () => {
  it("prefers APP_URL, then Render's address, and trims a trailing slash", () => {
    vi.stubEnv("APP_URL", "https://stamp.example.com/");
    expect(appOrigin()).toBe("https://stamp.example.com");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://stamp.onrender.com");
    expect(appOrigin()).toBe("https://stamp.onrender.com");
  });

  it("refuses to build links to localhost in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://localhost:3002");
    vi.stubEnv("RENDER_EXTERNAL_URL", "");
    expect(() => appOrigin()).toThrow(/APP_URL/);
    vi.stubEnv("APP_URL", "");
    expect(() => appOrigin()).toThrow(/APP_URL/);
  });

  it("falls back to localhost on a laptop, but never calls that public", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "");
    expect(appOrigin()).toBe("http://localhost:3002");
    expect(publicOrigin()).toBe("http://localhost:3002");
    expect(originIsPublic()).toBe(false);
  });
});

describe("mail gate", () => {
  it("only sends from Render, with a public address and a key", () => {
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("APP_URL", "https://stamp.example.com");
    vi.stubEnv("RESEND_API_KEY", "re_123");
    expect(maySendMail()).toBe(true);

    vi.stubEnv("RENDER", "");
    expect(maySendMail()).toBe(false);

    vi.stubEnv("RENDER", "true");
    vi.stubEnv("APP_URL", "http://localhost:3002");
    expect(maySendMail()).toBe(false);

    vi.stubEnv("APP_URL", "https://stamp.example.com");
    vi.stubEnv("RESEND_API_KEY", "  ");
    expect(maySendMail()).toBe(false);
  });
});

describe("AUTH_SECRET strength", () => {
  it("rejects placeholders, short values, and low-variety values", () => {
    expect(() => rejectWeakSecret("changeme")).toThrow(/placeholder/);
    expect(() => rejectWeakSecret("abc123")).toThrow(/at least 32/);
    expect(() => rejectWeakSecret("a".repeat(64))).toThrow(/variety/);
  });

  it("accepts a random hex secret", () => {
    expect(() =>
      rejectWeakSecret("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"),
    ).not.toThrow();
  });
});

/**
 * Everything the end-to-end suite runs against: its own database, its own
 * app port, a fake Luma, and a mail outbox file instead of a terminal. None of
 * it overlaps with `npm run dev`, so tests can run while you work.
 */
import "dotenv/config";
import path from "node:path";

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set, so there is no server to put the test database on.");
  const url = new URL(base);
  url.pathname = "/ambassadors_test";
  return url.toString();
}

export const APP_PORT = 3100;
export const FAKE_LUMA_PORT = 3199;
export const APP_URL = `http://localhost:${APP_PORT}`;
export const FAKE_LUMA_URL = `http://localhost:${FAKE_LUMA_PORT}`;
export const ADMIN_EMAIL = "admin@test.local";
export const STATE_DIR = path.join(process.cwd(), "tests", ".state");
export const OUTBOX = path.join(STATE_DIR, "outbox.jsonl");
export const DATABASE_URL = testDatabaseUrl();

export const APP_ENV: Record<string, string> = {
  DATABASE_URL,
  NEXT_DIST_DIR: ".next-test",
  APP_URL,
  AUTH_SECRET: "test-only-secret-7c1f0e9a4b2d8c6e5f3a1b0c9d8e7f6a5b4c3d2e1f0a9b8c",
  ADMIN_EMAILS: ADMIN_EMAIL,
  LUMA_API_URL: FAKE_LUMA_URL,
  LUMA_API_KEY: "test-luma-key",
  MAIL_OUTBOX: OUTBOX,
  RESEND_API_KEY: "",
  RENDER: "",
  RENDER_EXTERNAL_URL: "",
};

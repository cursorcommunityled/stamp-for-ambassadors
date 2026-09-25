import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import pg from "pg";
import { APP_ENV, DATABASE_URL, OUTBOX, STATE_DIR } from "./env";

/** A fresh, migrated, seeded test database for every run. */
export default async function globalSetup() {
  mkdirSync(STATE_DIR, { recursive: true });
  rmSync(OUTBOX, { force: true });

  const url = new URL(DATABASE_URL);
  const database = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();

  const env = { ...process.env, ...APP_ENV };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (rows.length > 0) {
    await client.query(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
  await client.end();

  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}

import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForDb = globalThis as unknown as {
  pool?: pg.Pool;
  prisma?: PrismaClient;
};

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:start`.",
    );
  }

  const pool =
    globalForDb.pool ??
    new pg.Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 10_000,
      // A room full of people opening the page at once should queue, then
      // fail and let the watcher retry, rather than hold a slot forever.
      connectionTimeoutMillis: 10_000,
    });

  // node-postgres emits 'error' on idle clients, and an unhandled 'error'
  // event takes the whole process down. Postgres dropping an idle connection
  // is routine; the server going down mid-event because of it is not.
  if (pool.listenerCount("error") === 0) {
    pool.on("error", (error) => {
      console.error("[stamp] idle database client:", error.message);
    });
  }

  globalForDb.pool = pool;
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const db = globalForDb.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForDb.prisma = db;

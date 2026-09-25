/**
 * Creates the app and shadow databases on a running Postgres server.
 *
 * `prisma dev` hands out a connection string pointing at `template1`, which is
 * the database Postgres copies when creating new ones. Putting application
 * tables there would leak them into every future database on the server.
 */
import "dotenv/config";
import pg from "pg";

function parse(name) {
  const raw = process.env[name];
  if (!raw) {
    console.error(`${name} is not set. Copy .env.example to .env first.`);
    process.exit(1);
  }
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    console.error(`${name} has no database name in its path.`);
    process.exit(1);
  }
  url.pathname = "/template1";
  return { adminUrl: url.toString(), database };
}

const targets = [parse("DATABASE_URL")];
if (process.env.SHADOW_DATABASE_URL) targets.push(parse("SHADOW_DATABASE_URL"));

const client = new pg.Client({ connectionString: targets[0].adminUrl });

try {
  await client.connect();
} catch (err) {
  console.error(
    `Could not reach Postgres. Is it running? Try: npm run db:start\n\n${err.message}`,
  );
  process.exit(1);
}

for (const { database } of targets) {
  const { rows } = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [database],
  );
  if (rows.length > 0) {
    console.log(`database "${database}" already exists`);
    continue;
  }
  await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
  console.log(`created database "${database}"`);
}

await client.end();
console.log("\nNext: npm run db:migrate && npm run db:seed");

import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * HQ partners only. Local sponsors are added on the event page: a name and
 * a pasted list of codes. A starter catalog full of another city's portals
 * would show up on the status page the moment those rows had instructions.
 *
 * `perk` is the offer at a glance. `instructions` are only things the
 * attendee does. Neither is filled in here: a real offer is typed on the
 * event page and stored in that deploy's database. A code partner with no
 * codes on this event stays off the status page. A guide is a how-to with
 * no codes, and shows for every stamped guest.
 */
const SPONSORS: {
  slug: string;
  name: string;
  sortOrder: number;
}[] = [
  {
    slug: "cursor",
    name: "Cursor",
    sortOrder: 0,
  },
];

async function main() {
  for (const sponsor of SPONSORS) {
    await prisma.sponsor.upsert({
      where: { slug: sponsor.slug },
      create: sponsor,
      update: {
        name: sponsor.name,
        sortOrder: sponsor.sortOrder,
      },
    });
    console.log(`sponsor: ${sponsor.slug}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

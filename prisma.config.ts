import path from "node:path";
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(import.meta.dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(import.meta.dirname, "prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});

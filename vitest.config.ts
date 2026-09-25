import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.join(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Modules like claim.ts build a Prisma client on import. It never
    // connects unless queried, but it wants a URL to hold.
    env: { DATABASE_URL: "postgresql://unit:unit@localhost:1/unit" },
  },
});

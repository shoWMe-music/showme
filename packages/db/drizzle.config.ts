import { defineConfig } from "drizzle-kit";

/**
 * Migration config. The connection string comes from the environment (never
 * committed); `drizzle-kit generate` reads the schema and emits SQL to
 * `./migrations`, which CI applies via `drizzle-kit migrate`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  casing: "snake_case",
});

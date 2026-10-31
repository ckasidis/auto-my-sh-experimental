import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes the migrations the `UserStore` Durable Object applies when it starts.
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});

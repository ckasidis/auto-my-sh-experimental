import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, type Plugin } from "vite-plus";

/**
 * drizzle-kit's `drizzle/migrations.js` imports each migration's `.sql` file. The Cloudflare plugin bundles those as Text modules;
 * tests in Node load them as strings.
 */
const sqlText = (): Plugin => ({
  name: "sql-text",
  enforce: "pre",
  async load(id) {
    if (!id.endsWith(".sql")) return null;

    return `export default ${JSON.stringify(await readFile(id, "utf8"))};`;
  },
});

// Unit tests run in Node and need no Workers runtime or remote bindings.
export default defineConfig({
  plugins: process.env.VITEST ? [sqlText()] : [cloudflare()],
  test: {
    alias: {
      "cloudflare:workers": fileURLToPath(import.meta.resolve("./test/cloudflare-workers.ts")),
    },
  },
});

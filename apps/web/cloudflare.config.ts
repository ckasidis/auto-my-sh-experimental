import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/server.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "auto-my-sh-web",
    compatibilityDate: "2026-10-20",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    observability: {
      enabled: true,
      logs: { enabled: true },
      traces: { enabled: true },
    },
    // The bot's menu button (or Main Mini App) URL in @BotFather.
    domains: ["app.automysh.com"],
    env: {
      // The assistant Worker, over Worker RPC: it checks the Mini App's `initData` and serves the owner's data, so this
      // Worker holds no secrets. `env.ts` types it. Bound by name: importing the assistant's definition would
      // type-check its whole module graph against this Worker's `Env`.
      ASSISTANT: bindings.worker({ worker: "auto-my-sh-assistant" }),
    },
  },
});

import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/server.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "auto-my-sh-assistant",
    compatibilityDate: "2026-10-20",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    // Every request is sampled; one owner's traffic is small.
    observability: {
      enabled: true,
      logs: { enabled: true },
      traces: { enabled: true },
    },
    // Telegram's webhook. Custom domain on a zone in this account; deploy creates its DNS record and certificate.
    domains: ["api.automysh.com"],
    exports: {
      // Reached through `exports` from `cloudflare:workers`, so no binding is needed.
      Assistant: exports.durableObject({ storage: "sqlite" }),
      UserStore: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      AI: bindings.ai(),
      // IANA time zone used to show times and interpret "tomorrow at 9".
      TIMEZONE: bindings.text("Asia/Singapore"),
      // Token from @BotFather.
      TELEGRAM_BOT_TOKEN: bindings.secret(),
      // Sent back by Telegram in `X-Telegram-Bot-Api-Secret-Token` on every update.
      TELEGRAM_WEBHOOK_SECRET: bindings.secret(),
      // The owner's private chat id (equal to their user id); every other chat is refused.
      TELEGRAM_CHAT_ID: bindings.secret(),
    },
  },
});

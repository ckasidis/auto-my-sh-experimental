/**
 * Registers the bot's commands with Telegram (`setMyCommands`), for the command menu. Run it after changing
 * `COMMANDS`: `pnpm telegram:commands`. It reads `TELEGRAM_BOT_TOKEN` from the environment, or from `.env`.
 */
import { existsSync } from "node:fs";
import { COMMANDS } from "../src/commands.ts";

if (process.env.TELEGRAM_BOT_TOKEN === undefined && existsSync(".env")) process.loadEnvFile(".env");

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN, or add it to apps/assistant/.env");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands: COMMANDS }),
});

const result: { ok: boolean; description?: string } = await response.json();

if (!result.ok) {
  console.error(`Telegram refused the commands: ${result.description ?? response.status}`);
  process.exit(1);
}

console.log(`Registered ${COMMANDS.map(({ command }) => `/${command}`).join(", ")}`);

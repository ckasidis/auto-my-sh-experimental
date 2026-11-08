/**
 * The bot's commands, which the chat handles itself instead of passing to the model, with the descriptions
 * Telegram's command menu shows. `pnpm telegram:commands` registers them; it imports this file, so it imports nothing.
 */
export const COMMANDS = [
  { command: "clear", description: "Clear session memory: forget the conversation so far" },
] as const;

export type Command = (typeof COMMANDS)[number]["command"];

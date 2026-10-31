import { env } from "cloudflare:workers";
import { defineExtension, GenerationTask, hook, section } from "@earendil-works/pi-durable";
import { Api } from "grammy";
import {
  createDraftStream,
  createReplyHook,
  createTelegramChannel,
  ownerSurface,
} from "./telegram.ts";

const telegramApi = new Api(env.TELEGRAM_BOT_TOKEN);

/** The bot as an Agents SDK Channel: webhook ingress for the gateway, grammY delivery for replies. */
export const telegramChannel = createTelegramChannel(telegramApi, env.TELEGRAM_BOT_TOKEN, {
  webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
  ownerId: env.TELEGRAM_CHAT_ID,
});

/** Draft previews of the answers being generated in the owner's chat; the assistant follows its conversation with it. */
export const ownerDrafts = createDraftStream(telegramApi, env.TELEGRAM_CHAT_ID);

/** The owner's local time with its weekday and offset, so relative days and times resolve without arithmetic. */
const localClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: env.TIMEZONE,
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

/** The owner's private chat: who the assistant is, the owner's clock, and the hook that sends every final answer. */
export const chatExtension = defineExtension({
  name: "chat",
  hooks: [
    createReplyHook(telegramChannel, ownerSurface(env.TELEGRAM_CHAT_ID), ownerDrafts),
    // A failed model request ends the run unanswered and is not reported, so log the provider's error.
    hook(GenerationTask, {
      afterResponse(message) {
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          console.error("model response failed", {
            model: message.model,
            stopReason: message.stopReason,
            error: message.errorMessage,
          });
        }
      },
    }),
  ],
  sections: [
    section(
      "preamble",
      () =>
        `You are a concise personal assistant in the owner's private Telegram chat. Your final answer is sent to the owner as a Telegram message, so write it in GitHub Flavored Markdown.

The owner's timezone is ${env.TIMEZONE}. Read the times the owner gives in it, and pass tools ISO 8601 times with its offset. Tools return UTC times; show them to the owner in their timezone.`,
      { tag: false },
    ),
    section(
      "clock",
      // Minute precision: finer values would append a system-prompt delta on every request.
      () =>
        `Current time: ${localClock.format(new Date())} (${new Date().toISOString().slice(0, 16)}Z).`,
      { tag: false },
    ),
  ],
});

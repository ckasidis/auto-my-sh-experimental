import {
  type DocumentWatch,
  GenerationTask,
  hook,
  type HookRegistration,
  LiveDoc,
  type LiveState,
  type TaskId,
} from "@earendil-works/pi-durable";
import {
  type Channel,
  type ChannelMessage,
  type ChannelMessageSurface,
  type DeliveryResult,
  type ParticipantResult,
} from "agents/experimental/channels";
import { telegram, type TelegramUpdate } from "agents/experimental/channels/telegram";
import { type Api, GrammyError } from "grammy";
import { Type } from "typebox";
import { Value } from "typebox/value";

/** The key the gateway knows the Telegram Channel by; it is stamped on every Telegram surface. */
export const TELEGRAM_CHANNEL = "telegram";

/** The webhook path registered with Telegram through `setWebhook` (see the README). */
export const WEBHOOK_PATH = "/telegram/webhook";

/** The single agent object, and participant, every owner message reaches; the owner's `UserStore` shares its name. */
export const OWNER = "owner";

/** Telegram rejects plain-text messages longer than this. */
const MAX_MESSAGE_LENGTH = 4096;

/** Telegram rejects rich messages longer than this. */
const MAX_RICH_MESSAGE_LENGTH = 32768;

/** Memo of the generation task that claims its answer's delivery, so a replayed answer is not posted twice. */
const REPLY_MEMO = "telegram.reply";

type TelegramChannelOptions = {
  readonly webhookSecret: string;
  /** The owner's user id, equal to their private chat id; every other sender is dropped. */
  readonly ownerId: string;
};

/** The part of a Telegram surface's address this Channel reads; the SDK's surfaces carry more. */
const TelegramAddress = Type.Object({ chatId: Type.String({ minLength: 1 }) });

/**
 * The Agents SDK Telegram Channel with delivery: its own webhook ingress (secret check and update parsing), the owner
 * as the only participant, and `deliver` through grammY, which the SDK's Channel leaves out. Answers are not streamed.
 */
export function createTelegramChannel(
  api: Api,
  token: string,
  options: TelegramChannelOptions,
): Channel<TelegramUpdate> {
  return {
    ...telegram({
      botToken: token,
      webhook: { secretToken: options.webhookSecret, path: WEBHOOK_PATH },
      participant: (_event, update) => ownerParticipant(update, options.ownerId),
      route: () => OWNER,
    }),
    deliver: (surface, message) => deliver(api, surface, message),
  };
}

/** Only a private text message the owner sent; an edit or any other chat is refused. */
function ownerParticipant(update: TelegramUpdate, ownerId: string): ParticipantResult {
  const message = update.message;

  if (message?.chat.type !== "private" || String(message.from?.id) !== ownerId) return null;

  return OWNER;
}

/** The owner's private chat as a surface, for answers no inbound message asked for, such as scheduled ones. */
export function ownerSurface(ownerId: string): ChannelMessageSurface {
  return {
    channelKey: TELEGRAM_CHANNEL,
    version: 1,
    address: { chatId: ownerId },
    label: `Telegram · user ${ownerId}`,
  };
}

/**
 * Sends Rich Markdown (Bot API 10.1), split into several messages when it is longer than Telegram allows. A chunk
 * Telegram rejects (bad markup, too many blocks) is sent again as plain text, so a bad markup never loses a reply.
 */
async function deliver(
  api: Api,
  surface: ChannelMessageSurface,
  message: ChannelMessage,
): Promise<DeliveryResult> {
  const address = surface.address;

  if (!Value.Check(TelegramAddress, address)) return invalidSurface();

  const markdown =
    message.title === undefined ? message.markdown : `**${message.title}**\n\n${message.markdown}`;

  let sent = 0;

  try {
    for (const chunk of splitText(markdown, MAX_RICH_MESSAGE_LENGTH)) {
      try {
        await api.sendRichMessage(address.chatId, { markdown: chunk });
        sent++;
      } catch (error) {
        if (!(error instanceof GrammyError && error.error_code === 400)) throw error;

        for (const plain of splitText(chunk)) {
          await api.sendMessage(address.chatId, plain, {
            link_preview_options: { is_disabled: true },
          });
          sent++;
        }
      }
    }

    return { status: "delivered" };
  } catch (error) {
    // Telegram answered with an error code, or the request never got an answer.
    const code = error instanceof GrammyError ? error.error_code : undefined;

    const failure = {
      code: code === undefined ? "TELEGRAM_NETWORK" : `TELEGRAM_${code}`,
      message: error instanceof Error ? error.message : String(error),
    };

    // Some messages reached the chat: another attempt could repeat them.
    if (sent > 0) return { status: "uncertain", error: failure };

    return {
      status: "failed",
      retryable: code === undefined || code === 429 || code >= 500,
      error: failure,
    };
  }
}

function invalidSurface(): DeliveryResult {
  return {
    status: "failed",
    retryable: false,
    error: { code: "CHANNEL_SURFACE_INVALID", message: "The surface names no Telegram chat" },
  };
}

/** Splits text into chunks Telegram accepts, preferring paragraph, then line breaks. */
export function splitText(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  const trimmed = text.trim() || "…";
  const chunks: string[] = [];
  let rest = trimmed;

  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);

    if (cut < limit / 2) cut = rest.lastIndexOf("\n", limit);

    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);

    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  chunks.push(rest);

  return chunks;
}

/** Draft previews of the answers being generated, for one private chat. */
type DraftStream = {
  /** Previews every partial answer `live` commits, until Pi closes the watch. */
  follow(live: DocumentWatch<LiveState>): void;
  /**
   * Ends the previews of the run `runTaskId` (`LiveState.run.taskId`), once any draft being sent has landed, so no
   * draft can follow the final message. Later partials of that run are ignored.
   */
  close(runTaskId: TaskId | undefined): Promise<void>;
};

/**
 * Streams each answer while it is generated. Pi commits a throttled partial of the in-flight response to `LiveDoc`
 * (`progress.partialIntervalMs`), and each new one replaces a Rich Markdown draft (`sendRichMessageDraft`, private
 * chats only) in `chatId`. Only the answer's text is shown, not tool calls. The reply hook still sends the final
 * answer as a message, which clients show in the draft's place. A draft is only a preview, so a failed one (markup
 * cut mid-element, flood control) is logged and skipped.
 */
export function createDraftStream(api: Api, chatId: string): DraftStream {
  const chat = Number(chatId);
  let draftId: number | undefined;
  let previewed = "";
  let closedRun: TaskId | undefined;
  let sending = Promise.resolve();

  const reset = () => {
    draftId = undefined;
    previewed = "";
  };

  return {
    follow(live) {
      live.start(async (state) => {
        if (state === null) return;

        const run = state.run;

        // Idle: the run ended without a final answer (an error, an abort), so the next one starts afresh.
        if (run === undefined) {
          reset();

          return;
        }

        if (run.taskId === closedRun) return;

        const markdown = (state.generation?.message?.content ?? [])
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("")
          .trim();

        if (markdown.length === 0 || markdown === previewed) return;
        previewed = markdown;
        draftId ??= crypto.getRandomValues(new Uint32Array(1))[0]! + 1;

        sending = api
          .sendRichMessageDraft(chat, draftId, {
            markdown: markdown.slice(0, MAX_RICH_MESSAGE_LENGTH),
          })
          .then(
            () => {},
            (error) =>
              console.warn(
                "telegram draft not sent",
                error instanceof GrammyError ? error.description : String(error),
              ),
          );

        await sending;
      });
    },
    async close(runTaskId) {
      closedRun = runTaskId;
      reset();
      await sending;
    },
  };
}

/**
 * Delivers every final answer, owner-prompted or scheduled, to `surface`. The generation task's memo claims the
 * delivery first: Telegram cannot recognise a repeated send, so a replayed answer is never posted again, and an
 * eviction mid-send loses the reply rather than doubling it. The run's draft previews end first, so none follows the
 * message. A failed delivery is logged and does not fail the run.
 */
export function createReplyHook(
  channel: Channel,
  surface: ChannelMessageSurface,
  drafts: DraftStream,
): HookRegistration {
  return hook(GenerationTask, {
    async onYield(answer, api, context) {
      const markdown = answer.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
        .trim();

      if (markdown.length === 0) return undefined;
      const claim = crypto.randomUUID();

      if ((await api.memo(REPLY_MEMO, claim, context)) !== claim) return undefined;

      const live = await api.snapshot(LiveDoc, api.conversationId, context);

      await drafts.close(live?.run?.taskId);
      const result = await channel.deliver!(surface, { markdown });

      if (result.status !== "delivered") console.error("telegram reply not delivered", result);

      return undefined;
    },
  });
}

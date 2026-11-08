import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Type } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  Harness,
  LiveDoc,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import {
  type Channel,
  ChannelGateway,
  type ChannelMessage,
  type ChannelMessageSurface,
  type GatewayEvent,
} from "agents/experimental/channels";
import { Api } from "grammy";
import { describe, expect, it } from "vite-plus/test";
import {
  createDraftStream,
  createReplyHook,
  createTelegramChannel,
  ownerSurface,
  parseCommand,
  splitText,
  WEBHOOK_PATH,
} from "../src/telegram.ts";

const OWNER_ID = "42";
const SECRET = "s3cret";
const TOKEN = "123456:TEST";

type Call = { readonly method: string; readonly payload: unknown };

/** An Api whose calls never leave the process: each is recorded and answered with `status`. */
const recordingApi = (status: (method: string, calls: number) => number) => {
  const calls: Call[] = [];
  const api = new Api(TOKEN);

  api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const code = status(method, calls.length);

    // SAFETY: the code under test reads no result, only whether the call failed.
    return (
      code === 200
        ? { ok: true, result: { message_id: calls.length } }
        : { ok: false, error_code: code, description: `Error ${code}` }
    ) as never;
  });

  return { api, calls };
};

const channelWith = (status: (method: string, calls: number) => number) => {
  const { api, calls } = recordingApi(status);
  const channel = createTelegramChannel(api, TOKEN, { webhookSecret: SECRET, ownerId: OWNER_ID });

  return { api, channel, calls };
};

const deliver = (channel: Channel, message: ChannelMessage, surface = ownerSurface(OWNER_ID)) =>
  channel.deliver!(surface, message);

const update = (fromId: number, chatType = "private") => ({
  update_id: 7,
  message: {
    message_id: 3,
    date: 0,
    chat: { id: fromId, type: chatType, first_name: "x" },
    from: { id: fromId, is_bot: false, first_name: "x" },
    text: "hi",
  },
});

type TestUpdate = ReturnType<typeof update>;

const webhook = (body: TestUpdate, secret = SECRET) =>
  new Request(`https://bot.example${WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });

describe("splitText", () => {
  it("keeps short text whole", () => {
    expect(splitText("hello")).toEqual(["hello"]);
  });

  it("never sends an empty message", () => {
    expect(splitText("   ")).toEqual(["…"]);
  });

  it("splits on line breaks within the limit", () => {
    const text = `${"a".repeat(8)}\n${"b".repeat(8)}`;
    expect(splitText(text, 10)).toEqual(["a".repeat(8), "b".repeat(8)]);
  });

  it("prefers paragraph breaks", () => {
    expect(splitText("aaaaaa\n\nb\ncc", 10)).toEqual(["aaaaaa", "b\ncc"]);
  });

  it("hard-splits text without break points", () => {
    expect(splitText("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });
});

describe("Telegram ingress through the Channels gateway", () => {
  const gatewayWith = () => {
    const received: GatewayEvent[] = [];
    const { channel } = channelWith(() => 200);

    const gateway = new ChannelGateway({
      channels: { telegram: channel },
      agent: (route) => {
        expect(route).toBe("owner");

        return {
          receive: async (event) => {
            received.push(event);
          },
          fetch: async () => new Response(null, { status: 404 }),
        };
      },
    });

    return { gateway, received };
  };

  it("hands the owner's private message to the assistant", async () => {
    const { gateway, received } = gatewayWith();

    expect((await gateway.fetch(webhook(update(Number(OWNER_ID)))))?.status).toBe(200);
    expect(received).toEqual([
      expect.objectContaining({
        type: "message",
        message: expect.objectContaining({ parts: [{ type: "text", text: "hi" }] }),
      }),
    ]);
  });

  it("acknowledges and drops anyone else, and group chats", async () => {
    const { gateway, received } = gatewayWith();

    expect((await gateway.fetch(webhook(update(7))))?.status).toBe(200);
    expect((await gateway.fetch(webhook(update(Number(OWNER_ID), "group"))))?.status).toBe(200);
    expect(received).toEqual([]);
  });

  it("refuses a request without the webhook secret", async () => {
    const { gateway, received } = gatewayWith();

    expect((await gateway.fetch(webhook(update(Number(OWNER_ID)), "nope")))?.status).toBe(401);
    expect(received).toEqual([]);
  });

  it("leaves other paths to the Worker", async () => {
    const { gateway } = gatewayWith();

    expect(await gateway.fetch(new Request("https://bot.example/"))).toBeUndefined();
  });
});

describe("Telegram delivery", () => {
  it("sends Rich Markdown to the surface's chat", async () => {
    const { channel, calls } = channelWith(() => 200);

    expect(await deliver(channel, { markdown: "# Hi" })).toEqual({ status: "delivered" });
    expect(calls).toEqual([
      {
        method: "sendRichMessage",
        payload: { chat_id: OWNER_ID, rich_message: { markdown: "# Hi" } },
      },
    ]);
  });

  it("puts a title above the message", async () => {
    const { channel, calls } = channelWith(() => 200);

    await deliver(channel, { title: "Reminder", markdown: "Stretch" });
    expect(calls[0]!.payload).toMatchObject({
      rich_message: { markdown: "**Reminder**\n\nStretch" },
    });
  });

  it("falls back to plain text, split to Telegram's limit, when Telegram rejects the markup", async () => {
    const { channel, calls } = channelWith((method) => (method === "sendRichMessage" ? 400 : 200));

    expect(await deliver(channel, { markdown: `${"a".repeat(4000)}\n${"b".repeat(200)}` })).toEqual(
      { status: "delivered" },
    );
    expect(calls.map(({ method }) => method)).toEqual([
      "sendRichMessage",
      "sendMessage",
      "sendMessage",
    ]);
    expect(calls[1]!.payload).toMatchObject({ link_preview_options: { is_disabled: true } });
  });

  it("reports a server error as a retryable failure, without falling back", async () => {
    const { channel, calls } = channelWith(() => 500);

    expect(await deliver(channel, { markdown: "x" })).toMatchObject({
      status: "failed",
      retryable: true,
      error: { code: "TELEGRAM_500" },
    });
    expect(calls.map(({ method }) => method)).toEqual(["sendRichMessage"]);
  });

  it("reports a refused chat as a final failure", async () => {
    const { channel } = channelWith((method) => (method === "sendMessage" ? 403 : 400));

    expect(await deliver(channel, { markdown: "x" })).toMatchObject({
      status: "failed",
      retryable: false,
      error: { code: "TELEGRAM_403" },
    });
  });

  it("reports a message cut off part-way as uncertain", async () => {
    const { channel } = channelWith((_method, call) => (call === 1 ? 200 : 500));
    const long = `${"a".repeat(30000)}\n\n${"b".repeat(5000)}`;

    expect(await deliver(channel, { markdown: long })).toMatchObject({ status: "uncertain" });
  });

  it("refuses a surface that names no chat", async () => {
    const { channel, calls } = channelWith(() => 200);
    const surface: ChannelMessageSurface = { ...ownerSurface(OWNER_ID), address: { user: 1 } };

    expect(await deliver(channel, { markdown: "x" }, surface)).toMatchObject({
      status: "failed",
      error: { code: "CHANNEL_SURFACE_INVALID" },
    });
    expect(calls).toEqual([]);
  });
});

describe("reply hook", () => {
  it("sends the final answer to the owner's chat once", async () => {
    const context = BACKGROUND_CONTEXT;
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText("Stretch now.")])]);
    const models = createModels();
    models.setProvider(faux.provider);
    const { api, channel, calls } = channelWith(() => 200);
    const registry = createRegistry();

    registry.install(
      defineExtension({
        name: "chat",
        hooks: [createReplyHook(channel, ownerSurface(OWNER_ID), createDraftStream(api, OWNER_ID))],
      }),
    );

    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);

    try {
      const root = await harness.root(context);
      await root.configure({ model: { provider: "faux", modelId: "faux-1" } }, context);

      const submission = await root.submit(
        { type: "input", content: "Remind me", requestId: "r1" },
        context,
      );

      await submission.wait(context);
      expect(calls).toEqual([
        {
          method: "sendRichMessage",
          payload: { chat_id: OWNER_ID, rich_message: { markdown: "Stretch now." } },
        },
      ]);
    } finally {
      await harness.close(context);
    }
  });

  it("streams the answer as drafts, without tool calls, then sends the final message after the last draft", async () => {
    const context = BACKGROUND_CONTEXT;
    // Slow enough for several partial commits per answer.
    const faux = fauxProvider({ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } });
    faux.setResponses([
      fauxAssistantMessage([fauxText("Checking."), fauxToolCall("lookup", {})], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("Stretch now, then drink some water.")]),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const { api, channel, calls } = channelWith(() => 200);
    const drafts = createDraftStream(api, OWNER_ID);
    const registry = createRegistry();

    const lookup = {
      name: "lookup",
      description: "Look something up.",
      parameters: Type.Object({}),
      execute: async () => ({ output: [{ type: "text" as const, text: "found" }] }),
    };

    registry.install(
      defineExtension({
        name: "chat",
        tools: [lookup],
        hooks: [createReplyHook(channel, ownerSurface(OWNER_ID), drafts)],
      }),
    );

    const harness = await Harness.open(
      new MemoryStorage(),
      { models, registry, settings: { progress: { partialIntervalMs: 10 } } },
      context,
    );

    try {
      const root = await harness.root(context);
      await root.configure(
        { model: { provider: "faux", modelId: "faux-1" }, tools: [lookup] },
        context,
      );
      drafts.follow((await harness.watchDoc(LiveDoc, root.id, context))!);

      await (
        await root.submit({ type: "input", content: "Remind me", requestId: "r1" }, context)
      ).wait(context);

      const draftCalls = calls.filter(({ method }) => method === "sendRichMessageDraft");

      // SAFETY: drafts are sent with these payload fields.
      const payloads = draftCalls.map(
        ({ payload }) =>
          payload as { chat_id: number; draft_id: number; rich_message: { markdown: string } },
      );

      const markdowns = payloads.map(({ rich_message }) => rich_message.markdown);

      expect(new Set(payloads.map(({ chat_id, draft_id }) => `${chat_id}/${draft_id}`)).size).toBe(
        1,
      );
      expect(payloads[0]!.chat_id).toBe(Number(OWNER_ID));
      expect(markdowns.some((markdown) => markdown.startsWith("Stretch"))).toBe(true);
      expect(markdowns.some((markdown) => markdown.includes("lookup"))).toBe(false);
      expect(calls.at(-1)).toEqual({
        method: "sendRichMessage",
        payload: {
          chat_id: OWNER_ID,
          rich_message: { markdown: "Stretch now, then drink some water." },
        },
      });
    } finally {
      await harness.close(context);
    }
  });
});

describe("parseCommand", () => {
  it("reads a known command, with or without the bot's name, and nothing else", () => {
    expect(parseCommand("/clear")).toBe("clear");
    expect(parseCommand(" /CLEAR@MyAssistantBot ")).toBe("clear");
    expect(parseCommand("/clear the todos")).toBeUndefined();
    expect(parseCommand("/start")).toBeUndefined();
    expect(parseCommand("clear")).toBeUndefined();
  });
});

import { DurableObject, exports } from "cloudflare:workers";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, LiveDoc } from "@earendil-works/pi-durable";
import type { GatewayEvent } from "agents/experimental/channels";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { CLOUDFLARE_PROVIDER_ID, createAI } from "agents/models/pi-ai";
import { chatExtension, ownerDrafts } from "./chat.ts";
import {
  addSchedule,
  cancelSchedule,
  listSchedules,
  type Schedule,
  type ScheduleRequest,
  schedulesExtension,
} from "./schedule.ts";
import { OWNER } from "./telegram.ts";
import { todosExtension } from "./todos.ts";

// Available on the Workers Free plan, which rejects models marked `require_workers_paid` (such as GLM 5.3).
const MODEL_ID = "@cf/zai-org/glm-4.7-flash";

const EXTENSIONS = [chatExtension, schedulesExtension, todosExtension];

/** The owner's `Assistant` object. Resolve it at each use: a stub is cheap, and a call reaches the object only then. */
export const assistant = () => exports.Assistant.getByName(OWNER);

/**
 * The owner's assistant: one Durable Object for the one private chat. The Channels gateway hands it the owner's
 * messages; Pi runs the conversation through `PiHarness` with the chat, schedules, and todos extensions, and the chat
 * extension sends each final answer back. Its schedule methods are the Mini App's way to the chat's schedules.
 */
export class Assistant extends DurableObject<Env> {
  readonly ai = createAI({ binding: this.env.AI });
  readonly registry = createRegistry();

  readonly harness = new PiHarness({
    harness: async ({ storage, context, onWake }) => {
      const models = createModels();
      models.setProvider(this.ai.provider);

      const pi = await Harness.open(
        storage,
        {
          models,
          registry: this.registry,
          settings: {
            extensions: EXTENSIONS,
            // Retention timers are active Durable Object references and prevent hibernation.
            documentRetentionMs: 0,
            // Each partial answer is a storage write and a Telegram draft; Telegram asks for at most one send per
            // second in a chat.
            progress: { partialIntervalMs: 1000 },
          },
          onWake,
          onReport: (error, info) => console.error("pi report", info.type, error),
        },
        context,
      );

      const root = await pi.root(context);

      // `defaults` apply only when a session is created; keep the existing root conversation on `MODEL_ID` too.
      await root.configure(
        { model: { provider: CLOUDFLARE_PROVIDER_ID, modelId: MODEL_ID }, thinkingLevel: "off" },
        context,
      );

      // Stream answers as drafts while Pi is open; `context` is the background context, so the watch lasts until
      // Pi closes. A conversation that has never run has no live state yet; it streams from the next open.
      const live = await pi.watchDoc(LiveDoc, root.id, context);

      if (live !== undefined) ownerDrafts.follow(live);

      return pi;
    },
    defaults: { model: this.ai(MODEL_ID), thinkingLevel: "off" },
  });

  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    for (const extension of EXTENSIONS) this.registry.install(extension);
  }

  /** One owner event from the Channels gateway. Resolves once a message is durably submitted. */
  async receive(event: GatewayEvent): Promise<void> {
    if (event.type !== "message") return;

    const text = event.message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();

    if (!text) return;

    // The event id is derived from the Telegram update, so a redelivered webhook is the same submission.
    const receipt = await this.harness.submit(text, { operationId: event.eventId });

    // An unanswered run (no model, a model error) sends nothing, so record how Pi settled each message.
    this.ctx.waitUntil(
      this.harness.wait(receipt.operationId).then(
        ({ status, reason }) => console.log("pi operation settled", { status, reason }),
        (error) => console.error("pi operation wait failed", error),
      ),
    );
  }

  /** The chat's scheduled instructions still to be delivered, soonest first. */
  async listSchedules(): Promise<Schedule[]> {
    return listSchedules(await this.harness.pi(), BACKGROUND_CONTEXT);
  }

  /** Schedules an instruction as the chat's `schedule` tool does; a retry with the same id is the same schedule. */
  async addSchedule(request: ScheduleRequest): Promise<Schedule> {
    return addSchedule(await this.harness.pi(), request, BACKGROUND_CONTEXT);
  }

  /** Cancels a scheduled instruction still to be delivered; false when none has this id. */
  async cancelSchedule(id: string): Promise<boolean> {
    return cancelSchedule(await this.harness.pi(), id, BACKGROUND_CONTEXT);
  }
}

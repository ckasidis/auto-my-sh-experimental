import { exports, WorkerEntrypoint } from "cloudflare:workers";
import { ChannelGateway } from "agents/experimental/channels";
import { assistant } from "./assistant.ts";
import { telegramChannel } from "./chat.ts";
import { verifyInitData } from "./init-data.ts";
import type { Schedule, ScheduleRequest } from "./schedule.ts";
import { TELEGRAM_CHANNEL, WEBHOOK_PATH } from "./telegram.ts";
import {
  type NewTodo,
  type Todo,
  type TodoChanges,
  type TodoFilter,
  userStore,
} from "./user-store.ts";

export { Assistant } from "./assistant.ts";

export { UserStore } from "./user-store.ts";

/**
 * The Telegram webhook, over HTTP, and, over RPC for the web Worker's service binding, the Mini App's owner check and
 * the owner's todos and schedules without the model; callers check the owner first. The RPC methods are reachable only through a service
 * binding, never from the internet. Web types the binding from this class's emitted declarations. The return types are
 * written out: inferred ones carry the Durable Object stubs' `Disposable`, and the binding's `Rpc` types turn a single
 * such object into `never`.
 */
export default class Server extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== WEBHOOK_PATH) {
      return new Response("Not found", { status: 404 });
    }

    // The gateway verifies the webhook secret, keeps only the owner's messages, and routes them to the assistant.
    // A failure answers 500, so Telegram redelivers; handling is idempotent per update.
    const gateway = new ChannelGateway({
      channels: { [TELEGRAM_CHANNEL]: telegramChannel },
      agent: (route) => exports.Assistant.getByName(route),
    });

    return (await gateway.fetch(request)) ?? new Response("Not found", { status: 404 });
  }

  /** Whether Telegram signed the Mini App's `initData` for the owner; the bot token never leaves this Worker. */
  async isOwner(initData: string): Promise<boolean> {
    const userId = await verifyInitData(initData, this.env.TELEGRAM_BOT_TOKEN, Date.now());

    return userId === this.env.TELEGRAM_CHAT_ID;
  }

  async listTodos(filter?: TodoFilter): Promise<Todo[]> {
    return userStore().list(filter);
  }

  async addTodo(todo: NewTodo): Promise<Todo> {
    return userStore().add(todo);
  }

  async updateTodo(id: string, changes: TodoChanges): Promise<Todo | null> {
    return userStore().update(id, changes);
  }

  async removeTodo(id: string): Promise<boolean> {
    return userStore().remove(id);
  }

  async listSchedules(): Promise<Schedule[]> {
    return assistant().listSchedules();
  }

  async addSchedule(request: ScheduleRequest): Promise<Schedule> {
    return assistant().addSchedule(request);
  }

  async cancelSchedule(id: string): Promise<boolean> {
    return assistant().cancelSchedule(id);
  }
}

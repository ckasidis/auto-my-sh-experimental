import { env } from "cloudflare:workers";
import { setResponseStatus } from "@tanstack/react-start/server";

/** The `Authorization` scheme the app sends Telegram's `initData` under. */
const SCHEME = "tma ";

/** Refuses the request unless it carries `initData` Telegram signed for the owner; the assistant Worker checks it. */
export async function authorizeOwner(authorization: string | undefined): Promise<void> {
  const initData = authorization?.startsWith(SCHEME) ? authorization.slice(SCHEME.length) : "";

  if (!(await env.ASSISTANT.isOwner(initData))) {
    setResponseStatus(401);

    throw new Error("Open the app from the owner's Telegram chat");
  }
}

/** The assistant Worker, over RPC: the todos and recipe book the chat's tools use, and the chat's schedules. */
export const owner = () => env.ASSISTANT;

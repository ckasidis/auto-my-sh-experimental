import handler from "@tanstack/react-start/server-entry";

/** Every request is the Mini App (TanStack Start). */
export default {
  async fetch(request): Promise<Response> {
    return handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;

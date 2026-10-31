import type Server from "assistant/server";

// The service binding to the assistant Worker, which `cloudflare.config.ts` declares by name.
declare global {
  namespace Cloudflare {
    interface Env {
      ASSISTANT: Service<Server>;
    }
  }
}

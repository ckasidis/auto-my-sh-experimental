import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

// TanStack Start renders in the Worker, which is Vite's `ssr` environment. Unit tests run in Node and need none of the
// app's plugins.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: process.env.VITEST
    ? []
    : [
        cloudflare({ viteEnvironment: { name: "ssr" } }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
      ],
});

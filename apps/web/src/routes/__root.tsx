import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
      },
      { title: "Auto-My-Sh" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

function Document({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Loaded before the app so `window.Telegram.WebApp` and its theme variables exist when it starts. */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

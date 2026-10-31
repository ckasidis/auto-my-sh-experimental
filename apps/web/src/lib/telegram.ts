/** The part of `window.Telegram.WebApp` (telegram-web-app.js, loaded by the root route) the app uses. */
type WebApp = {
  readonly initData: string;
  readonly colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  onEvent(event: "themeChanged", handler: () => void): void;
  readonly HapticFeedback?: {
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
};

declare global {
  interface Window {
    readonly Telegram?: { readonly WebApp?: WebApp };
  }
}

/** The Telegram client the app runs in; undefined when it is opened in a plain browser. */
export const webApp = (): WebApp | undefined => window.Telegram?.WebApp;

/** The signed launch data the server authorizes each call with; empty outside Telegram. */
export const launchData = (): string => webApp()?.initData ?? "";

/** Tells Telegram the app is ready, opens it full height, and follows the client's light or dark theme. */
export function startWebApp(): void {
  const app = webApp();

  if (app === undefined) return;

  const applyScheme = () =>
    document.documentElement.classList.toggle("dark", app.colorScheme === "dark");

  applyScheme();
  app.onEvent("themeChanged", applyScheme);
  app.ready();
  app.expand();
}

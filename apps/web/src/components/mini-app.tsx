import { XIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useFailure } from "@/lib/feedback";
import { startWebApp } from "@/lib/telegram";

/**
 * The frame of each Mini App the bot opens (todos and schedules, meals, workouts): it starts the Telegram client and
 * shows a write the server refused until dismissed. Outside Telegram there is no signed launch data, so it only says
 * where to open it.
 */
export function MiniApp({
  inTelegram,
  children,
}: {
  readonly inTelegram: boolean;
  readonly children: ReactNode;
}) {
  const [failure, dismiss] = useFailure();

  useEffect(startWebApp, []);

  if (!inTelegram) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Open this from Telegram</h1>
        <p className="text-sm text-muted-foreground">
          The app runs inside the assistant's chat: open it from the bot.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {failure !== null && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <p className="flex-1">Not saved: {failure}</p>
          <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label="Dismiss">
            <XIcon />
          </Button>
        </div>
      )}
      {children}
    </main>
  );
}

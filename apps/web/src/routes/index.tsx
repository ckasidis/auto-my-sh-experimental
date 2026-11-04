import { createFileRoute } from "@tanstack/react-router";
import { CalendarClockIcon, ListTodoIcon, UtensilsIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { MealsPanel } from "@/components/meals-panel";
import { SchedulesPanel } from "@/components/schedules-panel";
import { TodosPanel } from "@/components/todos-panel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  categoryCollection,
  ingredientCollection,
  mealCollection,
  recipeCollection,
  scheduleCollection,
  todoCollection,
} from "@/lib/collections";
import { useFailure } from "@/lib/feedback";
import { launchData, startWebApp } from "@/lib/telegram";

export const Route = createFileRoute("/")({
  // Telegram's `initData`, which every call is authorized with, exists only in the client, and so do collections.
  ssr: false,
  loader: async () => {
    const inTelegram = launchData() !== "";

    if (inTelegram) {
      await Promise.all([
        todoCollection.preload(),
        scheduleCollection.preload(),
        categoryCollection.preload(),
        ingredientCollection.preload(),
        recipeCollection.preload(),
        mealCollection.preload(),
      ]);
    }

    return { inTelegram };
  },
  component: Home,
});

function Home() {
  const { inTelegram } = Route.useLoaderData();
  const [failure, dismiss] = useFailure();

  useEffect(startWebApp, []);

  if (!inTelegram) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Open this from Telegram</h1>
        <p className="text-sm text-muted-foreground">
          The app runs inside the assistant's chat: tap its menu button to manage todos, schedules,
          and meals.
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
      <Tabs defaultValue="todos">
        <TabsList className="w-full bg-card">
          <TabsTrigger value="todos">
            <ListTodoIcon />
            Todos
          </TabsTrigger>
          <TabsTrigger value="schedules">
            <CalendarClockIcon />
            Schedules
          </TabsTrigger>
          <TabsTrigger value="meals">
            <UtensilsIcon />
            Meals
          </TabsTrigger>
        </TabsList>
        <TabsContent value="todos" className="pt-3">
          <TodosPanel />
        </TabsContent>
        <TabsContent value="schedules" className="pt-3">
          <SchedulesPanel />
        </TabsContent>
        <TabsContent value="meals" className="pt-3">
          <MealsPanel />
        </TabsContent>
      </Tabs>
    </main>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  DumbbellIcon,
  ListTodoIcon,
  SettingsIcon,
  UtensilsIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { MealsPanel } from "@/components/meals-panel";
import { SchedulesPanel } from "@/components/schedules-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { TodosPanel } from "@/components/todos-panel";
import { WorkoutsPanel } from "@/components/workouts-panel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  categoryCollection,
  exerciseCollection,
  ingredientCollection,
  mealCollection,
  planCollection,
  recipeCollection,
  scheduleCollection,
  sessionCollection,
  todoCollection,
} from "@/lib/collections";
import { useFailure } from "@/lib/feedback";
import { launchData, startWebApp } from "@/lib/telegram";

const SECTIONS = [
  { value: "todos", label: "Todos", Icon: ListTodoIcon },
  { value: "schedules", label: "Schedules", Icon: CalendarClockIcon },
  { value: "meals", label: "Meals", Icon: UtensilsIcon },
  { value: "workouts", label: "Workouts", Icon: DumbbellIcon },
] as const;

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
        exerciseCollection.preload(),
        planCollection.preload(),
        sessionCollection.preload(),
      ]);
    }

    return { inTelegram };
  },
  component: Home,
});

function Home() {
  const { inTelegram } = Route.useLoaderData();
  const [failure, dismiss] = useFailure();
  const [settings, setSettings] = useState(false);

  useEffect(startWebApp, []);

  if (!inTelegram) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Open this from Telegram</h1>
        <p className="text-sm text-muted-foreground">
          The app runs inside the assistant's chat: tap its menu button to manage todos, schedules,
          meals and workouts.
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
        <div className="flex items-center gap-2">
          <TabsList className="flex-1 bg-card">
            {SECTIONS.map(({ value, label, Icon }) => (
              // A phone fits only the open tab's label; the others show their icon.
              <TabsTrigger
                key={value}
                value={value}
                aria-label={label}
                className="[&[data-active]>span]:inline"
              >
                <Icon />
                <span className="max-sm:hidden">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettings(true)}
            aria-label="Settings"
          >
            <SettingsIcon />
          </Button>
        </div>
        <TabsContent value="todos" className="pt-3">
          <TodosPanel />
        </TabsContent>
        <TabsContent value="schedules" className="pt-3">
          <SchedulesPanel />
        </TabsContent>
        <TabsContent value="meals" className="pt-3">
          <MealsPanel />
        </TabsContent>
        <TabsContent value="workouts" className="pt-3">
          <WorkoutsPanel />
        </TabsContent>
      </Tabs>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </main>
  );
}

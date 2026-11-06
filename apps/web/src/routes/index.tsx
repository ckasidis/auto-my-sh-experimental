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
import { BottomSlot } from "@/components/bottom-bar";
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
import { cn } from "@/lib/utils";

const SECTIONS = [
  { value: "todos", label: "Todos", Icon: ListTodoIcon },
  { value: "schedules", label: "Schedules", Icon: CalendarClockIcon },
  { value: "meals", label: "Meals", Icon: UtensilsIcon },
  { value: "workouts", label: "Workouts", Icon: DumbbellIcon },
] as const;

/** A tab bar item: its icon over its label, as a phone's tab bar shows them. */
const BAR_ITEM =
  "inline-flex h-auto flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border-0 py-1.5 text-[0.7rem] font-medium [&_svg:not([class*='size-'])]:size-5 data-active:bg-transparent data-active:text-primary data-active:shadow-none dark:data-active:bg-transparent dark:data-active:text-primary";

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
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [barHeight, setBarHeight] = useState(0);

  useEffect(() => {
    if (bar === null) return;

    const observer = new ResizeObserver(() => setBarHeight(bar.offsetHeight));

    observer.observe(bar);

    return () => observer.disconnect();
  }, [bar]);

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
    <Tabs defaultValue="todos">
      <BottomSlot.Provider value={slot}>
        <main
          className="mx-auto max-w-md px-4 pt-3"
          // Clears the bottom bar, whose height changes with the open tab's action.
          style={{ paddingBottom: barHeight + 24 }}
        >
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
          <TabsContent value="todos">
            <TodosPanel />
          </TabsContent>
          <TabsContent value="schedules">
            <SchedulesPanel />
          </TabsContent>
          <TabsContent value="meals">
            <MealsPanel />
          </TabsContent>
          <TabsContent value="workouts">
            <WorkoutsPanel />
          </TabsContent>
        </main>
      </BottomSlot.Provider>
      {/* Pinned to the bottom, within thumb's reach: the open tab's action, then the tabs and settings. */}
      <div
        ref={setBar}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid max-w-md gap-2 px-4 pt-2">
          <div ref={setSlot} className="empty:hidden" />
          <div className="flex items-stretch">
            <TabsList className="h-auto flex-1 bg-transparent p-0 group-data-horizontal/tabs:h-auto">
              {SECTIONS.map(({ value, label, Icon }) => (
                <TabsTrigger key={value} value={value} className={BAR_ITEM}>
                  <Icon />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <button
              type="button"
              onClick={() => setSettings(true)}
              className={cn(BAR_ITEM, "flex-none px-3 text-foreground/60")}
            >
              <SettingsIcon />
              Settings
            </button>
          </div>
        </div>
      </div>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </Tabs>
  );
}

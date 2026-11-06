import { createFileRoute } from "@tanstack/react-router";
import { CalendarClockIcon, ListTodoIcon } from "lucide-react";
import { MiniApp } from "@/components/mini-app";
import { SchedulesPanel } from "@/components/schedules-panel";
import { TodosPanel } from "@/components/todos-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { scheduleCollection, todoCollection } from "@/lib/collections";
import { loadMiniApp } from "@/lib/mini-app";

/** The todos and schedules Mini App, the bot's menu button. */
export const Route = createFileRoute("/")({
  ssr: false,
  loader: () => loadMiniApp([todoCollection, scheduleCollection]),
  component: TodosApp,
});

function TodosApp() {
  const { inTelegram } = Route.useLoaderData();

  return (
    <MiniApp inTelegram={inTelegram}>
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
        </TabsList>
        <TabsContent value="todos" className="pt-3">
          <TodosPanel />
        </TabsContent>
        <TabsContent value="schedules" className="pt-3">
          <SchedulesPanel />
        </TabsContent>
      </Tabs>
    </MiniApp>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { MiniApp } from "@/components/mini-app";
import { WorkoutsPanel } from "@/components/workouts-panel";
import { exerciseCollection, planCollection, sessionCollection } from "@/lib/collections";
import { loadMiniApp } from "@/lib/mini-app";

/** The workouts Mini App: recording a workout from a plan, the plans, the history, and each exercise's stats. */
export const Route = createFileRoute("/workouts")({
  ssr: false,
  loader: () => loadMiniApp([exerciseCollection, planCollection, sessionCollection]),
  component: WorkoutsApp,
});

function WorkoutsApp() {
  const { inTelegram } = Route.useLoaderData();

  return (
    <MiniApp inTelegram={inTelegram}>
      <WorkoutsPanel />
    </MiniApp>
  );
}

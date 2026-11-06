import { ExercisesPanel } from "@/components/exercises-panel";
import { HistoryPanel } from "@/components/history-panel";
import { PlansPanel } from "@/components/plans-panel";
import { StartWorkoutPanel } from "@/components/start-workout-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Recording a workout from a plan, the plans, the logged sessions, and each exercise's stats. */
export function WorkoutsPanel() {
  return (
    <Tabs defaultValue="start">
      <TabsList variant="line" className="w-full">
        <TabsTrigger value="start">Start</TabsTrigger>
        <TabsTrigger value="plans">Plans</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="exercises">Exercises</TabsTrigger>
      </TabsList>
      <TabsContent value="start" className="pt-3">
        <StartWorkoutPanel />
      </TabsContent>
      <TabsContent value="plans" className="pt-3">
        <PlansPanel />
      </TabsContent>
      <TabsContent value="history" className="pt-3">
        <HistoryPanel />
      </TabsContent>
      <TabsContent value="exercises" className="pt-3">
        <ExercisesPanel />
      </TabsContent>
    </Tabs>
  );
}

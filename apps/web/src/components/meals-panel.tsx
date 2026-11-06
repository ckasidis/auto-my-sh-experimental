import { SettingsIcon } from "lucide-react";
import { useState } from "react";
import { GroceriesPanel } from "@/components/groceries-panel";
import { IngredientsPanel } from "@/components/ingredients-panel";
import { MealPlanPanel } from "@/components/meal-plan-panel";
import { RecipesPanel } from "@/components/recipes-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { startOfWeek, today } from "@/lib/dates";

/**
 * The recipe book: the meal prep calendar, the grocery list it makes, and the recipes and ingredients behind both. The
 * plan and the grocery list follow the same week.
 */
export function MealsPanel() {
  const [monday, setMonday] = useState(() => startOfWeek(today()));
  const [settings, setSettings] = useState(false);

  return (
    <Tabs defaultValue="plan">
      <div className="flex items-center gap-1">
        <TabsList variant="line" className="flex-1">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="groceries">Groceries</TabsTrigger>
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
          <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
        </TabsList>
        <Button variant="ghost" size="icon" onClick={() => setSettings(true)} aria-label="Settings">
          <SettingsIcon />
        </Button>
      </div>
      <TabsContent value="plan" className="pt-3">
        <MealPlanPanel monday={monday} onWeekChange={setMonday} />
      </TabsContent>
      <TabsContent value="groceries" className="pt-3">
        <GroceriesPanel monday={monday} onWeekChange={setMonday} />
      </TabsContent>
      <TabsContent value="recipes" className="pt-3">
        <RecipesPanel />
      </TabsContent>
      <TabsContent value="ingredients" className="pt-3">
        <IngredientsPanel />
      </TabsContent>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </Tabs>
  );
}

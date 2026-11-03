import { useState } from "react";
import { GroceriesPanel } from "@/components/groceries-panel";
import { IngredientsPanel } from "@/components/ingredients-panel";
import { MealPlanPanel } from "@/components/meal-plan-panel";
import { RecipesPanel } from "@/components/recipes-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { startOfWeek, today } from "@/lib/dates";

/**
 * The recipe book: the meal prep calendar, the grocery list it makes, and the recipes and ingredients behind both. The
 * plan and the grocery list follow the same week.
 */
export function MealsPanel() {
  const [monday, setMonday] = useState(() => startOfWeek(today()));

  return (
    <Tabs defaultValue="plan">
      <TabsList variant="line" className="w-full">
        <TabsTrigger value="plan">Plan</TabsTrigger>
        <TabsTrigger value="groceries">Groceries</TabsTrigger>
        <TabsTrigger value="recipes">Recipes</TabsTrigger>
        <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
      </TabsList>
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
    </Tabs>
  );
}

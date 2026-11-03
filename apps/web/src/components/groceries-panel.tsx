import { and, gte, lte, useLiveQuery } from "@tanstack/react-db";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WeekNav } from "@/components/week-nav";
import { ingredientCollection, mealCollection, recipeCollection } from "@/lib/collections";
import { addDays, formatDateRange } from "@/lib/dates";
import { webApp } from "@/lib/telegram";
import { formatGroceryAmount, groceryList } from "utils/groceries";

/**
 * What to buy for the week's planned meals: each recipe scaled to its meal's servings, summed per ingredient. It is
 * worked out from the calendar as it changes, as the chat's grocery_list tool does.
 */
export function GroceriesPanel({
  monday,
  onWeekChange,
}: {
  readonly monday: string;
  readonly onWeekChange: (monday: string) => void;
}) {
  const sunday = addDays(monday, 6);

  const meals = useLiveQuery((q) =>
    q
      .from({ meal: mealCollection })
      .where(({ meal }) => and(gte(meal.date, monday), lte(meal.date, sunday))),
  );

  const recipes = useLiveQuery((q) => q.from({ recipe: recipeCollection }));
  const ingredients = useLiveQuery((q) => q.from({ ingredient: ingredientCollection }));
  const [copied, setCopied] = useState(false);

  if (meals.isLoadingError || recipes.isLoadingError || ingredients.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load the groceries.</p>
    );
  }

  const items = groceryList(meals.data, recipes.data, ingredients.data);

  const copy = async () => {
    const text = [
      `Groceries for ${formatDateRange(monday, sunday)}`,
      ...items.map((item) => `- ${item.name}: ${formatGroceryAmount(item)}`),
    ].join("\n");

    await navigator.clipboard.writeText(text);
    webApp()?.HapticFeedback?.notificationOccurred("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <div className="flex flex-col gap-3">
      <WeekNav monday={monday} onChange={onWeekChange} />
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {meals.data.length === 0
            ? "No meals planned this week."
            : "The planned recipes list no ingredients."}
        </p>
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-xl bg-card">
            {items.map((item) => (
              <li key={item.ingredientId} className="flex items-baseline gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.95rem] leading-snug">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.recipes.join(", ")}
                  </p>
                </div>
                <span className="text-sm whitespace-nowrap">{formatGroceryAmount(item)}</span>
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy list"}
          </Button>
        </>
      )}
      <p className="px-1 text-xs text-muted-foreground">
        From {meals.data.length} planned meal{meals.data.length === 1 ? "" : "s"}. Amounts are in
        each ingredient's unit.
      </p>
    </div>
  );
}

import { and, eq, gte, lte, useLiveQuery } from "@tanstack/react-db";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { WeekNav } from "@/components/week-nav";
import {
  categoryCollection,
  ingredientCollection,
  mealCollection,
  purchaseCollection,
  recipeCollection,
} from "@/lib/collections";
import { addDays, formatDateRange } from "@/lib/dates";
import { follow } from "@/lib/feedback";
import { webApp } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { formatGroceryAmount, groceryList, groupGroceries } from "utils/groceries";

/**
 * What to buy for the week's planned meals: each recipe scaled to its meal's servings, summed per ingredient, under a
 * heading per category in the owner's order. It is worked out from the calendar as it changes, as the chat's
 * grocery_list tool does. An ingredient already bought can be ticked off for the week; the tick is kept for that week
 * only, and copying the list leaves ticked ones out.
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
  const categories = useLiveQuery((q) => q.from({ category: categoryCollection }));

  const purchases = useLiveQuery((q) =>
    q.from({ purchase: purchaseCollection }).where(({ purchase }) => eq(purchase.week, monday)),
  );

  const [copied, setCopied] = useState(false);

  if (
    meals.isLoadingError ||
    recipes.isLoadingError ||
    ingredients.isLoadingError ||
    categories.isLoadingError ||
    purchases.isLoadingError
  ) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load the groceries.</p>
    );
  }

  const items = groceryList(meals.data, recipes.data, ingredients.data, categories.data);
  const groups = groupGroceries(items);
  const bought = new Set(purchases.data.map(({ ingredientId }) => ingredientId));
  const left = items.filter((item) => !bought.has(item.ingredientId));

  const tick = (ingredientId: string, checked: boolean) =>
    follow(
      checked
        ? purchaseCollection.insert({ week: monday, ingredientId, createdAt: Date.now() })
        : purchaseCollection.delete(`${monday} ${ingredientId}`),
    );

  // Headings only help between categories; a list all in one, such as Other before any others exist, is a plain list.
  const headed = groups.length > 1;

  const copy = async () => {
    // What is left to buy: ticked items, and a category with nothing else, are left out.
    const lines = groupGroceries(left).flatMap(({ category, items: group }) => [
      ...(headed ? ["", `${category}:`] : []),
      ...group.map((item) => `- ${item.name}: ${formatGroceryAmount(item)}`),
    ]);

    const text = [`Groceries for ${formatDateRange(monday, sunday)}`, ...lines].join("\n");

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
          {groups.map(({ categoryId, category, items: group }) => (
            <section key={categoryId} className="flex flex-col gap-2">
              {headed && (
                <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {category}
                </h3>
              )}
              <ul className="divide-y overflow-hidden rounded-xl bg-card">
                {group.map((item) => {
                  const isBought = bought.has(item.ingredientId);

                  return (
                    <li key={item.ingredientId}>
                      <label className="flex items-start gap-3 px-3 py-2.5">
                        <Checkbox
                          className="mt-0.5 size-5 rounded-full"
                          checked={isBought}
                          onCheckedChange={(checked) => tick(item.ingredientId, checked)}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-[0.95rem] leading-snug",
                              isBought && "text-muted-foreground line-through",
                            )}
                          >
                            {item.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {item.recipes.join(", ")}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "text-sm whitespace-nowrap",
                            isBought && "text-muted-foreground line-through",
                          )}
                        >
                          {formatGroceryAmount(item)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <Button variant="outline" onClick={copy} disabled={left.length === 0}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : left.length === items.length ? "Copy list" : "Copy what's left"}
          </Button>
        </>
      )}
      <p className="px-1 text-xs text-muted-foreground">
        From {meals.data.length} planned meal{meals.data.length === 1 ? "" : "s"}
        {left.length < items.length && `; ${items.length - left.length} of ${items.length} bought`}.
        Amounts are in each ingredient's unit.
      </p>
    </div>
  );
}

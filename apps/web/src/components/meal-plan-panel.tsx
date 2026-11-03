import { and, gte, lte, useLiveQuery } from "@tanstack/react-db";
import type { Meal, MealSlot, Recipe } from "assistant/recipe-book";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Choice } from "@/components/choice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WeekNav } from "@/components/week-nav";
import { mealCollection, recipeCollection } from "@/lib/collections";
import { addDays, formatDay, today, weekOf } from "@/lib/dates";
import { follow } from "@/lib/feedback";
import { cn } from "@/lib/utils";

/** A day's slots, in the order the day shows them. */
const SLOTS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
} satisfies Record<MealSlot, string>;

const SLOT_ORDER = Object.keys(SLOTS);

const bySlot = (a: Meal, b: Meal) =>
  SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.createdAt - b.createdAt;

type Dialogs = { kind: "add"; date: string } | { kind: "edit"; meal: Meal };

/** The meal prep calendar for one week: each day's planned meals by slot, and a way to plan more. */
export function MealPlanPanel({
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

  const recipes = useLiveQuery((q) =>
    q.from({ recipe: recipeCollection }).orderBy(({ recipe }) => recipe.name, "asc"),
  );

  const [open, setOpen] = useState<Dialogs | null>(null);

  if (meals.isLoadingError || recipes.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load the plan.</p>
    );
  }

  const recipesById = new Map(recipes.data.map((recipe) => [recipe.id, recipe]));
  const now = today();
  const close = () => setOpen(null);

  return (
    <div className="flex flex-col gap-3">
      <WeekNav monday={monday} onChange={onWeekChange} />
      {recipes.data.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Add a recipe in the Recipes tab to plan meals with it.
        </p>
      )}
      {weekOf(monday).map((date) => {
        const planned = meals.data.filter((meal) => meal.date === date).sort(bySlot);

        return (
          <section key={date} className="overflow-hidden rounded-xl bg-card">
            <header className="flex items-center gap-2 px-3 pt-2 pb-1">
              <h3 className={cn("flex-1 text-sm font-medium", date === now && "text-primary")}>
                {formatDay(date)}
                {date === now && " · Today"}
              </h3>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen({ kind: "add", date })}
                disabled={recipes.data.length === 0}
                aria-label={`Plan a meal on ${formatDay(date)}`}
              >
                <PlusIcon />
              </Button>
            </header>
            {planned.length === 0 ? (
              <p className="px-3 pb-2.5 text-xs text-muted-foreground">Nothing planned.</p>
            ) : (
              <ul className="divide-y">
                {planned.map((meal) => (
                  <li key={meal.id}>
                    <button
                      type="button"
                      className="flex w-full items-baseline gap-3 px-3 py-2 text-left"
                      onClick={() => setOpen({ kind: "edit", meal })}
                    >
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">
                        {SLOTS[meal.slot]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.95rem]">
                        {recipesById.get(meal.recipeId)?.name ?? "Deleted recipe"}
                      </span>
                      <span className="text-xs text-muted-foreground">×{meal.servings}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <Dialog open={open !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          {/* Keyed so the form starts from the day or meal it opens on. */}
          {open !== null && (
            <MealForm
              key={open.kind === "add" ? `add:${open.date}` : open.meal.id}
              meal={open.kind === "edit" ? open.meal : null}
              date={open.kind === "add" ? open.date : open.meal.date}
              recipes={recipes.data}
              onClose={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Plans a meal on a day, or changes or removes a planned one. */
function MealForm({
  meal,
  date: initialDate,
  recipes,
  onClose,
}: {
  readonly meal: Meal | null;
  readonly date: string;
  readonly recipes: readonly Recipe[];
  readonly onClose: () => void;
}) {
  const first = recipes[0];
  const [recipeId, setRecipeId] = useState(meal?.recipeId ?? first?.id ?? "");
  const [slot, setSlot] = useState<MealSlot>(meal?.slot ?? "dinner");
  const [date, setDate] = useState(initialDate);
  const [servings, setServings] = useState(String(meal?.servings ?? first?.servings ?? 2));
  const recipe = recipes.find(({ id }) => id === recipeId);
  const servingCount = Number(servings);
  const validServings = Number.isInteger(servingCount) && servingCount >= 1 && servingCount <= 100;
  const valid = recipe !== undefined && validServings && date !== "";

  const items: Record<string, string> = Object.fromEntries(
    recipes.map((option) => [option.id, option.name]),
  );

  const chooseRecipe = (id: string) => {
    setRecipeId(id);

    // A new meal makes what the recipe makes unless the owner says otherwise.
    const chosen = recipes.find((option) => option.id === id);

    if (meal === null && chosen !== undefined) setServings(String(chosen.servings));
  };

  const save = (event: FormEvent) => {
    event.preventDefault();

    if (!valid) return;

    if (meal === null) {
      follow(
        mealCollection.insert({
          id: `meal:app:${crypto.randomUUID()}`,
          date,
          slot,
          recipeId,
          servings: servingCount,
          createdAt: Date.now(),
        }),
      );
    } else {
      follow(
        mealCollection.update(meal.id, (draft) => {
          draft.date = date;
          draft.slot = slot;
          draft.recipeId = recipeId;
          draft.servings = servingCount;
        }),
      );
    }

    onClose();
  };

  const remove = (id: string) => {
    follow(mealCollection.delete(id));
    onClose();
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{meal === null ? "Plan a meal" : "Planned meal"}</DialogTitle>
        <DialogDescription>{formatDay(initialDate)}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label>Recipe</Label>
        <Choice items={items} value={recipeId} onChange={chooseRecipe} label="Recipe" />
      </div>
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <div className="grid gap-1.5">
          <Label>Meal</Label>
          <Choice items={SLOTS} value={slot} onChange={setSlot} label="Meal" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="meal-servings">Servings</Label>
          <Input
            id="meal-servings"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={servings}
            onChange={(event) => setServings(event.target.value)}
            aria-invalid={!validServings}
            required
          />
        </div>
      </div>
      {meal !== null && (
        <div className="grid gap-1.5">
          <Label htmlFor="meal-date">Date</Label>
          <Input
            id="meal-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </div>
      )}
      {recipe !== undefined && validServings && servingCount !== recipe.servings && (
        <p className="text-xs text-muted-foreground">
          The recipe serves {recipe.servings}; the grocery list scales it to {servingCount}.
        </p>
      )}
      <DialogFooter className="flex-row justify-between sm:justify-between">
        {meal === null ? (
          <span />
        ) : (
          <Button type="button" variant="destructive" onClick={() => remove(meal.id)}>
            Remove
          </Button>
        )}
        <Button type="submit" disabled={!valid}>
          {meal === null ? "Plan" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

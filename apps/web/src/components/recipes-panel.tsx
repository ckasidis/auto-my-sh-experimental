import { useLiveQuery } from "@tanstack/react-db";
import type { Ingredient, Recipe, RecipeLine } from "assistant/recipe-book";
import { PlusIcon, Trash2Icon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { ingredientCollection, mealCollection, recipeCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";

/** A recipe dialog can be long: it scrolls within the screen. */
const TALL_DIALOG = "max-h-[90dvh] overflow-y-auto";

type Dialogs = { kind: "view"; recipe: Recipe } | { kind: "edit"; recipe: Recipe | null };

/** The owner's recipes, by name; tap one to read it, then edit it from there. */
export function RecipesPanel() {
  const recipes = useLiveQuery((q) =>
    q.from({ recipe: recipeCollection }).orderBy(({ recipe }) => recipe.name, "asc"),
  );

  const ingredients = useLiveQuery((q) =>
    q
      .from({ ingredient: ingredientCollection })
      .orderBy(({ ingredient }) => ingredient.name, "asc"),
  );

  const [open, setOpen] = useState<Dialogs | null>(null);

  if (recipes.isLoadingError || ingredients.isLoadingError) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load recipes.</p>;
  }

  const close = () => setOpen(null);

  return (
    <div className="flex flex-col gap-4">
      <Button className="h-10" onClick={() => setOpen({ kind: "edit", recipe: null })}>
        <PlusIcon />
        New recipe
      </Button>
      {recipes.data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No recipes yet.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl bg-card">
          {recipes.data.map((recipe) => (
            <li key={recipe.id}>
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left"
                onClick={() => setOpen({ kind: "view", recipe })}
              >
                <p className="text-[0.95rem] leading-snug">{recipe.name}</p>
                <p className="text-xs text-muted-foreground">
                  Serves {recipe.servings} · {recipe.ingredients.length} ingredients ·{" "}
                  {recipe.steps.length} steps
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent className={TALL_DIALOG}>
          {open?.kind === "view" && (
            <ViewRecipe
              recipe={open.recipe}
              ingredients={ingredients.data}
              onEdit={() => setOpen({ kind: "edit", recipe: open.recipe })}
            />
          )}
          {/* Keyed so the form starts from the recipe it opens on. */}
          {open?.kind === "edit" && (
            <RecipeForm
              key={open.recipe?.id ?? "new"}
              recipe={open.recipe}
              ingredients={ingredients.data}
              onClose={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "200 g Spaghetti, chopped" with the ingredient's unit; an ingredient that is gone shows its id. */
function describeLine(line: RecipeLine, ingredient: Ingredient | undefined): string {
  const name = ingredient?.name ?? line.ingredientId;
  const unit = ingredient?.unit ?? null;

  const amount =
    line.quantity === null ? "" : unit === null ? `${line.quantity} ` : `${line.quantity} ${unit} `;

  return `${amount}${name}${line.note === null ? "" : `, ${line.note}`}`;
}

function ViewRecipe({
  recipe,
  ingredients,
  onEdit,
}: {
  readonly recipe: Recipe;
  readonly ingredients: readonly Ingredient[];
  readonly onEdit: () => void;
}) {
  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{recipe.name}</DialogTitle>
        <DialogDescription>Serves {recipe.servings}</DialogDescription>
      </DialogHeader>
      {recipe.notes !== null && <p className="whitespace-pre-wrap">{recipe.notes}</p>}
      <section className="grid gap-1.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Ingredients
        </h3>
        {recipe.ingredients.length === 0 ? (
          <p className="text-muted-foreground">None listed.</p>
        ) : (
          <ul className="grid list-disc gap-0.5 pl-5">
            {recipe.ingredients.map((line, index) => (
              // A recipe may list an ingredient twice; its position is the line's identity.
              <li key={index}>{describeLine(line, byId.get(line.ingredientId))}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-1.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Steps</h3>
        {recipe.steps.length === 0 ? (
          <p className="text-muted-foreground">None written.</p>
        ) : (
          <ol className="grid list-decimal gap-1.5 pl-5">
            {recipe.steps.map((step, index) => (
              <li key={index} className="whitespace-pre-wrap">
                {step}
              </li>
            ))}
          </ol>
        )}
      </section>
      <DialogFooter>
        <Button onClick={onEdit}>Edit</Button>
      </DialogFooter>
    </>
  );
}

/** A line as the form edits it: the quantity as typed, and a key that follows the row as others are removed. */
type LineRow = { key: string; ingredientId: string; quantity: string; note: string };

type StepRow = { key: string; text: string };

const rowKey = () => crypto.randomUUID();

const toRow = (line: RecipeLine): LineRow => ({
  key: rowKey(),
  ingredientId: line.ingredientId,
  quantity: line.quantity === null ? "" : String(line.quantity),
  note: line.note ?? "",
});

/** The quantity typed in a row: null when empty, NaN when it is not an amount above 0. */
function parseQuantity(text: string): number | null {
  if (text.trim() === "") return null;

  const quantity = Number(text.replace(",", "."));

  return Number.isFinite(quantity) && quantity > 0 ? quantity : Number.NaN;
}

const ingredientLabel = (ingredient: Ingredient) =>
  ingredient.unit === null ? ingredient.name : `${ingredient.name} (${ingredient.unit})`;

/** Adds a recipe, or edits one, choosing its ingredients from the list; deleting it also unplans its meals. */
function RecipeForm({
  recipe,
  ingredients,
  onClose,
}: {
  readonly recipe: Recipe | null;
  readonly ingredients: readonly Ingredient[];
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? "");
  const [servings, setServings] = useState(String(recipe?.servings ?? 2));
  const [notes, setNotes] = useState(recipe?.notes ?? "");
  const [lines, setLines] = useState<LineRow[]>(() => recipe?.ingredients.map(toRow) ?? []);

  const [steps, setSteps] = useState<StepRow[]>(
    () => recipe?.steps.map((text) => ({ key: rowKey(), text })) ?? [],
  );

  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

  const items: Record<string, string> = Object.fromEntries(
    ingredients.map((ingredient) => [ingredient.id, ingredientLabel(ingredient)]),
  );

  const servingCount = Number(servings);
  const validServings = Number.isInteger(servingCount) && servingCount >= 1 && servingCount <= 100;
  const badQuantity = lines.some(({ quantity }) => Number.isNaN(parseQuantity(quantity)));
  const missing = lines.some(({ ingredientId }) => !byId.has(ingredientId));
  const valid = name.trim() !== "" && validServings && !badQuantity && !missing;

  const changeLine = (key: string, changes: Partial<LineRow>) =>
    setLines(lines.map((line) => (line.key === key ? { ...line, ...changes } : line)));

  const addLine = () => {
    // The first ingredient not on the recipe yet, or the first one.
    const unused = ingredients.find(({ id }) => !lines.some((line) => line.ingredientId === id));
    const ingredient = unused ?? ingredients[0];

    if (ingredient === undefined) return;

    setLines([...lines, { key: rowKey(), ingredientId: ingredient.id, quantity: "", note: "" }]);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();

    if (!valid) return;

    const trimmedNotes = notes.trim();

    const fields = {
      name: name.trim(),
      servings: servingCount,
      notes: trimmedNotes === "" ? null : trimmedNotes,
      steps: steps.flatMap(({ text }) => (text.trim() === "" ? [] : [text.trim()])),
      ingredients: lines.map((line) => ({
        ingredientId: line.ingredientId,
        quantity: parseQuantity(line.quantity),
        note: line.note.trim() === "" ? null : line.note.trim(),
      })),
    };

    if (recipe === null) {
      follow(
        recipeCollection.insert({
          id: `recipe:app:${crypto.randomUUID()}`,
          ...fields,
          createdAt: Date.now(),
        }),
      );
    } else {
      follow(recipeCollection.update(recipe.id, (draft) => Object.assign(draft, fields)));
    }

    onClose();
  };

  const remove = (id: string) => {
    follow(recipeCollection.delete(id));
    onClose();
  };

  const planned =
    recipe === null
      ? 0
      : mealCollection.toArray.filter((meal) => meal.recipeId === recipe.id).length;

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{recipe === null ? "New recipe" : "Edit recipe"}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="recipe-name">Name</Label>
          <Input
            id="recipe-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="recipe-servings">Serves</Label>
          <Input
            id="recipe-servings"
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
      <section className="grid gap-2">
        <Label>Ingredients</Label>
        <p className="text-xs text-muted-foreground">
          Amounts are for all {servings || "the"} servings.
        </p>
        {lines.map((line) => {
          const unit = byId.get(line.ingredientId)?.unit ?? null;
          const badAmount = Number.isNaN(parseQuantity(line.quantity));

          return (
            <div key={line.key} className="grid gap-1.5 rounded-lg bg-muted p-2">
              <div className="flex gap-2">
                <Choice
                  items={items}
                  value={line.ingredientId}
                  onChange={(ingredientId) => changeLine(line.key, { ingredientId })}
                  label="Ingredient"
                  className="min-w-0 flex-1 bg-card"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setLines(lines.filter(({ key }) => key !== line.key))}
                  aria-label="Remove ingredient"
                >
                  <Trash2Icon />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={line.quantity}
                  onChange={(event) => changeLine(line.key, { quantity: event.target.value })}
                  inputMode="decimal"
                  placeholder="Amount"
                  className="w-24 bg-card"
                  aria-label="Amount"
                  aria-invalid={badAmount}
                />
                {unit !== null && <span className="text-xs text-muted-foreground">{unit}</span>}
                <Input
                  value={line.note}
                  onChange={(event) => changeLine(line.key, { note: event.target.value })}
                  placeholder="Note (diced)"
                  maxLength={200}
                  className="min-w-0 flex-1 bg-card"
                  aria-label="Note"
                />
              </div>
              {!byId.has(line.ingredientId) && (
                <p className="text-xs text-destructive">
                  This ingredient was deleted: choose another.
                </p>
              )}
            </div>
          );
        })}
        {ingredients.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add ingredients in the Ingredients tab to choose from them here.
          </p>
        ) : (
          <Button type="button" variant="outline" onClick={addLine}>
            <PlusIcon />
            Add ingredient
          </Button>
        )}
        {badQuantity && (
          <p className="text-xs text-destructive">An amount must be a number above 0, or empty.</p>
        )}
      </section>
      <section className="grid gap-2">
        <Label>Steps</Label>
        {steps.map((step, index) => (
          <div key={step.key} className="flex items-start gap-2">
            <span className="w-5 pt-2 text-right text-xs text-muted-foreground">{index + 1}.</span>
            <Textarea
              value={step.text}
              onChange={(event) =>
                setSteps(
                  steps.map((row) =>
                    row.key === step.key ? { ...row, text: event.target.value } : row,
                  ),
                )
              }
              maxLength={2_000}
              rows={2}
              className="min-w-0 flex-1"
              aria-label={`Step ${index + 1}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSteps(steps.filter(({ key }) => key !== step.key))}
              aria-label={`Remove step ${index + 1}`}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setSteps([...steps, { key: rowKey(), text: "" }])}
        >
          <PlusIcon />
          Add step
        </Button>
      </section>
      <div className="grid gap-1.5">
        <Label htmlFor="recipe-notes">Notes</Label>
        <Textarea
          id="recipe-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={10_000}
          rows={2}
        />
      </div>
      {recipe !== null && planned > 0 && (
        <p className="text-xs text-muted-foreground">
          Deleting it also removes its {planned} planned meal{planned === 1 ? "" : "s"}.
        </p>
      )}
      <DialogFooter className="flex-row justify-between sm:justify-between">
        {recipe === null ? (
          <span />
        ) : (
          <Button type="button" variant="destructive" onClick={() => remove(recipe.id)}>
            Delete
          </Button>
        )}
        <Button type="submit" disabled={!valid}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

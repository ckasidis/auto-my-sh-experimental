import { useLiveQuery } from "@tanstack/react-db";
import type { Ingredient } from "assistant/recipe-book";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
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
import { ingredientCollection, recipeCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";

const UNIT_HINT =
  "The one unit every recipe measures it in, like g, ml or pcs. Leave empty for none.";

/** Empty input is no unit. */
const unitOf = (text: string) => (text.trim() === "" ? null : text.trim());

/** The ingredients recipes are made from, by name, each with the recipes that use it. */
export function IngredientsPanel() {
  const ingredients = useLiveQuery((q) =>
    q
      .from({ ingredient: ingredientCollection })
      .orderBy(({ ingredient }) => ingredient.name, "asc"),
  );

  const recipes = useLiveQuery((q) => q.from({ recipe: recipeCollection }));
  const [editing, setEditing] = useState<Ingredient | null>(null);

  if (ingredients.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load ingredients.</p>
    );
  }

  /** The names of the recipes that use an ingredient. */
  const usedBy = (id: string) =>
    recipes.data.flatMap((recipe) =>
      recipe.ingredients.some(({ ingredientId }) => ingredientId === id) ? [recipe.name] : [],
    );

  return (
    <div className="flex flex-col gap-4">
      <AddIngredient existing={ingredients.data} />
      {ingredients.data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No ingredients yet.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl bg-card">
          {ingredients.data.map((ingredient) => {
            const users = usedBy(ingredient.id);

            return (
              <li key={ingredient.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left"
                  onClick={() => setEditing(ingredient)}
                >
                  <span className="min-w-0 flex-1 truncate text-[0.95rem]">{ingredient.name}</span>
                  {ingredient.unit !== null && (
                    <span className="text-xs text-muted-foreground">{ingredient.unit}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {users.length === 0
                      ? "unused"
                      : `${users.length} recipe${users.length === 1 ? "" : "s"}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <EditIngredient
        ingredient={editing}
        existing={ingredients.data}
        usedBy={editing === null ? [] : usedBy(editing.id)}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/** The server keeps one ingredient per name, ignoring case, so the form refuses a name already on the list. */
const nameTaken = (name: string, existing: readonly Ingredient[], except?: string) =>
  existing.some(
    (ingredient) =>
      ingredient.id !== except &&
      ingredient.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

function AddIngredient({ existing }: { readonly existing: readonly Ingredient[] }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const taken = nameTaken(name, existing);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim() === "" || taken) return;

    follow(
      ingredientCollection.insert({
        id: `ingredient:app:${crypto.randomUUID()}`,
        name: name.trim(),
        unit: unitOf(unit),
        createdAt: Date.now(),
      }),
    );
    setName("");
    setUnit("");
  };

  return (
    <form onSubmit={submit} className="grid gap-1">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Add an ingredient"
          maxLength={200}
          className="h-10 bg-card"
          aria-invalid={taken}
        />
        <Input
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          placeholder="Unit"
          maxLength={20}
          className="h-10 w-20 bg-card"
          aria-label="Unit"
          enterKeyHint="done"
        />
        <Button
          type="submit"
          size="icon-lg"
          className="size-10"
          disabled={name.trim() === "" || taken}
          aria-label="Add"
        >
          <PlusIcon />
        </Button>
      </div>
      {taken && <p className="px-1 text-xs text-destructive">Already on the list.</p>}
    </form>
  );
}

function EditIngredient({
  ingredient,
  existing,
  usedBy,
  onClose,
}: {
  readonly ingredient: Ingredient | null;
  readonly existing: readonly Ingredient[];
  readonly usedBy: readonly string[];
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={ingredient !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Keyed so the form starts from the ingredient it opens on. */}
        {ingredient !== null && (
          <EditIngredientForm
            key={ingredient.id}
            ingredient={ingredient}
            existing={existing}
            usedBy={usedBy}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditIngredientForm({
  ingredient,
  existing,
  usedBy,
  onClose,
}: {
  readonly ingredient: Ingredient;
  readonly existing: readonly Ingredient[];
  readonly usedBy: readonly string[];
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(ingredient.name);
  const [unit, setUnit] = useState(ingredient.unit ?? "");
  const taken = nameTaken(name, existing, ingredient.id);
  const unitChanged = unitOf(unit) !== ingredient.unit;

  const save = (event: FormEvent) => {
    event.preventDefault();

    follow(
      ingredientCollection.update(ingredient.id, (draft) => {
        draft.name = name.trim();
        draft.unit = unitOf(unit);
      }),
    );
    onClose();
  };

  const remove = () => {
    follow(ingredientCollection.delete(ingredient.id));
    onClose();
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Edit ingredient</DialogTitle>
        <DialogDescription>
          {usedBy.length === 0 ? "No recipe uses it." : `Used in ${usedBy.join(", ")}.`}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="ingredient-name">Name</Label>
        <Input
          id="ingredient-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          aria-invalid={taken}
          required
        />
        {taken && <p className="text-xs text-destructive">Another ingredient has this name.</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ingredient-unit">Unit</Label>
        <Input
          id="ingredient-unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          maxLength={20}
        />
        <p className="text-xs text-muted-foreground">
          {unitChanged && usedBy.length > 0
            ? "Recipes keep their amounts: convert them to the new unit."
            : UNIT_HINT}
        </p>
      </div>
      <DialogFooter className="flex-row justify-between sm:justify-between">
        <Button
          type="button"
          variant="destructive"
          onClick={remove}
          disabled={usedBy.length > 0}
          title={usedBy.length > 0 ? "Remove it from its recipes first" : undefined}
        >
          Delete
        </Button>
        <Button type="submit" disabled={name.trim() === "" || taken}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

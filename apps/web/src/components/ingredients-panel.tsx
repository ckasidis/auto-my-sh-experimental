import { useLiveQuery } from "@tanstack/react-db";
import type { Ingredient, IngredientCategory } from "assistant/recipe-book";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
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
import { categoryCollection, ingredientCollection, recipeCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";
import { nameTaken } from "@/lib/names";
import { compareCategories, OTHER_CATEGORY } from "utils/groceries";

const UNIT_HINT =
  "The one unit every recipe measures it in, like g, ml or pcs. Leave empty for none.";

/** Empty input is no unit. */
const unitOf = (text: string) => (text.trim() === "" ? null : text.trim());

/** The category picker's options, in the order the list shows them. */
const categoryItems = (categories: readonly IngredientCategory[]) =>
  Object.fromEntries(categories.map((category) => [category.id, category.name]));

/**
 * The ingredients recipes are made from, under a heading per category in the owner's order, "Other", the default,
 * among them, as grocery apps list them; each heading adds an ingredient to its category. While Other is the only category it is not
 * shown: the list is just the ingredients. Categories are managed in settings.
 */
export function IngredientsPanel() {
  const ingredients = useLiveQuery((q) =>
    q
      .from({ ingredient: ingredientCollection })
      .orderBy(({ ingredient }) => ingredient.name, "asc"),
  );

  const categories = useLiveQuery((q) => q.from({ category: categoryCollection }));

  const recipes = useLiveQuery((q) => q.from({ recipe: recipeCollection }));
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  if (ingredients.isLoadingError || categories.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load ingredients.</p>
    );
  }

  /** The names of the recipes that use an ingredient. */
  const usedBy = (id: string) =>
    recipes.data.flatMap((recipe) =>
      recipe.ingredients.some(({ ingredientId }) => ingredientId === id) ? [recipe.name] : [],
    );

  const ordered = [...categories.data].sort(compareCategories);
  const known = new Set(ordered.map(({ id }) => id));
  const only = ordered.every(({ id }) => id === OTHER_CATEGORY.id);

  /** Its category, or Other for one whose category is gone. */
  const shownIn = (ingredient: Ingredient) =>
    known.has(ingredient.categoryId) ? ingredient.categoryId : OTHER_CATEGORY.id;

  // Every category, empty ones included so each can be added to; Other is always there, even before the store's
  // migration is seen.
  const groups = (known.has(OTHER_CATEGORY.id) ? ordered : [...ordered, OTHER_CATEGORY]).map(
    (category) => ({
      key: category.id,
      title: only ? "Ingredients" : category.name,
      items: ingredients.data.filter((ingredient) => shownIn(ingredient) === category.id),
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <header className="flex items-center gap-2 px-1">
            <h3 className="flex-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group.title} · {group.items.length}
            </h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAdding(adding === group.key ? null : group.key)}
              aria-label={`Add an ingredient to ${group.title}`}
              aria-expanded={adding === group.key}
            >
              <PlusIcon />
            </Button>
          </header>
          {(group.items.length > 0 || adding === group.key) && (
            <ul className="divide-y overflow-hidden rounded-xl bg-card">
              {group.items.map((ingredient) => (
                <IngredientRow
                  key={ingredient.id}
                  ingredient={ingredient}
                  users={usedBy(ingredient.id)}
                  onEdit={setEditing}
                />
              ))}
              {adding === group.key && (
                <AddIngredient
                  categoryId={group.key}
                  existing={ingredients.data}
                  onClose={() => setAdding(null)}
                />
              )}
            </ul>
          )}
          {group.items.length === 0 && adding !== group.key && (
            <p className="px-1 text-xs text-muted-foreground">
              {only ? "No ingredients yet." : "Nothing in it."}
            </p>
          )}
        </section>
      ))}
      <EditIngredient
        ingredient={editing}
        existing={ingredients.data}
        categories={ordered}
        usedBy={editing === null ? [] : usedBy(editing.id)}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function IngredientRow({
  ingredient,
  users,
  onEdit,
}: {
  readonly ingredient: Ingredient;
  readonly users: readonly string[];
  readonly onEdit: (ingredient: Ingredient) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left"
        onClick={() => onEdit(ingredient)}
      >
        <span className="min-w-0 flex-1 truncate text-[0.95rem]">{ingredient.name}</span>
        {ingredient.unit !== null && (
          <span className="text-xs text-muted-foreground">{ingredient.unit}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {users.length === 0 ? "unused" : `${users.length} recipe${users.length === 1 ? "" : "s"}`}
        </span>
      </button>
    </li>
  );
}

/**
 * A row at the end of a category's list that adds an ingredient to it. It stays open after each add, for entering
 * several in a row; Escape or the close button ends it.
 */
function AddIngredient({
  categoryId,
  existing,
  onClose,
}: {
  readonly categoryId: string;
  readonly existing: readonly Ingredient[];
  readonly onClose: () => void;
}) {
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
        categoryId,
        createdAt: Date.now(),
      }),
    );
    setName("");
    setUnit("");
  };

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };

  return (
    <li className="px-2 py-2">
      <form onSubmit={submit} onKeyDown={closeOnEscape} className="grid gap-1">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            maxLength={200}
            aria-label="Name"
            aria-invalid={taken}
            autoFocus
          />
          <Input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder="Unit"
            maxLength={20}
            className="w-20"
            aria-label="Unit"
            enterKeyHint="done"
          />
          <Button type="submit" size="icon" disabled={name.trim() === "" || taken} aria-label="Add">
            <CheckIcon />
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Done">
            <XIcon />
          </Button>
        </div>
        {taken && <p className="px-1 text-xs text-destructive">Already on the list.</p>}
      </form>
    </li>
  );
}

function EditIngredient({
  ingredient,
  existing,
  categories,
  usedBy,
  onClose,
}: {
  readonly ingredient: Ingredient | null;
  readonly existing: readonly Ingredient[];
  readonly categories: readonly IngredientCategory[];
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
            categories={categories}
            usedBy={usedBy}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Edits an ingredient's name, unit and category, or deletes it while no recipe uses it. */
function EditIngredientForm({
  ingredient,
  existing,
  categories,
  usedBy,
  onClose,
}: {
  readonly ingredient: Ingredient;
  readonly existing: readonly Ingredient[];
  readonly categories: readonly IngredientCategory[];
  readonly usedBy: readonly string[];
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(ingredient.name);
  const [unit, setUnit] = useState(ingredient.unit ?? "");

  // An ingredient whose category is gone is listed under Other, so its picker starts there.
  const [category, setCategory] = useState<string>(
    categories.some(({ id }) => id === ingredient.categoryId)
      ? ingredient.categoryId
      : OTHER_CATEGORY.id,
  );

  const taken = nameTaken(name, existing, ingredient.id);
  const unitChanged = unitOf(unit) !== ingredient.unit;

  const save = (event: FormEvent) => {
    event.preventDefault();

    follow(
      ingredientCollection.update(ingredient.id, (draft) => {
        draft.name = name.trim();
        draft.unit = unitOf(unit);
        draft.categoryId = category;
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
      {categories.some(({ id }) => id !== OTHER_CATEGORY.id) && (
        <div className="grid gap-1.5">
          <Label>Category</Label>
          <Choice
            items={categoryItems(categories)}
            value={category}
            onChange={setCategory}
            label="Category"
          />
        </div>
      )}
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

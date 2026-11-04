import { useLiveQuery } from "@tanstack/react-db";
import type { Ingredient, IngredientCategory } from "assistant/recipe-book";
import { CheckIcon, PlusIcon, TagsIcon, Trash2Icon } from "lucide-react";
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
import { categoryCollection, ingredientCollection, recipeCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";

const UNIT_HINT =
  "The one unit every recipe measures it in, like g, ml or pcs. Leave empty for none.";

/** The category picker's choice for an ingredient in no category; real ids are `category:…`. */
const NONE = "none";

/** Empty input is no unit. */
const unitOf = (text: string) => (text.trim() === "" ? null : text.trim());

const categoryOf = (choice: string) => (choice === NONE ? null : choice);

/** The category picker's options: none, then each category by name. */
const categoryItems = (categories: readonly IngredientCategory[]) => ({
  [NONE]: "No category",
  ...Object.fromEntries(categories.map((category) => [category.id, category.name])),
});

/**
 * The server keeps one ingredient, and one category, per name, ignoring case, so the forms refuse a name already on
 * the list.
 */
const nameTaken = (
  name: string,
  existing: readonly { readonly id: string; readonly name: string }[],
  except?: string,
) =>
  existing.some(
    (item) => item.id !== except && item.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

/**
 * The ingredients recipes are made from, grouped by category and then by name, each with the recipes that use it; the
 * categories are managed here too.
 */
export function IngredientsPanel() {
  const ingredients = useLiveQuery((q) =>
    q
      .from({ ingredient: ingredientCollection })
      .orderBy(({ ingredient }) => ingredient.name, "asc"),
  );

  const categories = useLiveQuery((q) =>
    q.from({ category: categoryCollection }).orderBy(({ category }) => category.name, "asc"),
  );

  const recipes = useLiveQuery((q) => q.from({ recipe: recipeCollection }));
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [managing, setManaging] = useState(false);

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

  const known = new Set(categories.data.map(({ id }) => id));

  // Each category in name order, empty ones included so they can be seen; then the ingredients in none, or in one
  // that is gone.
  const groups = [
    ...categories.data.map((category) => ({
      key: category.id,
      title: category.name,
      items: ingredients.data.filter(({ categoryId }) => categoryId === category.id),
    })),
    {
      key: NONE,
      title: "No category",
      items: ingredients.data.filter(
        ({ categoryId }) => categoryId === null || !known.has(categoryId),
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <AddIngredient existing={ingredients.data} categories={categories.data} />
      <Button variant="outline" className="self-start" onClick={() => setManaging(true)}>
        <TagsIcon />
        Categories{categories.data.length > 0 && ` · ${categories.data.length}`}
      </Button>
      {ingredients.data.length === 0 && categories.data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No ingredients yet.</p>
      ) : (
        groups.map((group) =>
          // Without categories there is one group, shown without a heading; an empty "No category" is left out.
          group.key === NONE && group.items.length === 0 ? null : (
            <section key={group.key} className="flex flex-col gap-2">
              {categories.data.length > 0 && (
                <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.title} · {group.items.length}
                </h3>
              )}
              {group.items.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No ingredients in it.</p>
              ) : (
                <IngredientList ingredients={group.items} usedBy={usedBy} onEdit={setEditing} />
              )}
            </section>
          ),
        )
      )}
      <EditIngredient
        ingredient={editing}
        existing={ingredients.data}
        categories={categories.data}
        usedBy={editing === null ? [] : usedBy(editing.id)}
        onClose={() => setEditing(null)}
      />
      <ManageCategories
        open={managing}
        categories={categories.data}
        ingredients={ingredients.data}
        onClose={() => setManaging(false)}
      />
    </div>
  );
}

function IngredientList({
  ingredients,
  usedBy,
  onEdit,
}: {
  readonly ingredients: readonly Ingredient[];
  readonly usedBy: (id: string) => readonly string[];
  readonly onEdit: (ingredient: Ingredient) => void;
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl bg-card">
      {ingredients.map((ingredient) => {
        const users = usedBy(ingredient.id);

        return (
          <li key={ingredient.id}>
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
                {users.length === 0
                  ? "unused"
                  : `${users.length} recipe${users.length === 1 ? "" : "s"}`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Adds an ingredient. The category stays chosen between adds, for entering several of one kind. */
function AddIngredient({
  existing,
  categories,
}: {
  readonly existing: readonly Ingredient[];
  readonly categories: readonly IngredientCategory[];
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState(NONE);
  const taken = nameTaken(name, existing);

  // A category deleted while chosen falls back to none.
  const chosen =
    category === NONE || categories.some(({ id }) => id === category) ? category : NONE;

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim() === "" || taken) return;

    follow(
      ingredientCollection.insert({
        id: `ingredient:app:${crypto.randomUUID()}`,
        name: name.trim(),
        unit: unitOf(unit),
        categoryId: categoryOf(chosen),
        createdAt: Date.now(),
      }),
    );
    setName("");
    setUnit("");
  };

  return (
    <form onSubmit={submit} className="grid gap-2">
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
      {categories.length > 0 && (
        <Choice
          items={categoryItems(categories)}
          value={chosen}
          onChange={setCategory}
          label="Category"
          className="bg-card"
        />
      )}
      {taken && <p className="px-1 text-xs text-destructive">Already on the list.</p>}
    </form>
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

  const [category, setCategory] = useState(
    categories.some(({ id }) => id === ingredient.categoryId)
      ? (ingredient.categoryId ?? NONE)
      : NONE,
  );

  const taken = nameTaken(name, existing, ingredient.id);
  const unitChanged = unitOf(unit) !== ingredient.unit;

  const save = (event: FormEvent) => {
    event.preventDefault();

    follow(
      ingredientCollection.update(ingredient.id, (draft) => {
        draft.name = name.trim();
        draft.unit = unitOf(unit);
        draft.categoryId = categoryOf(category);
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
      <div className="grid gap-1.5">
        <Label>Category</Label>
        <Choice
          items={categoryItems(categories)}
          value={category}
          onChange={setCategory}
          label="Category"
        />
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

/** Adds, renames and deletes categories. Deleting one keeps its ingredients, in no category. */
function ManageCategories({
  open,
  categories,
  ingredients,
  onClose,
}: {
  readonly open: boolean;
  readonly categories: readonly IngredientCategory[];
  readonly ingredients: readonly Ingredient[];
  readonly onClose: () => void;
}) {
  const [name, setName] = useState("");
  const taken = nameTaken(name, categories);

  const add = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim() === "" || taken) return;

    follow(
      categoryCollection.insert({
        id: `category:app:${crypto.randomUUID()}`,
        name: name.trim(),
        createdAt: Date.now(),
      }),
    );
    setName("");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Groups for ingredients, like Produce or Dairy. Deleting one keeps its ingredients.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={add} className="grid gap-1">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Add a category"
              maxLength={200}
              aria-invalid={taken}
              enterKeyHint="done"
            />
            <Button
              type="submit"
              size="icon"
              disabled={name.trim() === "" || taken}
              aria-label="Add category"
            >
              <PlusIcon />
            </Button>
          </div>
          {taken && <p className="px-1 text-xs text-destructive">Already on the list.</p>}
        </form>
        {categories.length === 0 ? (
          <p className="text-muted-foreground">No categories yet.</p>
        ) : (
          <ul className="grid gap-2">
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                categories={categories}
                count={ingredients.filter(({ categoryId }) => categoryId === category.id).length}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One category: its name, saved when changed, and a delete button. */
function CategoryRow({
  category,
  categories,
  count,
}: {
  readonly category: IngredientCategory;
  readonly categories: readonly IngredientCategory[];
  readonly count: number;
}) {
  const [name, setName] = useState(category.name);
  const taken = nameTaken(name, categories, category.id);
  const changed = name.trim() !== category.name;

  const rename = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim() === "" || taken || !changed) return;

    follow(
      categoryCollection.update(category.id, (draft) => {
        draft.name = name.trim();
      }),
    );
  };

  return (
    <li>
      <form onSubmit={rename} className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          aria-label={`Rename ${category.name}`}
          aria-invalid={taken || name.trim() === ""}
          enterKeyHint="done"
        />
        <span className="w-6 text-right text-xs text-muted-foreground" title="Ingredients in it">
          {count}
        </span>
        {changed ? (
          <Button
            type="submit"
            size="icon"
            variant="outline"
            disabled={name.trim() === "" || taken}
            aria-label={`Save ${name.trim()}`}
          >
            <CheckIcon />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => follow(categoryCollection.delete(category.id))}
            aria-label={`Delete ${category.name}`}
          >
            <Trash2Icon />
          </Button>
        )}
      </form>
    </li>
  );
}

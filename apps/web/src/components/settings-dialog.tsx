import { useLiveQuery } from "@tanstack/react-db";
import type { IngredientCategory } from "assistant/recipe-book";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { categoryCollection, ingredientCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";
import { nameTaken } from "@/lib/names";
import { compareCategories, OTHER_CATEGORY } from "utils/groceries";

/** The app's settings, reached from every tab: today, the ingredient categories. */
export function SettingsDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <IngredientCategories />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Adds, renames, reorders and deletes categories, listed as the ingredients and groceries are, with Other last. Other is
 * the default: it stays last, is neither renamed nor deleted, and deleting another moves its ingredients there.
 */
function IngredientCategories() {
  const categories = useLiveQuery((q) => q.from({ category: categoryCollection }));
  const ordered = [...categories.data].sort(compareCategories);
  const movable = ordered.filter(({ id }) => id !== OTHER_CATEGORY.id);

  // Other's name is taken even before the store's migration is seen.
  const names = [...categories.data, OTHER_CATEGORY];

  const ingredients = useLiveQuery((q) => q.from({ ingredient: ingredientCollection }));
  const [name, setName] = useState("");
  const taken = nameTaken(name, names);

  const add = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim() === "" || taken) return;

    follow(
      categoryCollection.insert({
        id: `category:app:${crypto.randomUUID()}`,
        name: name.trim(),
        // After the others, as the server adds it.
        position: Math.max(0, ...categories.data.map(({ position }) => position)) + 1,
        createdAt: Date.now(),
      }),
    );
    setName("");
  };

  /** Moves the category at `index` one place up or down, renumbering every one so the order is the whole list. */
  /** Puts the categories in this order, renumbering every one so the order is the whole list. */
  const reorder = (order: readonly string[]) =>
    follow(
      categoryCollection.update([...order], (drafts) => {
        for (const draft of drafts) draft.position = order.indexOf(draft.id) + 1;
      }),
    );

  /** Moves the category at `index` one place up or down. */
  const move = (index: number, by: -1 | 1) => {
    const order = movable.map(({ id }) => id);
    const [id] = order.splice(index, 1);

    order.splice(index + by, 0, id!);
    reorder(order);
  };

  const countIn = (id: string) =>
    ingredients.data.filter(({ categoryId }) => categoryId === id).length;

  return (
    <section className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="font-medium">Ingredient categories</h3>
        <DialogDescription>
          Groups for ingredients and the grocery list, like Produce or Dairy, in the order lists
          show them: the aisles of your shop, say. {OTHER_CATEGORY.name} is the default, always
          last; deleting a category moves its ingredients there. Lists show categories once there is
          one besides it.
        </DialogDescription>
      </div>
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
      <div className="grid gap-2">
        {/* Dragged by the grip only, so the list still scrolls and the names can be edited. */}
        <Sortable
          value={movable}
          onValueChange={(next) => reorder(next.map(({ id }) => id))}
          getItemValue={(category) => category.id}
          className="grid gap-2"
        >
          {movable.map((category, index) => (
            // The dragged copy is drawn over the dialog, so it has the dialog's background.
            <SortableItem key={category.id} value={category.id} className="rounded-lg bg-popover">
              <CategoryRow
                category={category}
                categories={names}
                count={countIn(category.id)}
                onMoveUp={index === 0 ? undefined : () => move(index, -1)}
                onMoveDown={index === movable.length - 1 ? undefined : () => move(index, 1)}
              />
            </SortableItem>
          ))}
        </Sortable>
        {/* Other stays last: it is not in the sortable list. */}
        <div className="flex h-8 items-center gap-2">
          {/* Lines up with the other rows' grip and move buttons. */}
          <span className="w-14" />
          <span className="flex-1 px-2.5">{OTHER_CATEGORY.name}</span>
          <span className="text-xs text-muted-foreground">Default</span>
          <span className="w-6 text-right text-xs text-muted-foreground">
            {countIn(OTHER_CATEGORY.id)}
          </span>
          {/* Lines up with the other rows' buttons. */}
          <span className="size-8" />
        </div>
      </div>
    </section>
  );
}

/** One category: a grip to drag it and buttons to move it, its name, saved when changed, and a delete button. */
function CategoryRow({
  category,
  categories,
  count,
  onMoveUp,
  onMoveDown,
}: {
  readonly category: IngredientCategory;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly count: number;
  /** Absent for the first category, which cannot move up. */
  readonly onMoveUp?: () => void;
  /** Absent for the last category before Other, which cannot move down. */
  readonly onMoveDown?: () => void;
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
    <form onSubmit={rename} className="flex items-center gap-2">
      {/* `touch-none` leaves the touch to the drag instead of scrolling the dialog. */}
      <SortableItemHandle
        className="flex h-8 w-6 touch-none items-center justify-center text-muted-foreground"
        aria-label={`Drag ${category.name} to reorder`}
      >
        <GripVerticalIcon className="size-4" />
      </SortableItemHandle>
      <div className="flex flex-col">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onMoveUp}
          disabled={onMoveUp === undefined}
          aria-label={`Move ${category.name} up`}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onMoveDown}
          disabled={onMoveDown === undefined}
          aria-label={`Move ${category.name} down`}
        >
          <ChevronDownIcon />
        </Button>
      </div>
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
  );
}

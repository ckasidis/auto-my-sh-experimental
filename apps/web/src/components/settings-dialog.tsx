import { useLiveQuery } from "@tanstack/react-db";
import type { IngredientCategory } from "assistant/recipe-book";
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
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
import { categoryCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";
import { nameTaken } from "@/lib/names";
import { compareCategories, OTHER_CATEGORY } from "utils/groceries";

/** The meals app's settings, reached from every tab: today, the ingredient categories. */
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
 * Adds, renames, reorders and deletes categories, listed as the ingredients and groceries are. Other is the default: it
 * is ordered like the others, but is neither renamed nor deleted, and deleting another moves its ingredients there.
 */
function IngredientCategories() {
  const categories = useLiveQuery((q) => q.from({ category: categoryCollection }));
  const ordered = [...categories.data].sort(compareCategories);

  // Other's name is taken even before the store's migration is seen.
  const names = [...categories.data, OTHER_CATEGORY];

  const [name, setName] = useState("");
  const taken = nameTaken(name, names);

  const add = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim() === "" || taken) return;

    // At the end, but before Other while it is last, as the server adds it; the refetch after brings the server's
    // numbers.
    const last = ordered.at(-1);

    follow(
      categoryCollection.insert({
        id: `category:app:${crypto.randomUUID()}`,
        name: name.trim(),
        position:
          last === undefined
            ? 1
            : last.id === OTHER_CATEGORY.id
              ? last.position - 0.5
              : last.position + 1,
        createdAt: Date.now(),
      }),
    );
    setName("");
  };

  /** Puts the categories in this order, renumbering every one so the order is the whole list. */
  const reorder = (order: readonly string[]) =>
    follow(
      categoryCollection.update([...order], (drafts) => {
        for (const draft of drafts) draft.position = order.indexOf(draft.id) + 1;
      }),
    );

  return (
    <section className="grid gap-3">
      <div className="grid gap-1">
        <h3 className="font-medium">Ingredient categories</h3>
        <DialogDescription>
          Groups for ingredients and the grocery list, like Produce or Dairy, in the order lists
          show them: the aisles of your shop, say. Drag to reorder. {OTHER_CATEGORY.name} is the
          default; deleting a category moves its ingredients there. Lists show categories once there
          is one besides it.
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
      {/* Dragged by the grip only, so the list still scrolls and the names can be edited. */}
      <Sortable
        value={ordered}
        onValueChange={(next) => reorder(next.map(({ id }) => id))}
        getItemValue={(category) => category.id}
        className="grid gap-1"
      >
        {ordered.map((category) => (
          // The dragged copy is drawn over the dialog, so it has the dialog's background.
          <SortableItem
            key={category.id}
            value={category.id}
            className="flex items-center gap-1 rounded-lg bg-popover"
          >
            {/* `touch-none` leaves the touch to the drag instead of scrolling the dialog. */}
            <SortableItemHandle
              className="flex h-8 w-6 shrink-0 touch-none items-center justify-center text-muted-foreground"
              aria-label={`Drag ${category.name} to reorder`}
            >
              <GripVerticalIcon className="size-4" />
            </SortableItemHandle>
            {category.id === OTHER_CATEGORY.id ? (
              <p className="flex h-8 flex-1 items-center gap-2 px-2.5 text-base md:text-sm">
                {category.name}
                <span className="text-xs text-muted-foreground">Default</span>
              </p>
            ) : (
              // Keyed by the name too, so a rename made elsewhere, such as in the chat, shows.
              <CategoryName key={category.name} category={category} categories={names} />
            )}
          </SortableItem>
        ))}
      </Sortable>
    </section>
  );
}

/**
 * A category's name, saved when it is left or entered, and a button that deletes it. A name that is empty or another
 * category's goes back to the saved one.
 */
function CategoryName({
  category,
  categories,
}: {
  readonly category: IngredientCategory;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}) {
  const [name, setName] = useState(category.name);
  const input = useRef<HTMLInputElement>(null);
  const taken = nameTaken(name, categories, category.id);

  const save = () => {
    if (name.trim() === "" || taken) {
      setName(category.name);

      return;
    }

    if (name.trim() === category.name) return;

    follow(
      categoryCollection.update(category.id, (draft) => {
        draft.name = name.trim();
      }),
    );
  };

  // Enter leaves the field, which saves it.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    input.current?.blur();
  };

  return (
    <form onSubmit={submit} className="flex flex-1 items-center gap-1">
      <Input
        ref={input}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        maxLength={200}
        aria-label={`Rename ${category.name}`}
        aria-invalid={taken || name.trim() === ""}
        enterKeyHint="done"
        // Reads as text until it is edited.
        className="border-transparent dark:bg-transparent"
      />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={() => follow(categoryCollection.delete(category.id))}
        className="text-muted-foreground"
        aria-label={`Delete ${category.name}`}
      >
        <Trash2Icon />
      </Button>
    </form>
  );
}

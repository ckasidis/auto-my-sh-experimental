import { isNull, not, useLiveQuery } from "@tanstack/react-db";
import type { Todo } from "assistant/user-store";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todoCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";
import { formatRelative, formatWhen, fromLocalInput, toLocalInput } from "@/lib/time";
import { cn } from "@/lib/utils";

/** The owner's todos: open ones soonest due first, then the done ones, most recently finished first. */
export function TodosPanel() {
  const open = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => isNull(todo.completedAt))
      .orderBy(({ todo }) => todo.dueAt, { direction: "asc", nulls: "last" })
      .orderBy(({ todo }) => todo.createdAt, "asc"),
  );

  const done = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => not(isNull(todo.completedAt)))
      .orderBy(({ todo }) => todo.completedAt, "desc"),
  );

  const [editing, setEditing] = useState<Todo | null>(null);
  const [showDone, setShowDone] = useState(false);

  if (open.isLoadingError || done.isLoadingError) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load todos.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <AddTodo />
      {open.data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing to do.</p>
      ) : (
        <TodoList todos={open.data} onEdit={setEditing} />
      )}
      {done.data.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            className="flex items-center gap-1 self-start px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
            onClick={() => setShowDone(!showDone)}
            aria-expanded={showDone}
          >
            Done · {done.data.length}
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", showDone && "rotate-180")}
            />
          </button>
          {showDone && <TodoList todos={done.data} onEdit={setEditing} />}
        </section>
      )}
      <EditTodo todo={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function AddTodo() {
  const [title, setTitle] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();

    if (trimmed === "") return;

    follow(
      todoCollection.insert({
        id: `todo:app:${crypto.randomUUID()}`,
        title: trimmed,
        notes: null,
        dueAt: null,
        createdAt: Date.now(),
        completedAt: null,
      }),
    );
    setTitle("");
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a todo"
        maxLength={500}
        className="h-10 bg-card"
        enterKeyHint="done"
      />
      <Button
        type="submit"
        size="icon-lg"
        className="size-10"
        disabled={title.trim() === ""}
        aria-label="Add"
      >
        <PlusIcon />
      </Button>
    </form>
  );
}

function TodoList({
  todos,
  onEdit,
}: {
  readonly todos: readonly Todo[];
  readonly onEdit: (todo: Todo) => void;
}) {
  const now = Date.now();

  return (
    <ul className="divide-y overflow-hidden rounded-xl bg-card">
      {todos.map((todo) => {
        const isDone = todo.completedAt !== null;
        const overdue = !isDone && todo.dueAt !== null && todo.dueAt < now;

        return (
          <li key={todo.id} className="flex items-start gap-3 px-3 py-2.5">
            <Checkbox
              className="mt-0.5 size-5 rounded-full"
              checked={isDone}
              onCheckedChange={(checked) =>
                follow(
                  todoCollection.update(todo.id, (draft) => {
                    draft.completedAt = checked ? Date.now() : null;
                  }),
                )
              }
              aria-label={isDone ? `Mark ${todo.title} open` : `Mark ${todo.title} done`}
            />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(todo)}>
              <p
                className={cn(
                  "text-[0.95rem] leading-snug",
                  isDone && "text-muted-foreground line-through",
                )}
              >
                {todo.title}
              </p>
              {todo.notes !== null && (
                <p className="truncate text-xs text-muted-foreground">{todo.notes}</p>
              )}
              {todo.dueAt !== null && !isDone && (
                <p
                  className={cn(
                    "mt-0.5 text-xs",
                    overdue ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  Due {formatWhen(todo.dueAt)}
                  {formatRelative(todo.dueAt, now) !== "" &&
                    ` · ${formatRelative(todo.dueAt, now)}`}
                </p>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Edits a todo's title, notes and due date, or deletes it. A due date is only a deadline: it sends no reminder. */
function EditTodo({ todo, onClose }: { readonly todo: Todo | null; readonly onClose: () => void }) {
  return (
    <Dialog open={todo !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Keyed so the form starts from the todo it opens on. */}
        {todo !== null && <EditTodoForm key={todo.id} todo={todo} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditTodoForm({ todo, onClose }: { readonly todo: Todo; readonly onClose: () => void }) {
  const [title, setTitle] = useState(todo.title);
  const [notes, setNotes] = useState(todo.notes ?? "");
  const [due, setDue] = useState(todo.dueAt === null ? "" : toLocalInput(todo.dueAt));

  const save = (event: FormEvent) => {
    event.preventDefault();
    const trimmedNotes = notes.trim();

    follow(
      todoCollection.update(todo.id, (draft) => {
        draft.title = title.trim();
        draft.notes = trimmedNotes === "" ? null : trimmedNotes;
        draft.dueAt = fromLocalInput(due);
      }),
    );
    onClose();
  };

  const remove = () => {
    follow(todoCollection.delete(todo.id));
    onClose();
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Edit todo</DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="todo-title">Title</Label>
        <Input
          id="todo-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={500}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="todo-notes">Notes</Label>
        <Textarea
          id="todo-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={10_000}
          rows={3}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="todo-due">Due</Label>
        <div className="flex gap-2">
          <Input
            id="todo-due"
            type="datetime-local"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
          {due !== "" && (
            <Button type="button" variant="outline" onClick={() => setDue("")}>
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          A deadline only. For a reminder, add a schedule.
        </p>
      </div>
      <DialogFooter className="flex-row justify-between sm:justify-between">
        <Button type="button" variant="destructive" onClick={remove}>
          Delete
        </Button>
        <Button type="submit" disabled={title.trim() === ""}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

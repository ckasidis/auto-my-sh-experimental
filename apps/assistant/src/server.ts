import { exports, WorkerEntrypoint } from "cloudflare:workers";
import { ChannelGateway } from "agents/experimental/channels";
import { assistant } from "./assistant.ts";
import { telegramChannel } from "./chat.ts";
import { verifyInitData } from "./init-data.ts";
import type { GroceryItem } from "utils/groceries";
import type {
  DateRange,
  Ingredient,
  IngredientCategory,
  IngredientChanges,
  Meal,
  MealChanges,
  NewIngredient,
  NewIngredientCategory,
  NewMeal,
  NewRecipe,
  Recipe,
  RecipeChanges,
} from "./recipe-book.ts";
import type { Schedule, ScheduleRequest } from "./schedule.ts";
import { TELEGRAM_CHANNEL, WEBHOOK_PATH } from "./telegram.ts";
import {
  type NewTodo,
  type Todo,
  type TodoChanges,
  type TodoFilter,
  userStore,
} from "./user-store.ts";
import type {
  Exercise,
  NewExercise,
  NewWorkoutEntry,
  WorkoutEntry,
  WorkoutEntryChanges,
  WorkoutFilter,
} from "./workout-log.ts";

export { Assistant } from "./assistant.ts";

export { UserStore } from "./user-store.ts";

/**
 * The Telegram webhook, over HTTP, and, over RPC for the web Worker's service binding, the Mini App's owner check and
 * the owner's todos, recipe book, workout log, and schedules without the model; callers check the owner first. The RPC methods are reachable only through a service
 * binding, never from the internet. Web types the binding from this class's emitted declarations. The return types are
 * written out: inferred ones carry the Durable Object stubs' `Disposable`, and the binding's `Rpc` types turn a single
 * such object into `never`.
 */
export default class Server extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== WEBHOOK_PATH) {
      return new Response("Not found", { status: 404 });
    }

    // The gateway verifies the webhook secret, keeps only the owner's messages, and routes them to the assistant.
    // A failure answers 500, so Telegram redelivers; handling is idempotent per update.
    const gateway = new ChannelGateway({
      channels: { [TELEGRAM_CHANNEL]: telegramChannel },
      agent: (route) => exports.Assistant.getByName(route),
    });

    return (await gateway.fetch(request)) ?? new Response("Not found", { status: 404 });
  }

  /** Whether Telegram signed the Mini App's `initData` for the owner; the bot token never leaves this Worker. */
  async isOwner(initData: string): Promise<boolean> {
    const userId = await verifyInitData(initData, this.env.TELEGRAM_BOT_TOKEN, Date.now());

    return userId === this.env.TELEGRAM_CHAT_ID;
  }

  async listTodos(filter?: TodoFilter): Promise<Todo[]> {
    return userStore().list(filter);
  }

  async addTodo(todo: NewTodo): Promise<Todo> {
    return userStore().add(todo);
  }

  async updateTodo(id: string, changes: TodoChanges): Promise<Todo | null> {
    return userStore().update(id, changes);
  }

  async removeTodo(id: string): Promise<boolean> {
    return userStore().remove(id);
  }

  async listCategories(): Promise<IngredientCategory[]> {
    return userStore().listCategories();
  }

  async addCategory(category: NewIngredientCategory): Promise<IngredientCategory> {
    return userStore().addCategory(category);
  }

  async renameCategory(id: string, name: string): Promise<IngredientCategory | null> {
    return userStore().renameCategory(id, name);
  }

  async removeCategory(id: string): Promise<boolean> {
    return userStore().removeCategory(id);
  }

  async reorderCategories(ids: string[]): Promise<IngredientCategory[]> {
    return userStore().reorderCategories(ids);
  }

  async listIngredients(): Promise<Ingredient[]> {
    return userStore().listIngredients();
  }

  async addIngredient(ingredient: NewIngredient): Promise<Ingredient> {
    return userStore().addIngredient(ingredient);
  }

  async updateIngredient(id: string, changes: IngredientChanges): Promise<Ingredient | null> {
    return userStore().updateIngredient(id, changes);
  }

  async removeIngredient(id: string): Promise<boolean> {
    return userStore().removeIngredient(id);
  }

  async listRecipes(): Promise<Recipe[]> {
    return userStore().listRecipes();
  }

  async addRecipe(recipe: NewRecipe): Promise<Recipe> {
    return userStore().addRecipe(recipe);
  }

  async updateRecipe(id: string, changes: RecipeChanges): Promise<Recipe | null> {
    return userStore().updateRecipe(id, changes);
  }

  async removeRecipe(id: string): Promise<boolean> {
    return userStore().removeRecipe(id);
  }

  async listMeals(range?: DateRange): Promise<Meal[]> {
    return userStore().listMeals(range);
  }

  async addMeal(meal: NewMeal): Promise<Meal> {
    return userStore().addMeal(meal);
  }

  async updateMeal(id: string, changes: MealChanges): Promise<Meal | null> {
    return userStore().updateMeal(id, changes);
  }

  async removeMeal(id: string): Promise<boolean> {
    return userStore().removeMeal(id);
  }

  async groceryList(range: DateRange): Promise<GroceryItem[]> {
    return userStore().groceryList(range);
  }

  async listExercises(): Promise<Exercise[]> {
    return userStore().listExercises();
  }

  async addExercise(exercise: NewExercise): Promise<Exercise> {
    return userStore().addExercise(exercise);
  }

  async renameExercise(id: string, name: string): Promise<Exercise | null> {
    return userStore().renameExercise(id, name);
  }

  async removeExercise(id: string): Promise<boolean> {
    return userStore().removeExercise(id);
  }

  async listWorkoutEntries(filter?: WorkoutFilter): Promise<WorkoutEntry[]> {
    return userStore().listWorkoutEntries(filter);
  }

  async addWorkoutEntry(entry: NewWorkoutEntry): Promise<WorkoutEntry> {
    return userStore().addWorkoutEntry(entry);
  }

  async updateWorkoutEntry(id: string, changes: WorkoutEntryChanges): Promise<WorkoutEntry | null> {
    return userStore().updateWorkoutEntry(id, changes);
  }

  async removeWorkoutEntry(id: string): Promise<boolean> {
    return userStore().removeWorkoutEntry(id);
  }

  async listSchedules(): Promise<Schedule[]> {
    return assistant().listSchedules();
  }

  async addSchedule(request: ScheduleRequest): Promise<Schedule> {
    return assistant().addSchedule(request);
  }

  async cancelSchedule(id: string): Promise<boolean> {
    return assistant().cancelSchedule(id);
  }
}

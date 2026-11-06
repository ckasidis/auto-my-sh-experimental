import { createFileRoute } from "@tanstack/react-router";
import { MealsPanel } from "@/components/meals-panel";
import { MiniApp } from "@/components/mini-app";
import {
  categoryCollection,
  ingredientCollection,
  mealCollection,
  recipeCollection,
} from "@/lib/collections";
import { loadMiniApp } from "@/lib/mini-app";

/** The meals Mini App: the meal prep calendar, the grocery list, recipes and ingredients. */
export const Route = createFileRoute("/meals")({
  ssr: false,
  loader: () =>
    loadMiniApp([categoryCollection, ingredientCollection, recipeCollection, mealCollection]),
  component: MealsApp,
});

function MealsApp() {
  const { inTelegram } = Route.useLoaderData();

  return (
    <MiniApp inTelegram={inTelegram}>
      <MealsPanel />
    </MiniApp>
  );
}

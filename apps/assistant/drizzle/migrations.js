import journal from './meta/_journal.json';
import m0000 from './0000_todos.sql';
import m0001 from './0001_recipes.sql';
import m0002 from './0002_ingredient_categories.sql';
import m0003 from './0003_other_category.sql';
import m0004 from './0004_category_order.sql';
import m0005 from './0005_other_sortable.sql';
import m0006 from './0006_workouts.sql';
import m0007 from './0007_workout_sessions.sql';
import m0008 from './0008_drop_workout_entries.sql';
import m0009 from './0009_grocery_purchases.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007,
m0008,
m0009
    }
  }
  
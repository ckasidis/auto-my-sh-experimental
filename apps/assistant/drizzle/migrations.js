import journal from './meta/_journal.json';
import m0000 from './0000_todos.sql';
import m0001 from './0001_recipes.sql';
import m0002 from './0002_ingredient_categories.sql';
import m0003 from './0003_other_category.sql';
import m0004 from './0004_category_order.sql';
import m0005 from './0005_other_sortable.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005
    }
  }
  
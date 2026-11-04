import journal from './meta/_journal.json';
import m0000 from './0000_todos.sql';
import m0001 from './0001_recipes.sql';
import m0002 from './0002_ingredient_categories.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002
    }
  }
  
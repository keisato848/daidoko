/**
 * Service layer barrel export
 */
export {
  getRecipeList,
  getRecipeDetail,
  searchRecipes,
  createRecipe,
  updateRecipe,
  deleteRecipe,
} from './recipe.service';
export { getTimeline } from './timeline.service';
export { createCookingLog, getLogsForRecipe } from './cooking-log.service';
export { getTagsForFamily, upsertTags } from './tag.service';
export { searchByFts, updateFtsIndex, removeFtsEntry } from './fts.service';
export type {
  RecipeListItem,
  RecipeDetail,
  IngredientItem,
  StepItem,
  TimelineEntry,
  SaveRecipeInput,
  UpdateRecipeInput,
  TagItem,
  SaveCookingLogInput,
  CookingLogEntry,
} from './types';

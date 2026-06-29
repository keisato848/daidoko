/**
 * Service layer barrel export
 */
export {
  getRecipeList,
  getRecipeDetail,
  searchRecipes,
  createRecipe,
  createRecipeMemo,
  getMemosForRecipe,
  updateRecipe,
  deleteRecipe,
} from './recipe.service';
export { getTimeline } from './timeline.service';
export { createCookingLog, deleteCookingLog, getLogsForRecipe } from './cooking-log.service';
export { createOcrSource } from './source.service';
export { capturePhoto, cleanupTemporaryPhotos } from './photo-capture.service';
export { preprocessImageForOcr } from './image-preprocess.service';
export { createClientOcrRecognizer, isClientOcrAvailable } from './client-ocr.provider';
export { getTagsForFamily, upsertTags } from './tag.service';
export {
  getShoppingItems,
  addShoppingItem,
  addRecipeIngredientsToList,
  setShoppingItemChecked,
  removeShoppingItem,
  clearCheckedShoppingItems,
} from './shopping-list.service';
export {
  addFamilyMember,
  getCurrentFamily,
  getCurrentFamilyProfile,
  getCurrentUser,
  getCurrentUserProfile,
  getFamilyMembers,
  joinFamilyByInviteCode,
  removeFamilyMember,
  rotateCurrentFamilyInviteCode,
  updateCurrentFamilyName,
  updateCurrentUserDisplayName,
} from './user.service';
export { searchByFts, updateFtsIndex, removeFtsEntry } from './fts.service';
export type {
  RecipeListItem,
  RecipeDetail,
  MemoItem,
  IngredientItem,
  StepItem,
  TimelineEntry,
  SaveRecipeInput,
  UpdateRecipeInput,
  TagItem,
  ShoppingItem,
  ShoppingItemSource,
  CookingPhotoItem,
  SaveCookingLogInput,
  SaveCookingPhotoInput,
  CookingLogEntry,
  CurrentFamily,
  CurrentUser,
  FamilyMember,
  FamilyRole,
  JoinFamilyResult,
} from './types';

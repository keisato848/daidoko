/**
 * Service layer shared types
 * Used across all services for consistent data contracts
 */

export interface RecipeListItem {
  id: string;
  title: string;
  cookTimeMin: number | null;
  rating: number | null;
  tags: string[];
  ingredientNames: string[];
  /** ISO timestamp the recipe was created (for "newest" sort) */
  createdAt: string;
  /** Number of cooking logs recorded for this recipe (for "most cooked" sort) */
  cookCount: number;
  /** Latest cooking photo (cloud or local) shown as the card image, if any */
  heroPhotoUri: string | null;
}

export interface RecipeDetail {
  id: string;
  title: string;
  servings: number | null;
  cookTimeMin: number | null;
  description: string | null;
  rating: number | null;
  tags: string[];
  ingredients: IngredientItem[];
  steps: StepItem[];
  /** Latest cooking photo (cloud or local) shown as the detail header, if any */
  heroPhotoUri: string | null;
}

export interface MemoItem {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
}

export interface RecipeRevisionSummary {
  id: string;
  recipeId: string;
  revisionNumber: number;
  isMajor: boolean;
  createdBy: string;
  createdAt: string;
  servings: number | null;
  cookTimeMin: number | null;
  prepTimeMin: number | null;
  description: string | null;
  authorNote: string | null;
  sourceId: string | null;
  ingredientCount: number;
  stepCount: number;
  isCurrent: boolean;
}

export interface IngredientItem {
  id: string;
  groupLabel: string | null;
  name: string;
  amount: string | null;
  note: string | null;
  sortOrder: number;
}

export interface StepItem {
  id: string;
  body: string;
  timerSec: number | null;
  sortOrder: number;
}

export interface TimelineEntry {
  id: string;
  recipeId: string | null;
  recipeTitle: string;
  userName: string;
  cookedAt: string;
  servings: number | null;
  rating: number | null;
  memo: string | null;
  photos: CookingPhotoItem[];
}

export interface CookingPhotoItem {
  id: string;
  localPath: string;
  cloudUrl: string | null;
  sortOrder: number;
  takenAt: string | null;
  createdAt: string;
}

export interface SaveRecipeInput {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  prepTimeMin?: number;
  authorNote?: string;
  sourceId?: string;
  ingredients: {
    groupLabel?: string;
    name: string;
    amount?: string;
    note?: string;
  }[];
  steps: {
    body: string;
    timerSec?: number;
  }[];
  tags: string[];
}

export interface UpdateRecipeInput extends SaveRecipeInput {
  isMajor?: boolean;
}

export interface TagItem {
  id: string;
  name: string;
  color: string | null;
}

export type FamilyRole = 'owner' | 'member';

export interface CurrentUser {
  id: string;
  displayName: string;
}

export interface CurrentFamily {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  memberCount: number;
}

export interface FamilyMember {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: FamilyRole;
  joinedAt: string;
  isCurrentUser: boolean;
}

export interface JoinFamilyResult {
  status: 'joined' | 'already-member';
  family: CurrentFamily;
}

export interface SaveCookingLogInput {
  recipeId?: string;
  servings?: number;
  rating?: number;
  memo?: string;
  cookedAt: string;
  photos?: SaveCookingPhotoInput[];
}

export interface SaveCookingPhotoInput {
  localPath: string;
  cloudUrl?: string | null;
  takenAt?: string;
}

export interface CookingLogEntry {
  id: string;
  recipeId: string | null;
  recipeTitle: string;
  userName: string;
  cookedAt: string;
  servings: number | null;
  rating: number | null;
  memo: string | null;
  photos: CookingPhotoItem[];
}

export type ShoppingItemSource = 'manual' | 'recipe' | 'low_stock' | 'receipt';

export interface ShoppingItem {
  id: string;
  name: string;
  amount: string | null;
  checked: boolean;
  source: ShoppingItemSource;
  recipeId: string | null;
}

export interface PantryItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  lowStockThreshold: number | null;
  janCode: string | null;
}

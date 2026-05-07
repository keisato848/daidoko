/**
 * Web mock data provider — Web デバッグ用にシードデータを直接返す
 */
import {
  seedCookingLogs,
  seedIngredients,
  seedRecipeTags,
  seedRecipes,
  seedRevisions,
  seedSteps,
  seedTags,
  seedUsers,
} from './seed';

// Build lookup maps from seed data for fast access
const usersMap = new Map(seedUsers.map((u) => [u.id, u]));
const revisionsMap = new Map(seedRevisions.map((r) => [r.id, r]));
const tagsMap = new Map(seedTags.map((t) => [t.id, t]));

export interface MockTimelineEntry {
  id: string;
  recipeId: string | null;
  recipeTitle: string;
  userName: string;
  cookedAt: string;
  rating: number | null;
  memo: string | null;
}

export interface MockRecipeListItem {
  id: string;
  title: string;
  cookTimeMin: number | null;
  rating: number | null;
  tags: string[];
  ingredientNames: string[];
}

export interface MockRecipeDetail {
  id: string;
  title: string;
  servings: number | null;
  cookTimeMin: number | null;
  description: string | null;
  rating: number | null;
  tags: string[];
  ingredients: {
    id: string;
    groupLabel: string | null;
    name: string;
    amount: string | null;
    note: string | null;
    sortOrder: number;
  }[];
  steps: {
    id: string;
    body: string;
    timerSec: number | null;
    sortOrder: number;
  }[];
}

export function getMockTimeline(): MockTimelineEntry[] {
  return [...seedCookingLogs]
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt))
    .map((log) => {
      const recipe = seedRecipes.find((r) => r.id === log.recipeId);
      const user = usersMap.get(log.cookedBy);
      return {
        id: log.id,
        recipeId: log.recipeId,
        recipeTitle: recipe?.title ?? 'フリー記録',
        userName: user?.displayName ?? '不明',
        cookedAt: log.cookedAt,
        rating: log.rating,
        memo: log.memo,
      };
    });
}

export function getMockRecipeList(): MockRecipeListItem[] {
  return seedRecipes.map((recipe) => {
    const rev = recipe.currentRevId ? revisionsMap.get(recipe.currentRevId) : undefined;

    const tagIds = seedRecipeTags.filter((rt) => rt.recipeId === recipe.id).map((rt) => rt.tagId);
    const tags = tagIds.map((tid) => tagsMap.get(tid)?.name ?? '').filter(Boolean);

    const ings = recipe.currentRevId
      ? seedIngredients.filter((i) => i.revisionId === recipe.currentRevId).map((i) => i.name)
      : [];

    // Average rating from cooking logs
    const logs = seedCookingLogs.filter((l) => l.recipeId === recipe.id && l.rating != null);
    const avgRating =
      logs.length > 0
        ? Math.round(logs.reduce((sum, l) => sum + (l.rating ?? 0), 0) / logs.length)
        : null;

    return {
      id: recipe.id,
      title: recipe.title,
      cookTimeMin: rev?.cookTimeMin ?? null,
      rating: avgRating,
      tags,
      ingredientNames: ings,
    };
  });
}

export function getMockRecipeDetail(recipeId: string): MockRecipeDetail | null {
  const recipe = seedRecipes.find((r) => r.id === recipeId);
  if (!recipe) return null;

  const rev = recipe.currentRevId ? revisionsMap.get(recipe.currentRevId) : undefined;

  const tagIds = seedRecipeTags.filter((rt) => rt.recipeId === recipe.id).map((rt) => rt.tagId);
  const tags = tagIds.map((tid) => tagsMap.get(tid)?.name ?? '').filter(Boolean);

  const ingredients = recipe.currentRevId
    ? [...seedIngredients]
        .filter((i) => i.revisionId === recipe.currentRevId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const steps = recipe.currentRevId
    ? [...seedSteps]
        .filter((s) => s.revisionId === recipe.currentRevId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const logs = seedCookingLogs.filter((l) => l.recipeId === recipe.id && l.rating != null);
  const avgRating =
    logs.length > 0
      ? Math.round(logs.reduce((sum, l) => sum + (l.rating ?? 0), 0) / logs.length)
      : null;

  return {
    id: recipe.id,
    title: recipe.title,
    servings: rev?.servings ?? null,
    cookTimeMin: rev?.cookTimeMin ?? null,
    description: rev?.description ?? null,
    rating: avgRating,
    tags,
    ingredients,
    steps,
  };
}

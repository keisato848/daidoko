/**
 * Web mock data provider — mutable mock state for web debugging
 * Supports read/write operations for CRUD testing without SQLite
 */
import { generateId } from '../utils/id';
import type {
  CookingPhotoItem,
  RecipeDetail,
  RecipeListItem,
  RecipeRevisionSummary,
  SaveCookingLogInput,
  SaveRecipeInput,
  TagItem,
  TimelineEntry,
  UpdateRecipeInput,
} from '../services/types';
import {
  seedCookingLogs,
  seedCookingPhotos,
  seedIngredients,
  seedRecipeTags,
  seedRecipes,
  seedRevisions,
  seedSteps,
  seedTags,
  seedUsers,
} from './seed';

// ─── Mutable State ─────────────────────────────────────────────────────────────

interface MutableRecipe {
  id: string;
  familyId: string;
  title: string;
  titleReading: string | null;
  currentRevId: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface MutableRevision {
  id: string;
  recipeId: string;
  revisionNumber: number;
  isMajor: boolean;
  servings: number | null;
  cookTimeMin: number | null;
  prepTimeMin: number | null;
  description: string | null;
  authorNote: string | null;
  sourceId: string | null;
  createdBy: string;
  createdAt: string;
}

interface MutableIngredient {
  id: string;
  revisionId: string;
  sortOrder: number;
  groupLabel: string | null;
  name: string;
  amount: string | null;
  note: string | null;
}

interface MutableStep {
  id: string;
  revisionId: string;
  sortOrder: number;
  body: string;
  timerSec: number | null;
  photoId: string | null;
}

interface MutableTag {
  id: string;
  familyId: string;
  name: string;
  color: string | null;
}

interface MutableRecipeTag {
  recipeId: string;
  tagId: string;
}

interface MutableSource {
  id: string;
  type: string;
  url: string | null;
  ocrRawText: string | null;
  siteName: string | null;
  pageTitle: string | null;
  thumbnailUrl: string | null;
  capturedAt: string | null;
  createdAt: string;
}

interface MutableCookingLog {
  id: string;
  recipeId: string | null;
  cookedBy: string;
  cookedAt: string;
  servings: number | null;
  rating: number | null;
  memo: string | null;
}

interface MutableCookingPhoto {
  id: string;
  logId: string;
  localPath: string;
  cloudUrl: string | null;
  sortOrder: number;
  takenAt: string | null;
  createdAt: string;
}

// Initialize mutable copies from seed data
const mockRecipes: MutableRecipe[] = seedRecipes.map((r) => ({
  ...r,
  titleReading: r.titleReading ?? null,
}));
const mockRevisions: MutableRevision[] = seedRevisions.map((r) => ({ ...r }));
const mockIngredients: MutableIngredient[] = seedIngredients.map((i) => ({ ...i }));
const mockSteps: MutableStep[] = seedSteps.map((s) => ({ ...s }));
const mockTags: MutableTag[] = seedTags.map((t) => ({ ...t }));
let mockRecipeTags: MutableRecipeTag[] = seedRecipeTags.map((rt) => ({ ...rt }));
const mockSources: MutableSource[] = [];
const mockCookingLogs: MutableCookingLog[] = seedCookingLogs.map((l) => ({ ...l }));
const mockCookingPhotos: MutableCookingPhoto[] = seedCookingPhotos.map((p) => ({ ...p }));

const usersMap = new Map<string, (typeof seedUsers)[number]>(seedUsers.map((u) => [u.id, u]));

function getPhotosForLog(logId: string): CookingPhotoItem[] {
  return mockCookingPhotos
    .filter((photo) => photo.logId === logId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ logId: _logId, ...photo }) => photo);
}

// ─── Read Operations ────────────────────────────────────────────────────────────

export function getMockTimeline(): TimelineEntry[] {
  return [...mockCookingLogs]
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt))
    .map((log) => {
      const recipe = mockRecipes.find((r) => r.id === log.recipeId);
      const user = usersMap.get(log.cookedBy);
      return {
        id: log.id,
        recipeId: recipe?.status === 'active' ? log.recipeId : null,
        recipeTitle: recipe?.title ?? 'フリー記録',
        userName: user?.displayName ?? '不明',
        cookedAt: log.cookedAt,
        servings: log.servings,
        rating: log.rating,
        memo: log.memo,
        photos: getPhotosForLog(log.id),
      };
    });
}

export function getMockRecipeList(): RecipeListItem[] {
  return mockRecipes
    .filter((recipe) => recipe.status === 'active')
    .map((recipe) => {
      const rev = recipe.currentRevId
        ? mockRevisions.find((r) => r.id === recipe.currentRevId)
        : undefined;

      const tagIds = mockRecipeTags.filter((rt) => rt.recipeId === recipe.id).map((rt) => rt.tagId);
      const tags = tagIds
        .map((tid) => mockTags.find((t) => t.id === tid)?.name ?? '')
        .filter(Boolean);

      const ings = recipe.currentRevId
        ? mockIngredients.filter((i) => i.revisionId === recipe.currentRevId).map((i) => i.name)
        : [];

      const recipeLogs = seedCookingLogs.filter((l) => l.recipeId === recipe.id);
      const logs = recipeLogs.filter((l) => l.rating != null);
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
        createdAt: recipe.createdAt,
        cookCount: recipeLogs.length,
        heroPhotoUri: null,
      };
    });
}

export function getMockRecipeDetail(recipeId: string): RecipeDetail | null {
  const recipe = mockRecipes.find((r) => r.id === recipeId && r.status === 'active');
  if (!recipe) return null;

  const rev = recipe.currentRevId
    ? mockRevisions.find((r) => r.id === recipe.currentRevId)
    : undefined;

  const tagIds = mockRecipeTags.filter((rt) => rt.recipeId === recipe.id).map((rt) => rt.tagId);
  const tags = tagIds.map((tid) => mockTags.find((t) => t.id === tid)?.name ?? '').filter(Boolean);

  const ingredients = recipe.currentRevId
    ? [...mockIngredients]
        .filter((i) => i.revisionId === recipe.currentRevId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const steps = recipe.currentRevId
    ? [...mockSteps]
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
    heroPhotoUri: null,
  };
}

export function getMockRecipeRevisions(recipeId: string): RecipeRevisionSummary[] {
  const recipe = mockRecipes.find((r) => r.id === recipeId && r.status === 'active');
  if (!recipe) return [];

  return mockRevisions
    .filter((revision) => revision.recipeId === recipeId)
    .sort((a, b) => b.revisionNumber - a.revisionNumber)
    .map((revision) => ({
      id: revision.id,
      recipeId: revision.recipeId,
      revisionNumber: revision.revisionNumber,
      isMajor: revision.isMajor,
      createdBy: revision.createdBy,
      createdAt: revision.createdAt,
      servings: revision.servings,
      cookTimeMin: revision.cookTimeMin,
      prepTimeMin: revision.prepTimeMin,
      description: revision.description,
      authorNote: revision.authorNote,
      sourceId: revision.sourceId,
      ingredientCount: mockIngredients.filter((ingredient) => ingredient.revisionId === revision.id)
        .length,
      stepCount: mockSteps.filter((step) => step.revisionId === revision.id).length,
      isCurrent: recipe.currentRevId === revision.id,
    }));
}

export function getMockTags(): TagItem[] {
  return mockTags.map((t) => ({ id: t.id, name: t.name, color: t.color }));
}

// ─── Write Operations ───────────────────────────────────────────────────────────

export function createMockRecipe(input: SaveRecipeInput): string {
  const recipeId = generateId();
  const revId = generateId();
  const now = new Date().toISOString();

  mockRecipes.push({
    id: recipeId,
    familyId: 'family-001',
    title: input.title,
    titleReading: input.titleReading ?? null,
    currentRevId: revId,
    status: 'active',
    createdBy: 'user-kei',
    createdAt: now,
    updatedAt: now,
  });

  mockRevisions.push({
    id: revId,
    recipeId,
    revisionNumber: 1,
    isMajor: true,
    servings: input.servings ?? null,
    cookTimeMin: input.cookTimeMin ?? null,
    prepTimeMin: input.prepTimeMin ?? null,
    description: input.description ?? null,
    authorNote: input.authorNote ?? null,
    sourceId: input.sourceId ?? null,
    createdBy: 'user-kei',
    createdAt: now,
  });

  input.ingredients.forEach((ing, i) => {
    mockIngredients.push({
      id: generateId(),
      revisionId: revId,
      sortOrder: i + 1,
      groupLabel: ing.groupLabel ?? null,
      name: ing.name,
      amount: ing.amount ?? null,
      note: ing.note ?? null,
    });
  });

  input.steps.forEach((step, i) => {
    mockSteps.push({
      id: generateId(),
      revisionId: revId,
      sortOrder: i + 1,
      body: step.body,
      timerSec: step.timerSec ?? null,
      photoId: null,
    });
  });

  // Handle tags
  for (const tagName of input.tags) {
    let tag = mockTags.find((t) => t.name === tagName);
    if (!tag) {
      tag = { id: generateId(), familyId: 'family-001', name: tagName, color: null };
      mockTags.push(tag);
    }
    mockRecipeTags.push({ recipeId, tagId: tag.id });
  }

  return recipeId;
}

export function updateMockRecipe(recipeId: string, input: UpdateRecipeInput): string {
  const recipe = mockRecipes.find((r) => r.id === recipeId);
  if (!recipe) throw new Error('Recipe not found');

  const revId = generateId();
  const now = new Date().toISOString();

  // Get next revision number
  const currentRev = recipe.currentRevId
    ? mockRevisions.find((r) => r.id === recipe.currentRevId)
    : undefined;
  const nextRevNum = (currentRev?.revisionNumber ?? 0) + 1;

  // Update recipe
  recipe.title = input.title;
  recipe.titleReading = input.titleReading ?? null;
  recipe.currentRevId = revId;
  recipe.updatedAt = now;

  // Add new revision
  mockRevisions.push({
    id: revId,
    recipeId,
    revisionNumber: nextRevNum,
    isMajor: input.isMajor ?? true,
    servings: input.servings ?? null,
    cookTimeMin: input.cookTimeMin ?? null,
    prepTimeMin: input.prepTimeMin ?? null,
    description: input.description ?? null,
    authorNote: input.authorNote ?? null,
    sourceId: input.sourceId ?? null,
    createdBy: 'user-kei',
    createdAt: now,
  });

  // Add ingredients for new revision
  input.ingredients.forEach((ing, i) => {
    mockIngredients.push({
      id: generateId(),
      revisionId: revId,
      sortOrder: i + 1,
      groupLabel: ing.groupLabel ?? null,
      name: ing.name,
      amount: ing.amount ?? null,
      note: ing.note ?? null,
    });
  });

  // Add steps for new revision
  input.steps.forEach((step, i) => {
    mockSteps.push({
      id: generateId(),
      revisionId: revId,
      sortOrder: i + 1,
      body: step.body,
      timerSec: step.timerSec ?? null,
      photoId: null,
    });
  });

  // Update tags
  mockRecipeTags = mockRecipeTags.filter((rt) => rt.recipeId !== recipeId);
  for (const tagName of input.tags) {
    let tag = mockTags.find((t) => t.name === tagName);
    if (!tag) {
      tag = { id: generateId(), familyId: 'family-001', name: tagName, color: null };
      mockTags.push(tag);
    }
    mockRecipeTags.push({ recipeId, tagId: tag.id });
  }

  return revId;
}

export function deleteMockRecipe(recipeId: string): void {
  const recipe = mockRecipes.find((r) => r.id === recipeId);
  if (recipe) {
    recipe.status = 'archived';
    recipe.updatedAt = new Date().toISOString();
  }
}

export function createMockOcrSource(input: { rawText: string; capturedAt?: string }): string {
  const id = generateId();
  const now = new Date().toISOString();
  mockSources.push({
    id,
    type: 'ocr',
    url: null,
    ocrRawText: input.rawText,
    siteName: null,
    pageTitle: null,
    thumbnailUrl: null,
    capturedAt: input.capturedAt ?? now,
    createdAt: now,
  });
  return id;
}

export function createMockPhotoSource(input: {
  labelSummary?: string;
  capturedAt?: string;
}): string {
  const id = generateId();
  const now = new Date().toISOString();
  mockSources.push({
    id,
    type: 'photo',
    url: null,
    ocrRawText: input.labelSummary ?? null,
    siteName: null,
    pageTitle: '料理写真から推測',
    thumbnailUrl: null,
    capturedAt: input.capturedAt ?? now,
    createdAt: now,
  });
  return id;
}

export function deleteMockCookingLog(logId: string): void {
  const logIndex = mockCookingLogs.findIndex((log) => log.id === logId);
  if (logIndex === -1) return;

  mockCookingLogs.splice(logIndex, 1);
  for (let index = mockCookingPhotos.length - 1; index >= 0; index -= 1) {
    if (mockCookingPhotos[index].logId === logId) {
      mockCookingPhotos.splice(index, 1);
    }
  }
}

export function createMockCookingLog(input: SaveCookingLogInput): string {
  const id = generateId();
  const now = new Date().toISOString();
  mockCookingLogs.push({
    id,
    recipeId: input.recipeId ?? null,
    cookedBy: 'user-kei',
    cookedAt: input.cookedAt,
    servings: input.servings ?? null,
    rating: input.rating ?? null,
    memo: input.memo ?? null,
  });
  input.photos?.forEach((photo, index) => {
    mockCookingPhotos.push({
      id: generateId(),
      logId: id,
      localPath: photo.localPath,
      cloudUrl: photo.cloudUrl ?? null,
      sortOrder: index + 1,
      takenAt: photo.takenAt ?? null,
      createdAt: now,
    });
  });
  return id;
}

export function getMockCookingLogsForRecipe(recipeId: string): TimelineEntry[] {
  return mockCookingLogs
    .filter((l) => l.recipeId === recipeId)
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt))
    .map((log) => {
      const user = usersMap.get(log.cookedBy);
      const recipe = mockRecipes.find((r) => r.id === log.recipeId);
      return {
        id: log.id,
        recipeId: log.recipeId,
        recipeTitle: recipe?.title ?? 'フリー記録',
        userName: user?.displayName ?? '不明',
        cookedAt: log.cookedAt,
        servings: log.servings,
        rating: log.rating,
        memo: log.memo,
        photos: getPhotosForLog(log.id),
      };
    });
}

import { seedCookingLogs, seedRecipes } from './seed';

const SAMPLE_DATA_FLAG = 'EXPO_PUBLIC_ENABLE_SAMPLE_DATA';

const sampleRecipeIds: ReadonlySet<string> = new Set(seedRecipes.map((item) => item.id));
const sampleCookingLogIds: ReadonlySet<string> = new Set(seedCookingLogs.map((item) => item.id));

export function isSampleDataEnabled(): boolean {
  const flag = process.env[SAMPLE_DATA_FLAG];
  return (
    flag === '1' ||
    flag === 'true' ||
    process.env.NODE_ENV === 'test' ||
    typeof process.env.JEST_WORKER_ID === 'string'
  );
}

export function isSeedRecipeId(recipeId: string | null | undefined): boolean {
  return typeof recipeId === 'string' && sampleRecipeIds.has(recipeId);
}

export function isSeedCookingLogId(logId: string | null | undefined): boolean {
  return typeof logId === 'string' && sampleCookingLogIds.has(logId);
}

export function shouldHideSeedRecipe(recipeId: string | null | undefined): boolean {
  return !isSampleDataEnabled() && isSeedRecipeId(recipeId);
}

export function shouldHideSeedCookingLog(
  logId: string | null | undefined,
  recipeId: string | null | undefined,
): boolean {
  return !isSampleDataEnabled() && (isSeedCookingLogId(logId) || isSeedRecipeId(recipeId));
}

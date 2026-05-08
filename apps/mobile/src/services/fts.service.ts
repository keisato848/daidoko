/**
 * FTS5 full-text search service
 * Provides Japanese-aware search with kana normalization
 */
import { isNativePlatform } from '../db/client';

/**
 * Search recipes using FTS5 MATCH on native, client-side filter on web.
 * Returns recipe IDs that match the query.
 */
export async function searchByFts(query: string): Promise<string[]> {
  if (!isNativePlatform || !query.trim()) {
    return [];
  }

  try {
    const { getExpoDb } = await import('../db/client');
    const expoDb = getExpoDb();

    // Normalize and create prefix search term
    const normalized = normalizeForSearch(query.trim());
    const searchTerm = `${normalized}*`;

    const rows = expoDb.getAllSync<{ recipe_id: string }>(
      'SELECT recipe_id FROM recipe_fts WHERE recipe_fts MATCH ?',
      [searchTerm],
    );

    return rows.map((r) => r.recipe_id);
  } catch {
    // FTS table may not exist
    return [];
  }
}

/**
 * Update the FTS index for a single recipe.
 * Called after create/update/delete operations.
 */
export async function updateFtsIndex(
  recipeId: string,
  title: string,
  titleReading: string,
  ingredientNames: string[],
): Promise<void> {
  if (!isNativePlatform) return;

  try {
    const { getExpoDb } = await import('../db/client');
    const expoDb = getExpoDb();

    // Delete existing
    expoDb.runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [recipeId]);

    // Insert updated
    const ingText = ingredientNames.join(' ');
    expoDb.runSync(
      'INSERT INTO recipe_fts (recipe_id, title, title_reading, ingredient_names) VALUES (?, ?, ?, ?)',
      [recipeId, title, titleReading, ingText],
    );
  } catch {
    // FTS table may not exist yet
  }
}

/**
 * Remove a recipe from the FTS index.
 */
export async function removeFtsEntry(recipeId: string): Promise<void> {
  if (!isNativePlatform) return;

  try {
    const { getExpoDb } = await import('../db/client');
    const expoDb = getExpoDb();
    expoDb.runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [recipeId]);
  } catch {
    // FTS table may not exist
  }
}

/**
 * Normalize text for FTS search: katakana -> hiragana, lowercase
 */
function normalizeForSearch(text: string): string {
  // Katakana to hiragana
  const hiragana = text.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
  return hiragana.toLowerCase();
}

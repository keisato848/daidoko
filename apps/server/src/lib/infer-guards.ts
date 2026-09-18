import { GeminiMenuRecipesProvider, type MenuRecipesProvider } from './menu-recipes.js';

/** `x-device-id` の書式チェックだけ行う（乱数のインストール UUID・個人情報ではない）。 */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** 月次無料枠の N。既定 5（2026-08-28 利用者決定）。0 = 枠管理を無効化。 */
export function monthlyFreeLimit(): number {
  const raw = process.env['INFER_MONTHLY_FREE_LIMIT'];
  if (raw === undefined || raw.trim() === '') return 5;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 5;
}

/** 全体枠のカテゴリ。将来 infer 全体で 1 本にする方針のため最初から 'infer'。 */
export const QUOTA_CATEGORY = 'infer';

let menuRecipesProviderOverride: MenuRecipesProvider | null = null;

export function setMenuRecipesProviderForTesting(provider: MenuRecipesProvider | null): void {
  menuRecipesProviderOverride = provider;
}

export function resolveMenuRecipesProvider(): MenuRecipesProvider {
  return menuRecipesProviderOverride ?? new GeminiMenuRecipesProvider();
}

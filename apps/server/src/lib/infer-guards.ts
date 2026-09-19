import { z } from 'zod';

import {
  GeminiMenuRecipesProvider,
  MAX_MENU_RECIPES_DAYS,
  MAX_MENU_RECIPES_PANTRY,
  MAX_MENU_RECIPES_PREFERENCES,
  MAX_MENU_RECIPES_TITLES,
  MENU_SLOT_KINDS,
  type MenuRecipesProvider,
} from './menu-recipes.js';

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

/**
 * 一括生成の 1 回ぶんの要求。**同期ルート（`POST /infer/menu-recipes`）とジョブの `parts[].request` が
 * 同じものを使う** — 片方だけ緩いと、緩い方が検証の抜け道になる。
 *
 * 契約の正は `packages/shared/src/types/menu-recipes.ts`（サーバーは実行時に shared を
 * 取り込まない方針のため、ここは同じ形の写し。片方だけ直さないこと）。
 */
export const menuRecipesRequestSchema = z.object({
  days: z.number().int().min(1).max(MAX_MENU_RECIPES_DAYS),
  // 献立の時間帯（v19・§10.13）。**省略 = 夕（旧クライアント互換）**。
  // プロンプトの出し分けは lib/menu-recipes.ts の buildMenuRecipesSystemPrompt
  mealTime: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
  existingTitles: z.array(z.string().min(1).max(100)).max(MAX_MENU_RECIPES_TITLES),
  pantry: z.array(z.string().min(1).max(50)).max(MAX_MENU_RECIPES_PANTRY),
  preferences: z.string().max(MAX_MENU_RECIPES_PREFERENCES).optional(),
  locale: z.enum(['ja', 'en']).optional(),
  // 分量を書かせる推論なので consult と同様 unitSystem を受ける（/menu との意図的な差分）
  unitSystem: z.enum(['metric', 'imperial']).optional(),
  // 枠の種類（Track C PR-5b）。**省略 = 主菜（旧クライアント互換）**
  slotKind: z.enum(MENU_SLOT_KINDS).optional(),
  // 合わせる主菜の題名。主菜以外のときだけ文脈へ入れる
  mainTitles: z.array(z.string().min(1).max(100)).max(MAX_MENU_RECIPES_DAYS).optional(),
});

export type MenuRecipesRequestBody = z.infer<typeof menuRecipesRequestSchema>;

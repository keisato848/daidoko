/**
 * 献立の不足分レシピを AI で一括生成する（M3・`docs/買い物リスト・在庫設計.md` §10.12）。
 *
 * `POST /api/v1/infer/menu-recipes` のリクエスト/レスポンス契約の**正**。
 * 下書きの形は相談（consult）の `ConsultDraft` / `ServerDraft` と揃えてある —
 * 生成結果はそのまま `createRecipe`（aiGenerated=true）へ流せる。
 *
 * サーバーは実行時に `@daidoko/shared` を取り込まない方針（tsconfig の rootDir が
 * `src` に閉じている）ため、`apps/server/src/routes/infer.ts` は同じ形の zod を
 * ローカルに写している。**片方だけ直さないこと。**
 * モバイル（`menu-recipes.provider.ts`）はここを直接 import して検証に使う。
 */
import { z } from 'zod';

/** 一括で生成できる品数の上限（= 献立日数の上限と同じ 7）。 */
export const MAX_MENU_RECIPES_DAYS = 7;
/** 重複回避のために渡す手持ちレシピのタイトル数の上限。 */
export const MAX_MENU_RECIPES_TITLES = 30;
/** 渡す在庫名の上限。 */
export const MAX_MENU_RECIPES_PANTRY = 50;
/** 家族の嗜好メモ（自由テキスト）の上限。 */
export const MAX_MENU_RECIPES_PREFERENCES = 400;

/** 材料 1 行。consult の下書き（`ConsultIngredient`）の name/amount と同じ制約。 */
export const menuRecipeIngredientSchema = z.object({
  name: z.string().min(1).max(50),
  amount: z.string().max(30).optional(),
});

/**
 * 生成レシピの下書き 1 品。consult の下書き型（title/description/servings/
 * cookTimeMin/ingredients/steps/tags）のサブセットで、フィールド制約も揃えてある。
 */
export const menuRecipeDraftSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  servings: z.number().int().min(1).max(99).optional(),
  cookTimeMin: z.number().int().min(1).max(999).optional(),
  ingredients: z.array(menuRecipeIngredientSchema).min(1).max(100),
  steps: z
    .array(z.object({ body: z.string().min(1).max(500) }))
    .min(1)
    .max(50),
  tags: z.array(z.string().max(30)).max(10).optional(),
});

/** 献立の時間帯（v19・買い物リスト・在庫設計 §10.13）。省略 = 夕（旧クライアント互換）。 */
export const menuRecipesMealTimeSchema = z.enum(['breakfast', 'lunch', 'dinner']);

/** 枠の種類（R34・省略 = main）。副菜や汁物をプロンプトで出し分ける。 */
export const menuSlotKindSchema = z.enum(['main', 'side', 'soup', 'salad', 'dessert']);

/** リクエスト本体。locale は AI の**出力言語**（他 infer ルートと同じ意味）。 */
export const menuRecipesRequestSchema = z.object({
  /** 不足日数 = 生成する品数（1〜7） */
  days: z.number().int().min(1).max(MAX_MENU_RECIPES_DAYS),
  /**
   * 献立の時間帯（省略可）。**省略 = 夕** — 時間帯選択より前のクライアントは
   * このフィールドを送らず、従来どおり夕のプロンプトで生成される。
   * プロンプトの出し分け（朝: 手早い主食中心・昼: 軽め・夕: 従来どおり）はサーバー側
   * `apps/server/src/lib/menu-recipes.ts` の `buildMenuRecipesSystemPrompt`。
   */
  mealTime: menuRecipesMealTimeSchema.optional(),
  /** 手持ちレシピのタイトル（重複回避用・最大 30） */
  existingTitles: z.array(z.string().min(1).max(100)).max(MAX_MENU_RECIPES_TITLES),
  /** 在庫の品名だけ（最大 50・数量は渡さない） */
  pantry: z.array(z.string().min(1).max(50)).max(MAX_MENU_RECIPES_PANTRY),
  /** 家族の嗜好メモ（S21 で入力・任意・最大 400 字） */
  preferences: z.string().max(MAX_MENU_RECIPES_PREFERENCES).optional(),
  locale: z.enum(['ja', 'en']).optional(),
  /** 単位系（分量を書かせる推論なので consult と同様に受ける） */
  unitSystem: z.enum(['metric', 'imperial']).optional(),

  /** 枠の種類（省略時は主菜） */
  slotKind: menuSlotKindSchema.optional(),
  /** 合わせる主菜のタイトル（slotKind が main 以外のときに文脈へ入れる・最大 7） */
  mainTitles: z.array(z.string().max(100)).max(7).optional(),
});

/** レスポンスの data 部（AgentResult の中身）。 */
export const menuRecipesResponseSchema = z.object({
  recipes: z.array(menuRecipeDraftSchema).min(1).max(MAX_MENU_RECIPES_DAYS),
});

export const menuJobRequestSchema = z.object({
  parts: z
    .array(
      z.object({
        key: z.string().max(16),
        request: menuRecipesRequestSchema,
      }),
    )
    .min(1)
    .max(4),
  expoPushToken: z.string().optional(),
  locale: z.enum(['ja', 'en']).optional(),
});

export const menuJobResponseSchema = z.object({
  ok: z.boolean(),
  data: z
    .object({
      jobId: z.string(),
      status: z.enum(['queued', 'running', 'done', 'failed']),
      createdAt: z.string().optional(),
      finishedAt: z.string().optional(),
      parts: z
        .array(
          z.union([
            z.object({
              key: z.string(),
              ok: z.literal(true),
              recipes: z.array(menuRecipeDraftSchema),
            }),
            z.object({
              key: z.string(),
              ok: z.literal(false),
              error: z.object({
                code: z.string(),
                message: z.string(),
                retryable: z.boolean().optional(),
              }),
            }),
          ]),
        )
        .optional(),
      error: z
        .object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() })
        .optional(),
    })
    .optional(),
  error: z
    .object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() })
    .optional(),
});

export type MenuRecipesMealTime = z.infer<typeof menuRecipesMealTimeSchema>;
export type MenuSlotKind = z.infer<typeof menuSlotKindSchema>;
export type MenuRecipeIngredient = z.infer<typeof menuRecipeIngredientSchema>;
export type MenuRecipeDraft = z.infer<typeof menuRecipeDraftSchema>;
export type MenuRecipesRequest = z.infer<typeof menuRecipesRequestSchema>;
export type MenuRecipesResponse = z.infer<typeof menuRecipesResponseSchema>;
export type MenuJobRequest = z.infer<typeof menuJobRequestSchema>;
export type MenuJobResponse = z.infer<typeof menuJobResponseSchema>;

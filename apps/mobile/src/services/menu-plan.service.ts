/**
 * 献立サービス（#215 M1）— DB から材料つきレシピと在庫を読み、`utils/menuPlan` に渡す。
 *
 * 判断は全部 `utils/menuPlan.ts` の純関数側にある。ここは**読み書きだけ**。
 * 動的 import は他サービスと同じ理由（web で expo-sqlite を読み込ませない）で、
 * その代わり **jest では実行できない**（`docs/品質基準.md` §2.3）。
 * だから分岐をここに置かない — 置くとテストできない場所に判断が漏れる。
 *
 * 保存は `app_meta` に 1 本（テーブルを増やさない・設計 §10.6）。
 * 引き当てグラフと食い合いの印は**保存しない**。開くたびに再計算する —
 * 保存すると古い警告が残り、古いことが利用者に見えない。
 */
import { getAppMeta, setAppMeta } from './app-meta.service';
import { isNativePlatform } from '../db/client';
import {
  buildClaims,
  buildMenu,
  encodeReason,
  type MenuPantryItem,
  type MenuRecipe,
} from '../utils/menuPlan';

const MENU_PLAN_KEY = 'menu_plan';

/** 保存する献立。`version` は将来の互換用（省略可フィールドで増やす・§10.6） */
export interface StoredMenuPlan {
  version: 1;
  generatedAt: string;
  /** どちらの経路で出たか。M2 の AI が効いたかを後から確かめられる */
  source: 'coverage' | 'ai';
  days: StoredMenuDay[];
  /** 在庫の件数 + 最終更新時刻。変わっていたら「作り直す」を静かに出す */
  pantrySignature: string;
}

export interface StoredMenuDay {
  day: number;
  recipeId: string;
  /** 表示用。レシピが消えたときに「無くなりました」を出せるよう写す */
  title: string;
  reason: string;
  /** 作り終わった日（調理記録から埋める）。null = まだ */
  doneAt: string | null;
}

/** 画面に出す 1 日分（保存値＋開くたびに再計算した分） */
export interface MenuDayView extends StoredMenuDay {
  /** レシピが削除・アーカイブされた */
  missing: boolean;
  heroPhotoUri: string | null;
  cookTimeMin: number | null;
}

export interface MenuPlanView {
  plan: StoredMenuPlan;
  days: MenuDayView[];
  /** 在庫 ID → それを使う日。順序は付けない（§10.2） */
  claims: Record<string, number[]>;
  /** 保存時から在庫が変わった。勝手に組み直さず「作り直す」を出すだけ */
  stale: boolean;
}

/**
 * 在庫の署名。設計 §10.6 は「件数＋最終更新時刻」としていたが、
 * **`PantryItem` は `updatedAt` を公開していない**（types.ts）。
 * 代わりに**献立に効くフィールドだけ**で作る — 名前（突合）・期限（採点）・
 * 数量（消費の目安）。置き場所や共有フラグが変わっても献立は変わらないので入れない。
 * 並び順に依存しないよう id で整列してから連結する。
 */
export function pantrySignatureOf(
  items: readonly { id: string; name: string; expiresOn: string | null; quantity: number | null }[],
): string {
  const parts = items
    .map((i) => `${i.id}|${i.name}|${i.expiresOn ?? ''}|${i.quantity ?? ''}`)
    .sort();
  return `${items.length}:${parts.join(';')}`;
}

/** 材料つきのレシピを読む。`getRecipeList` は分量を持たないので専用に引く */
async function loadMenuRecipes(): Promise<MenuRecipe[]> {
  const { eq, inArray, desc } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const db = getDb();

  const recipes = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      currentRevId: schema.recipes.currentRevId,
      pinnedAt: schema.recipes.pinnedAt,
    })
    .from(schema.recipes)
    .where(eq(schema.recipes.status, 'active'));
  if (recipes.length === 0) return [];

  const revIds = recipes.map((r) => r.currentRevId).filter((id): id is string => Boolean(id));
  const revs =
    revIds.length > 0
      ? await db
          .select({
            id: schema.recipeRevisions.id,
            cookTimeMin: schema.recipeRevisions.cookTimeMin,
          })
          .from(schema.recipeRevisions)
          .where(inArray(schema.recipeRevisions.id, revIds))
      : [];
  const cookTimeByRev = new Map(revs.map((r) => [r.id, r.cookTimeMin]));

  const ingredientRows =
    revIds.length > 0
      ? await db
          .select({
            revId: schema.ingredients.revisionId,
            name: schema.ingredients.name,
            amount: schema.ingredients.amount,
          })
          .from(schema.ingredients)
          .where(inArray(schema.ingredients.revisionId, revIds))
      : [];
  const ingredientsByRev = new Map<string, { name: string; amount: string | null }[]>();
  for (const row of ingredientRows) {
    const list = ingredientsByRev.get(row.revId) ?? [];
    list.push({ name: row.name, amount: row.amount ?? null });
    ingredientsByRev.set(row.revId, list);
  }

  // 最終調理日。recency の材料で、1 レシピ 1 行だけ要る
  const logs = await db
    .select({ recipeId: schema.cookingLogs.recipeId, cookedAt: schema.cookingLogs.cookedAt })
    .from(schema.cookingLogs)
    .orderBy(desc(schema.cookingLogs.cookedAt));
  const lastCookedByRecipe = new Map<string, string>();
  for (const log of logs) {
    // recipeId も cookedAt も nullable（レシピ無しの記録がありうる）。どちらか欠けたら飛ばす
    const { recipeId, cookedAt } = log;
    if (!recipeId || !cookedAt) continue;
    if (!lastCookedByRecipe.has(recipeId)) lastCookedByRecipe.set(recipeId, cookedAt);
  }

  return recipes.map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    cookTimeMin: recipe.currentRevId ? (cookTimeByRev.get(recipe.currentRevId) ?? null) : null,
    pinnedAt: recipe.pinnedAt,
    lastCookedAt: lastCookedByRecipe.get(recipe.id) ?? null,
    ingredients: recipe.currentRevId ? (ingredientsByRev.get(recipe.currentRevId) ?? []) : [],
  }));
}

async function loadPantry(): Promise<{ items: MenuPantryItem[]; signature: string }> {
  const { getPantryItems } = await import('./pantry.service');
  const rows = await getPantryItems();
  return {
    items: rows.map((row) => ({ id: row.id, name: row.name, expiresOn: row.expiresOn })),
    signature: pantrySignatureOf(rows),
  };
}

/** X 日分を組んで保存する。**AI は呼ばない**（M1） */
export async function generateMenuPlan(days: number): Promise<MenuPlanView | null> {
  if (!isNativePlatform) return null;
  const { getAliasMap } = await import('./name-alias.service');
  const [recipes, pantry, aliases] = await Promise.all([
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
  ]);

  const built = buildMenu(recipes, pantry.items, days, new Date(), aliases);
  const plan: StoredMenuPlan = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'coverage',
    pantrySignature: pantry.signature,
    days: built.days.map((day) => ({
      day: day.day,
      recipeId: day.recipeId,
      title: day.title,
      reason: encodeReason(day.reason, day.reasonSubject),
      doneAt: null,
    })),
  };
  await setAppMeta(MENU_PLAN_KEY, JSON.stringify(plan));
  return hydrate(plan, recipes, pantry, aliases);
}

/** 保存済みの献立を読む。無ければ null（勝手に組まない・§10.7） */
export async function getMenuPlan(): Promise<MenuPlanView | null> {
  if (!isNativePlatform) return null;
  const raw = await getAppMeta(MENU_PLAN_KEY);
  if (!raw) return null;

  let plan: StoredMenuPlan;
  try {
    plan = JSON.parse(raw) as StoredMenuPlan;
  } catch {
    return null; // 壊れていたら無かったことにする（作り直せば直る）
  }
  if (!Array.isArray(plan.days)) return null;

  const { getAliasMap } = await import('./name-alias.service');
  const [recipes, pantry, aliases] = await Promise.all([
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
  ]);
  const withDone = await markDone(plan);
  return hydrate(withDone, recipes, pantry, aliases);
}

/**
 * 「作った！」は在庫を減らさない（`cooking-log.service` に pantry 参照が無い）。
 * 外さないと claim が残り続け、利用者が手で在庫を減らすと**二重に数えて**
 * 誤って「足りない」と言う。**献立に「作った」を持たせず、調理記録を読んで印を付ける**（§10.6）。
 */
async function markDone(plan: StoredMenuPlan): Promise<StoredMenuPlan> {
  const recipeIds = plan.days.filter((d) => d.doneAt === null).map((d) => d.recipeId);
  if (recipeIds.length === 0) return plan;

  const { and, gte, inArray } = await import('drizzle-orm');
  const { getDb } = await import('../db/client');
  const schema = await import('../db/schema');
  const rows = await getDb()
    .select({ recipeId: schema.cookingLogs.recipeId, cookedAt: schema.cookingLogs.cookedAt })
    .from(schema.cookingLogs)
    .where(
      and(
        inArray(schema.cookingLogs.recipeId, recipeIds),
        gte(schema.cookingLogs.cookedAt, plan.generatedAt),
      ),
    );
  if (rows.length === 0) return plan;

  const doneAtByRecipe = new Map<string, string>();
  for (const row of rows) {
    const { recipeId, cookedAt } = row;
    if (!recipeId || !cookedAt) continue;
    const prev = doneAtByRecipe.get(recipeId);
    if (!prev || cookedAt < prev) doneAtByRecipe.set(recipeId, cookedAt);
  }
  const next: StoredMenuPlan = {
    ...plan,
    days: plan.days.map((day) =>
      day.doneAt === null && doneAtByRecipe.has(day.recipeId)
        ? { ...day, doneAt: doneAtByRecipe.get(day.recipeId) as string }
        : day,
    ),
  };
  await setAppMeta(MENU_PLAN_KEY, JSON.stringify(next));
  return next;
}

function hydrate(
  plan: StoredMenuPlan,
  recipes: readonly MenuRecipe[],
  pantry: { items: MenuPantryItem[]; signature: string },
  aliases: Record<string, string>,
): MenuPlanView {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const days: MenuDayView[] = plan.days.map((day) => ({
    ...day,
    missing: !byId.has(day.recipeId),
    heroPhotoUri: null, // 一覧の写真は画面側で recipe.service から引く
    cookTimeMin: byId.get(day.recipeId)?.cookTimeMin ?? null,
  }));
  // 作り終わった日は引き当てから外す（残すと二重に数える）
  const active = plan.days.filter((d) => d.doneAt === null);
  return {
    plan,
    days,
    claims: buildClaims(active, recipes, pantry.items, aliases),
    stale: plan.pantrySignature !== pantry.signature,
  };
}

/** その日だけ次点に差し替える。**AI は呼ばない**（即時・¥0・オフライン可・§10.7） */
export async function replaceMenuDay(day: number): Promise<MenuPlanView | null> {
  if (!isNativePlatform) return null;
  const current = await getMenuPlan();
  if (!current) return null;

  const { getAliasMap } = await import('./name-alias.service');
  const [recipes, pantry, aliases] = await Promise.all([
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
  ]);
  const usedIds = new Set(current.plan.days.map((d) => d.recipeId));
  const candidates = recipes.filter((r) => !usedIds.has(r.id) && r.ingredients.length > 0);
  if (candidates.length === 0) return current;

  const next = buildMenu(candidates, pantry.items, 1, new Date(), aliases);
  const pick = next.days[0];
  if (!pick) return current;

  const plan: StoredMenuPlan = {
    ...current.plan,
    days: current.plan.days.map((d) =>
      d.day === day
        ? {
            day: d.day,
            recipeId: pick.recipeId,
            title: pick.title,
            reason: encodeReason(pick.reason, pick.reasonSubject),
            doneAt: null,
          }
        : d,
    ),
  };
  await setAppMeta(MENU_PLAN_KEY, JSON.stringify(plan));
  return hydrate(plan, recipes, pantry, aliases);
}

/** 献立の全日ぶんの不足材料。§5.3-a の選択シートへ渡す前に 1 行へまとめる（§10.4） */
export async function getMenuShortages(): Promise<{ name: string; amounts: string[] }[]> {
  if (!isNativePlatform) return [];
  const current = await getMenuPlan();
  if (!current) return [];

  const { getAliasMap } = await import('./name-alias.service');
  const { normalizeItemName } = await import('../utils/itemName');
  const { itemNamesMatch } = await import('../utils/itemMatch');
  const [recipes, pantry, aliases] = await Promise.all([
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
  ]);
  const byId = new Map(recipes.map((r) => [r.id, r]));

  // まとめる鍵は**素の名前**。名寄せ辞書でまとめると「強力粉」と「薄力粉」が
  // 1 行に潰れて片方が消える（§10.4）
  const merged = new Map<string, { name: string; amounts: string[] }>();
  for (const day of current.plan.days) {
    if (day.doneAt !== null) continue;
    const recipe = byId.get(day.recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const inStock = pantry.items.some((p) => itemNamesMatch(ing.name, p.name, aliases));
      if (inStock) continue;
      const key = normalizeItemName(ing.name);
      if (!key) continue;
      const entry = merged.get(key) ?? { name: ing.name, amounts: [] };
      if (ing.amount) entry.amounts.push(ing.amount);
      merged.set(key, entry);
    }
  }
  return [...merged.values()];
}

/** 献立を捨てる（設定からの「消す」用） */
export async function clearMenuPlan(): Promise<void> {
  if (!isNativePlatform) return;
  await setAppMeta(MENU_PLAN_KEY, '');
}

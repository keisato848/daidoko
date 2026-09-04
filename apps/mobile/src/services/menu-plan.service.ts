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
import {
  getAppMeta,
  getMenuAutoDays,
  getMenuAutoNotifyTime,
  isMenuAutoAddEnabled,
  isMenuAutoEnabled,
  setAppMeta,
} from './app-meta.service';
import type { MenuCandidate } from './menu-arrange.provider';
import { cancelAllMenuNotifications, scheduleMenuNotification } from './notification.service';
import { addShoppingItem, getShoppingItems, removeShoppingItem } from './shopping-list.service';
import { runSyncAndAwaitPull } from './sync-runner.service';
import { refreshWidgetSnapshot } from './widget-snapshot.service';
import { isNativePlatform } from '../db/client';
import { shouldHideSeedRecipe } from '../db/sampleData';
import { secondsUntilNextMenuNotifyTime } from '../utils/menuAuto';
import {
  adoptOrBuildMenuPlan,
  applyArrangement,
  buildArrangeCandidates,
  buildClaims,
  buildMenu,
  encodeReason,
  menuDateKey,
  mergeMissingIngredients,
  rollMenuPlan,
  toRollableDays,
  type ArrangeDayPick,
  type MenuDay,
  type MenuPantryItem,
  type MenuRecipe,
  type RollableMenuDay,
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
  /**
   * M2 の AI が返した献立全体への一言（無ければ省略）。省略可フィールドで
   * 足すだけなので `version` は上げない（バックアップ manifest の recipePhotos と同じ互換手法・§10.10.4）。
   */
  aiNote?: string;
  /**
   * 毎日の自動献立モード（A1・設計 §10.11）の起点日（`YYYY-MM-DD`・Day1 の暦日）。
   * **自動モードのプランだけが持つ**。手動プラン（`generateMenuPlan` を自動モード
   * オフで呼んだとき）には付かない——付けないことでローリング（`rollMenuPlan`）が
   * 「anchorDate が無ければ触らない」で手動プランを一切いじらずに済む。
   * 省略可フィールドなので `version` は上げない（§10.6 と同じ互換手法）。
   */
  anchorDate?: string;
  /**
   * 「組む」で要求した日数（§10.7 の結果フィードバック・W2 の不足行用）。
   * 組めた日数は `days.length` — 両方持つことで「あと◯日分足りない」を
   * 画面とウィジェットのどちらでも言える。献立はローカル専用（同期対象外）なので
   * フィールド追加は安全。省略可なので `version` は上げない（§10.6 と同じ互換手法）。
   * **旧データには無い** — 読む側（`readStoredMenuPlan`）は無ければ無いまま返し、
   * 不足の表示を出さない。
   */
  requestedDays?: number;
  /**
   * 直近の自動追加で買い物リストへ入れた `shopping_items.id`（§10.11.2）。
   * 「自動で追加した◯件を取り消す」用。**チェック済みは消さない**——取り消しの
   * 対象抽出は shopping-list 側で `checked` を見て弾く。次にまた自動追加が走ると
   * このバッチは丸ごと置き換わる（積み上げない）。
   */
  autoAddedItemIds?: string[];
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

  const allRecipes = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      currentRevId: schema.recipes.currentRevId,
      pinnedAt: schema.recipes.pinnedAt,
    })
    .from(schema.recipes)
    .where(eq(schema.recipes.status, 'active'));

  // シードレシピ（肉じゃが等）は一覧・検索・詳細で隠している
  // （recipe.service.ts の getRecipeList/getRecipeDetail と同じ shouldHideSeedRecipe）。
  // ここで揃えないと、隠しているはずのレシピが献立候補として選ばれ、選ばれた献立から
  // 「レシピを開く」と「レシピが見つかりません」になる（実機で確認済み）。
  const recipes = allRecipes.filter((r) => !shouldHideSeedRecipe(r.id));
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

/**
 * `MenuDay`（純関数の戻り値）を保存形式へ写す。`RollableMenuDay` と構造的に同じ形なので
 * `utils/menuPlan.ts` の `toRollableDays` に委譲する（判断・変換ロジックの重複を避ける）。
 */
function toStoredDays(days: readonly MenuDay[]): StoredMenuDay[] {
  return toRollableDays(days);
}

/**
 * X 日分を組んで保存する。**AI は呼ばない**（M1）。
 *
 * 自動モード（A1・§10.11）がオンなら `anchorDate` を今日で立てる——手動の「組む」で
 * 作ったプランも、以後は起動時のローリング対象になる。オフなら付けない（手動プランに
 * `rollMenuPlan` は一切触らない・§10.11.1）。
 */
export async function generateMenuPlan(days: number): Promise<MenuPlanView | null> {
  if (!isNativePlatform) return null;
  const { getAliasMap } = await import('./name-alias.service');
  const [recipes, pantry, aliases, autoOn] = await Promise.all([
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
    isMenuAutoEnabled(),
  ]);

  const today = new Date();
  const built = buildMenu(recipes, pantry.items, days, today, aliases);
  const plan: StoredMenuPlan = {
    version: 1,
    generatedAt: today.toISOString(),
    source: 'coverage',
    pantrySignature: pantry.signature,
    // 要求日数を残す（§10.7）。組めた日数（days.length）と比べて
    // 「あと◯日分足りない」を画面・ウィジェットの両方で言えるようにする
    requestedDays: days,
    ...(autoOn ? { anchorDate: menuDateKey(today) } : {}),
    days: toStoredDays(built.days),
  };
  await setAppMeta(MENU_PLAN_KEY, JSON.stringify(plan));
  refreshWidgetSnapshot();
  return hydrate(plan, recipes, pantry, aliases);
}

/**
 * 保存済みの生の献立を読む。壊れていたら null（作り直せば直る）。JSON 解釈だけ。
 * `requestedDays` は**旧データに無い**省略可フィールド — 無ければ無いまま返す
 * （不足の表示は出ない）。壊れた値（0 以下・非整数・数でない）は落として読む。
 * export はこの互換（旧データ・壊れた値）をテストで固定するため（DB を触らないので
 * jest で実行できる数少ない入口 — `docs/品質基準.md` §2.3）。
 */
export async function readStoredMenuPlan(): Promise<StoredMenuPlan | null> {
  const raw = await getAppMeta(MENU_PLAN_KEY);
  if (!raw) return null;
  try {
    const plan = JSON.parse(raw) as StoredMenuPlan;
    if (!Array.isArray(plan.days)) return null;
    const rd = plan.requestedDays;
    if (rd !== undefined && (typeof rd !== 'number' || !Number.isInteger(rd) || rd <= 0)) {
      delete plan.requestedDays;
    }
    return plan;
  } catch {
    return null;
  }
}

/** 保存済みの献立を読む。無ければ null（勝手に組まない・§10.7） */
export async function getMenuPlan(): Promise<MenuPlanView | null> {
  if (!isNativePlatform) return null;
  const plan = await readStoredMenuPlan();
  if (!plan) return null;

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
export async function markDone(plan: StoredMenuPlan): Promise<StoredMenuPlan> {
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
  refreshWidgetSnapshot();
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
  refreshWidgetSnapshot();
  return hydrate(plan, recipes, pantry, aliases);
}

/** AI 並べ替え（M2）に渡す入力。読むだけで保存はしない（`menu-arrange.provider.ts` へそのまま渡せる形）。 */
export interface MenuArrangeContext {
  candidates: MenuCandidate[];
  pantryNames: string[];
  /** 直近に作った料理名（重複除去・直近 10 件・§10.10.7-5 の仮値）。日付は渡さない */
  recentTitles: string[];
}

/**
 * AI 並べ替え（M2）に渡す候補・在庫・直近作った料理を組み立てる。
 * **DB を読むだけ**（保存・AI 呼び出しはしない）。判断は全部 `utils/menuPlan.ts` 側にある。
 */
export async function buildMenuArrangeContext(): Promise<MenuArrangeContext | null> {
  if (!isNativePlatform) return null;
  const { getAliasMap } = await import('./name-alias.service');
  const [recipes, pantry, aliases] = await Promise.all([
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
  ]);

  // cookTimeMin: MenuRecipe は number|null（DB の欠損値）、provider の MenuCandidate は
  // number|undefined（省略可）— null をそのまま渡すと exactOptionalPropertyTypes に落ちるので変換する
  const candidates: MenuCandidate[] = buildArrangeCandidates(
    recipes,
    pantry.items,
    aliases,
    new Date(),
  ).map((c) => ({
    id: c.id,
    title: c.title,
    ...(c.cookTimeMin !== null ? { cookTimeMin: c.cookTimeMin } : {}),
    coveragePct: c.coveragePct,
    missing: c.missing,
  }));

  // 直近作った順・重複除去（同じレシピを 2 回言っても AI には無意味）
  const recentTitles = [
    ...new Set(
      recipes
        .filter((r): r is MenuRecipe & { lastCookedAt: string } => r.lastCookedAt !== null)
        .sort((a, b) => b.lastCookedAt.localeCompare(a.lastCookedAt))
        .map((r) => r.title),
    ),
  ].slice(0, 10);

  return { candidates, pantryNames: pantry.items.map((p) => p.name), recentTitles };
}

/**
 * AI の並び（M2）を現在の献立へ適用して保存する。**AI はここでは呼ばない**
 * （結果を受け取って保存するだけ・§10.7 の「AI はボタン 1 本に閉じ込める」）。
 * 保存済みの献立が無ければ何もしない（AI ボタンは M1 の献立がある前提で押される・§10.7）。
 */
export async function applyMenuArrangement(arrangement: {
  days: ArrangeDayPick[];
  note?: string;
}): Promise<MenuPlanView | null> {
  if (!isNativePlatform) return null;
  const current = await getMenuPlan();
  if (!current) return null;

  const { getAliasMap } = await import('./name-alias.service');
  const [recipes, pantry, aliases] = await Promise.all([
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
  ]);

  const nextDays = applyArrangement(
    current.plan.days,
    arrangement.days,
    recipes.map((r) => ({ id: r.id, title: r.title })),
  );
  const plan: StoredMenuPlan = {
    version: current.plan.version,
    // 新しい献立になった扱い（§10.10.4）。doneAt の突合起点（markDone）もここから動く
    generatedAt: new Date().toISOString(),
    source: 'ai',
    days: nextDays,
    pantrySignature: current.plan.pantrySignature,
    // anchorDate は引き継ぐ（自動モードの並びが AI で差し替わっても、ローリング対象で
    // あることまでは変えない）。autoAddedItemIds は引き継がない — 直前の自動追加バッチが
    // どの日から出たか分からなくなる置き換えなので、取り消しの前提が崩れる
    ...(current.plan.anchorDate ? { anchorDate: current.plan.anchorDate } : {}),
    // requestedDays も引き継ぐ（並べ替えは日数を変えない — 不足の表示を消さない）
    ...(current.plan.requestedDays !== undefined
      ? { requestedDays: current.plan.requestedDays }
      : {}),
    // 前回の aiNote は引き継がない（スプレッドしない）——今回の結果に無ければ古い一言が
    // 残り続けてしまう（exactOptionalPropertyTypes のため undefined を明示代入できない）
    ...(arrangement.note ? { aiNote: arrangement.note } : {}),
  };
  await setAppMeta(MENU_PLAN_KEY, JSON.stringify(plan));
  refreshWidgetSnapshot();
  return hydrate(plan, recipes, pantry, aliases);
}

/** 献立の全日ぶんの不足材料。§5.3-a の選択シートへ渡す前に 1 行へまとめる（§10.4） */
export async function getMenuShortages(): Promise<{ name: string; amounts: string[] }[]> {
  if (!isNativePlatform) return [];
  const current = await getMenuPlan();
  if (!current) return [];

  const { getAliasMap } = await import('./name-alias.service');
  const [recipes, pantry, aliases] = await Promise.all([
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
  ]);
  const activeDays = current.plan.days.filter((d) => d.doneAt === null);
  return mergeMissingIngredients(activeDays, recipes, pantry.items, aliases);
}

/** 献立を捨てる（設定からの「消す」用） */
export async function clearMenuPlan(): Promise<void> {
  if (!isNativePlatform) return;
  await setAppMeta(MENU_PLAN_KEY, '');
}

// ─── A1: 毎日の自動献立モード（#215・設計 §10.11）──────────────────────────
// 起動/フォアグラウンド復帰から呼ぶ。AI は 1 回も呼ばない。判断は utils/menuPlan.ts・
// utils/menuAuto.ts の純関数側にあり、ここは読み書きと呼び出し順だけを持つ。

/**
 * `refreshMenuNotificationSchedule` の直列化キュー。前段が終わるまで次段を待たせるだけの
 * モジュールレベル変数（DB には何も残さない）。
 *
 * 呼び出し元（`app/_layout.tsx` の起動/フォアグラウンド復帰、`menu-settings.tsx` の
 * トグル）は互いを知らないので、通知権限ダイアログの表示でアプリが background/foreground
 * を跨ぐと**同じタイミングで 2 回同時に呼ばれうる**——ここで 1 本の待ち行列にして、
 * 常に「前の掃引＋予約が終わってから次の掃引＋予約」の順にする。
 * 前段が失敗しても待ち行列自体は止めない（`.catch` で握り、呼び出し元へは
 * 個別の `run` の方でエラーを伝える）。
 */
let menuNotificationScheduleChain: Promise<void> = Promise.resolve();

/**
 * 翌朝の献立通知を 1 本だけ予約し直す（§10.11.4）。**毎起動で呼ぶ**——
 * 掃引方式（`cancelAllMenuNotifications`）で OS 上の type:menu 予約を全部消してから、
 * 自動モードがオンなら 1 本だけ予約する。
 *
 * 以前は「前回 id を app_meta に 1 本だけ覚えて、それだけ消す」帳簿方式だったが、
 * 本関数が二重に走ると（下記の直列化コメント参照）両方が同じ id を読んで両方 cancel →
 * 両方 schedule し、id の記録は後勝ちで**先に予約した方が孤児化**した
 * （AQUOS 実機で確認・詳細は `docs/買い物リスト・在庫設計.md` §10.11.4）。
 * 掃引方式なら二重予約が起きても・過去の版の孤児が残っていても、次に呼んだときに
 * まとめて回収できる。
 */
export function refreshMenuNotificationSchedule(): Promise<void> {
  const run = menuNotificationScheduleChain.then(() => doRefreshMenuNotificationSchedule());
  menuNotificationScheduleChain = run.catch(() => undefined);
  return run;
}

async function doRefreshMenuNotificationSchedule(): Promise<void> {
  if (!isNativePlatform) return;
  await cancelAllMenuNotifications();
  if (!(await isMenuAutoEnabled())) return;

  const time = await getMenuAutoNotifyTime();
  const seconds = secondsUntilNextMenuNotifyTime(new Date(), time);
  await scheduleMenuNotification(seconds);
}

/**
 * 起動時の自動献立メンテナンス（A1・§10.11.1 の手順そのもの）。
 *
 * 1. 親トグルがオフ → 何もしない
 * 2/3. ローリング＋doneAt 突合（オフラインでも実行——ここまでは端末内で完結する）
 * 4. 子トグルがオンなら、**同期 pull の完了を待ってから**新しく末尾に入った日の
 *    不足分だけ買い物リストへ追加する。pull が失敗（オフライン）した朝はスキップし、
 *    次のオンライン起動に回す——古い在庫観で家族のリストへ書き込まないため
 * 5. 翌朝の通知を 1 本だけ予約し直す（4 の成否によらず実行）
 *
 * **有効化の瞬間（`stored` が無い／`anchorDate` が無い既存プランを見つけた）は、
 * 既存プランを破棄せず `anchorDate` を今日で立てて引き継ぐだけ**——判断そのものは
 * `utils/menuPlan.ts` の `adoptOrBuildMenuPlan`（純関数）にある。この回の自動追加は
 * 必ずスキップする（`addedDays` は空。設計の理由は `docs/買い物リスト・在庫設計.md`
 * §10.11.1）。日数設定の増減の反映は `rollMenuPlan` 側（`targetDays` 引数）。
 */
export async function runDailyMenuMaintenance(): Promise<void> {
  if (!isNativePlatform) return;
  if (!(await isMenuAutoEnabled())) return; // 1

  const today = new Date();
  const { getAliasMap } = await import('./name-alias.service');
  const [stored, recipes, pantry, aliases, days] = await Promise.all([
    readStoredMenuPlan(),
    loadMenuRecipes(),
    loadPantry(),
    getAliasMap(),
    getMenuAutoDays(),
  ]);

  let plan: StoredMenuPlan;
  let addedDays: MenuDay[];

  if (!stored || !stored.anchorDate) {
    const init = adoptOrBuildMenuPlan(
      stored ? { days: stored.days as RollableMenuDay[] } : null,
      recipes,
      pantry.items,
      days,
      today,
      aliases,
    );
    plan = stored
      ? { ...stored, anchorDate: init.anchorDate } // 既存プランは破棄しない。中身はそのまま
      : {
          version: 1,
          generatedAt: today.toISOString(),
          source: 'coverage',
          pantrySignature: pantry.signature,
          // 自動モードの要求日数は設定値（§10.11）。不足の表示の基準もこれ
          requestedDays: days,
          anchorDate: init.anchorDate,
          days: init.days,
        };
    addedDays = init.addedDays; // 常に空（有効化初回の自動追加は必ずスキップする）
  } else {
    const rolled = rollMenuPlan(
      { anchorDate: stored.anchorDate, days: stored.days as RollableMenuDay[] },
      today,
      recipes,
      pantry.items,
      aliases,
      days, // 現在の日数設定。ここを渡さないと設定変更が初回生成後は一切効かない（修正済み）
    );
    if (rolled) {
      plan = {
        ...stored,
        anchorDate: rolled.anchorDate,
        days: rolled.days,
        generatedAt: today.toISOString(),
        pantrySignature: pantry.signature,
        // ローリング後の要求日数は現在の設定値（targetDays と同じ根拠）
        requestedDays: days,
      };
      addedDays = rolled.addedDays;
    } else {
      // 経過日なし・日数設定も同じ。生き残った日は触らない（§10.11.1）
      plan = stored;
      addedDays = [];
    }
  }

  await setAppMeta(MENU_PLAN_KEY, JSON.stringify(plan));
  refreshWidgetSnapshot();

  plan = await markDone(plan); // 3. doneAt 突合（内部で変化があれば保存する）

  // 4. 自動買い物追加。新しく入った日が無ければ何もしない
  if (addedDays.length > 0 && (await isMenuAutoAddEnabled())) {
    const pullOk = await runSyncAndAwaitPull();
    if (pullOk) {
      // pull で在庫・買い物リストが動いた可能性があるので読み直す
      const freshPantry = await loadPantry();
      const shortages = mergeMissingIngredients(addedDays, recipes, freshPantry.items, aliases);
      const addedIds: string[] = [];
      for (const shortage of shortages) {
        const inserted = await addShoppingItem(shortage.name, shortage.amounts[0], {
          source: 'menu_auto',
          recipeId: shortage.recipeId,
        });
        if (inserted) addedIds.push(inserted.id);
      }
      // このバッチで置き換える（積み上げない・§10.11.2）。0 件でも「前回の取り消しの
      // 対象が今回は無い」を正しく表すため上書きする
      plan = { ...plan, autoAddedItemIds: addedIds };
      await setAppMeta(MENU_PLAN_KEY, JSON.stringify(plan));
      refreshWidgetSnapshot();
    }
    // pull 失敗（オフライン）はここで無言でスキップ。次のオンライン起動で追いつく
  }

  await refreshMenuNotificationSchedule(); // 5
}

/**
 * 直近の自動追加を取り消す（§10.11.2）。**チェック済みは消さない**——
 * 自動で消すことは一切しない。実際に取り消せた件数を返す。
 */
export async function undoMenuAutoAddedItems(): Promise<number> {
  if (!isNativePlatform) return 0;
  const stored = await readStoredMenuPlan();
  const ids = stored?.autoAddedItemIds;
  if (!ids || ids.length === 0) return 0;

  const idSet = new Set(ids);
  const items = await getShoppingItems();
  const toRemove = items.filter((item) => idSet.has(item.id) && !item.checked);
  for (const item of toRemove) await removeShoppingItem(item.id);

  // 取り消し終わり。このバッチはもう取り消せないので空にする
  // （`ids.length === 0` を上のガードが見るので、空配列は「無い」と同じ扱い）
  const plan: StoredMenuPlan = { ...(stored as StoredMenuPlan), autoAddedItemIds: [] };
  await setAppMeta(MENU_PLAN_KEY, JSON.stringify(plan));
  refreshWidgetSnapshot();
  return toRemove.length;
}

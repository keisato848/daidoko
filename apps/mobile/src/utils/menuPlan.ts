/**
 * 在庫から X 日分の献立を組む純関数（#215 M1）。
 *
 * **数量を計算しない**（`docs/買い物リスト・在庫設計.md` §10.2）。
 * レシピの分量は自由文（「大さじ2」「少々」「½本」）で在庫は数値＋任意単位。
 * 揃わないまま引き算すると**自信を持って間違えた買い物リスト**ができる。
 * 「1 日目が卵を取った」と言える根拠も無い（並びはこちらが決めただけ）。
 * 代わりに**引き当てグラフ**（在庫の行 → それを要求する日の集合）だけを持ち、
 * 「この卵を 3 日が使います」と**見せる**。決めるのは常に利用者。
 *
 * ここは端末内で完結する（推論ゼロ・サーバー変更ゼロ）。AI は M2 の
 * 「並べ替え」1 操作だけで、失敗しても本関数の並びがそのまま生きる（§10.5）。
 */
import { itemNamesMatch } from './itemMatch';

/** 献立の候補になるレシピ（採点に要る分だけ） */
export interface MenuRecipe {
  id: string;
  title: string;
  cookTimeMin: number | null;
  /** 作りたいリスト（ピン留め日時）。null = 未ピン */
  pinnedAt: string | null;
  /** 最後に作った日時（ISO）。null = 作ったことがない */
  lastCookedAt: string | null;
  /** 材料。名前と分量の自由文だけ持つ（数量は解釈しない） */
  ingredients: readonly { name: string; amount: string | null }[];
}

/** 在庫の 1 行（突合と期限に要る分だけ） */
export interface MenuPantryItem {
  id: string;
  /** 表示にも使う実名。偽の食い合いに 1 秒で気づけるようにするため（§10.4） */
  name: string;
  /** 期限（YYYY-MM-DD）。#200 の方針で大半は null */
  expiresOn: string | null;
}

/**
 * 分量が「取り分け」を示す語を含むか。醤油・砂糖・油は毎日出るが 1 回で
 * 在庫が消えないので、食い合いに数えると**全レシピで全調味料が警告になり、
 * 警告そのものが読まれなくなる**（§10.2）。
 * 判定はレシピの自由文への語彙一致だけ（NFKC 後）。単位換算も AI も要らない。
 */
const SERVING_TOKENS = [
  '大さじ',
  '小さじ',
  '大匙',
  '小匙',
  'カップ',
  '少々',
  '少量',
  '適量',
  '適宜',
  'ひとつまみ',
  'ふたつまみ',
  'お好み',
  'tbsp',
  'tsp',
] as const;

export function isServingAmount(amount: string | null): boolean {
  if (!amount) return false;
  const normalized = amount.normalize('NFKC').toLowerCase();
  return SERVING_TOKENS.some((token) => normalized.includes(token.toLowerCase()));
}

/** 採点の重み。1 か所に置いて jest で固定する（§10.3） */
export const MENU_WEIGHTS = {
  coverage: 1.0,
  useCount: 0.3,
  expiryUrgency: 0.6,
  pinned: 0.2,
  missingCount: -0.3,
  recency: -0.8,
} as const;

/** 期限の切迫度。使う在庫の**最も近い 1 件**で決める（合計しない・§10.3） */
export function expiryUrgency(expiresOn: string | null, today: Date): number {
  if (!expiresOn) return 0;
  const due = Date.parse(`${expiresOn}T00:00:00`);
  if (Number.isNaN(due)) return 0;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((due - start) / 86_400_000);
  if (days <= 1) return 1.0;
  if (days <= 3) return 0.8;
  if (days <= 7) return 0.5;
  return 0;
}

/** 直近に作ったほど下げる。しばらく作っていないレシピを掘り起こすため（§10.3） */
export function recencyPenalty(lastCookedAt: string | null, today: Date): number {
  if (!lastCookedAt) return 0;
  const at = Date.parse(lastCookedAt);
  if (Number.isNaN(at)) return 0;
  const days = Math.floor((today.getTime() - at) / 86_400_000);
  if (days <= 7) return 1.0;
  if (days <= 14) return 0.5;
  if (days <= 30) return 0.2;
  return 0;
}

/** 材料 1 件と在庫の突合結果 */
interface IngredientMatch {
  name: string;
  amount: string | null;
  /** 突合した在庫。null なら買い足す側 */
  pantryItemId: string | null;
}

/**
 * 突合は `itemNamesMatch` と**既にある名寄せ辞書だけ**。
 * 献立から AI 名寄せ（`resolveNames`）は呼ばない — 7 日献立は異表記 40 件ほどで
 * **1 回開くだけで日次枠 30 を食い切り**、未解決は「在庫に無い」側へ倒れて
 * **在庫にあるのに買わせる**。翌日開くと答えが変わることにもなる（§10.3）。
 */
function matchIngredients(
  recipe: MenuRecipe,
  pantry: readonly MenuPantryItem[],
  aliases: Record<string, string>,
): IngredientMatch[] {
  return recipe.ingredients.map((ing) => {
    const hit = pantry.find((p) => itemNamesMatch(ing.name, p.name, aliases));
    return { name: ing.name, amount: ing.amount, pantryItemId: hit ? hit.id : null };
  });
}

export interface MenuScoreBreakdown {
  coverage: number;
  useCount: number;
  expiryUrgency: number;
  pinned: number;
  missingCount: number;
  recency: number;
}

export interface ScoredRecipe {
  recipe: MenuRecipe;
  score: number;
  parts: MenuScoreBreakdown;
  /** 在庫にある材料が指す在庫 ID（重複なし） */
  usesPantryItemIds: string[];
  /** 買い足す材料名 */
  missingNames: string[];
  /** 決め手（理由の一言を機械的に作るために持つ） */
  topReason: MenuReasonKind;
}

export type MenuReasonKind = 'expiry' | 'coverage' | 'pinned' | 'few-missing';

/**
 * 1 レシピを採点する。`availablePantry` は「まだ他の日に取られていない在庫」で、
 * これは**採点上の割り切り**（1 つの在庫の恩恵は 1 品まで）であって残量ではない。
 */
export function scoreRecipe(
  recipe: MenuRecipe,
  availablePantry: readonly MenuPantryItem[],
  aliases: Record<string, string>,
  today: Date,
): ScoredRecipe {
  const matches = matchIngredients(recipe, availablePantry, aliases);
  const total = matches.length;
  const hits = matches.filter((m) => m.pantryItemId !== null);
  const missing = matches.filter((m) => m.pantryItemId === null);

  const usesPantryItemIds = [...new Set(hits.map((m) => m.pantryItemId as string))];
  const byId = new Map(availablePantry.map((p) => [p.id, p]));
  // 期限は**最も近い 1 件**。合計すると期限間近の品を複数使う 1 レシピが他を圧倒する
  const urgency = usesPantryItemIds.reduce((max, id) => {
    const item = byId.get(id);
    return item ? Math.max(max, expiryUrgency(item.expiresOn, today)) : max;
  }, 0);

  // useCount / missingCount は coverage の**少材料バイアス**を打ち消す絶対数の項
  // （材料 3 個・全部常備品のレシピが、12 個中 10 個揃うレシピに勝つのを防ぐ）
  const parts: MenuScoreBreakdown = {
    coverage: total === 0 ? 0 : hits.length / total,
    useCount: Math.min(usesPantryItemIds.length, 5) / 5,
    expiryUrgency: urgency,
    pinned: recipe.pinnedAt ? 1 : 0,
    missingCount: Math.min(missing.length, 5) / 5,
    recency: recencyPenalty(recipe.lastCookedAt, today),
  };

  const score =
    MENU_WEIGHTS.coverage * parts.coverage +
    MENU_WEIGHTS.useCount * parts.useCount +
    MENU_WEIGHTS.expiryUrgency * parts.expiryUrgency +
    MENU_WEIGHTS.pinned * parts.pinned +
    MENU_WEIGHTS.missingCount * parts.missingCount +
    MENU_WEIGHTS.recency * parts.recency;

  let topReason: MenuReasonKind = 'few-missing';
  if (parts.expiryUrgency > 0) topReason = 'expiry';
  else if (parts.coverage >= 0.8) topReason = 'coverage';
  else if (parts.pinned === 1) topReason = 'pinned';

  return {
    recipe,
    score,
    parts,
    usesPantryItemIds,
    missingNames: missing.map((m) => m.name),
    topReason,
  };
}

export interface MenuDay {
  day: number;
  recipeId: string;
  title: string;
  reason: MenuReasonKind;
  /** 理由の一言に埋める語（期限なら在庫の実名・カバー率なら品数） */
  reasonSubject: string | null;
  usesPantryItemIds: string[];
  missingNames: string[];
}

export interface MenuBuildResult {
  days: MenuDay[];
  /**
   * 引き当てグラフ: 在庫 ID → それを要求する日の集合。**順序は付けない**
   * （勝者を決めずに「この卵を 3 日が使います」と見せる・§10.2）。
   * 取り分けの調味料は含めない。
   */
  claims: Record<string, number[]>;
}

/**
 * X 日分を組む。候補が X 件未満なら**埋めずに少なく出す**（§10.3）。
 * 材料 0 件のレシピは除外する。
 */
export function buildMenu(
  recipes: readonly MenuRecipe[],
  pantry: readonly MenuPantryItem[],
  days: number,
  today: Date,
  aliases: Record<string, string> = {},
): MenuBuildResult {
  const pool = recipes.filter((r) => r.ingredients.length > 0);
  const claimedIds = new Set<string>();
  const used = new Set<string>();
  const out: MenuDay[] = [];

  for (let day = 1; day <= days; day += 1) {
    const available = pantry.filter((p) => !claimedIds.has(p.id));
    let best: ScoredRecipe | null = null;
    for (const recipe of pool) {
      if (used.has(recipe.id)) continue;
      const scored = scoreRecipe(recipe, available, aliases, today);
      if (!best || scored.score > best.score) best = scored;
    }
    if (!best) break; // 候補が尽きた。埋めない

    used.add(best.recipe.id);
    best.usesPantryItemIds.forEach((id) => claimedIds.add(id));

    const byId = new Map(pantry.map((p) => [p.id, p]));
    let subject: string | null = null;
    if (best.topReason === 'expiry') {
      // 期限の決め手になった在庫の実名（偽の食い合いに気づけるように）
      const soonest = best.usesPantryItemIds
        .map((id) => byId.get(id))
        .filter((p): p is MenuPantryItem => Boolean(p))
        .sort((a, b) => expiryUrgency(b.expiresOn, today) - expiryUrgency(a.expiresOn, today))[0];
      subject = soonest ? soonest.name : null;
    } else if (best.topReason === 'coverage') {
      subject = String(best.usesPantryItemIds.length);
    } else if (best.topReason === 'few-missing') {
      subject = String(best.missingNames.length);
    }

    out.push({
      day,
      recipeId: best.recipe.id,
      title: best.recipe.title,
      reason: best.topReason,
      reasonSubject: subject,
      usesPantryItemIds: best.usesPantryItemIds,
      missingNames: best.missingNames,
    });
  }

  return { days: out, claims: buildClaims(out, pool, pantry, aliases) };
}

/**
 * 引き当てグラフを組み直す。**保存しない・開くたびに再計算する**（§10.6）
 * — 保存すると古い警告が残り、古いことが利用者に見えない。
 * `doneAt` で外された日は呼び出し側が `days` から除いてから渡す。
 */
export function buildClaims(
  days: readonly { day: number; recipeId: string }[],
  recipes: readonly MenuRecipe[],
  pantry: readonly MenuPantryItem[],
  aliases: Record<string, string> = {},
): Record<string, number[]> {
  const byRecipeId = new Map(recipes.map((r) => [r.id, r]));
  const claims: Record<string, number[]> = {};
  for (const entry of days) {
    const recipe = byRecipeId.get(entry.recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      // 取り分けの調味料は数えない（数えると全レシピで全調味料が警告になる）
      if (isServingAmount(ing.amount)) continue;
      const hit = pantry.find((p) => itemNamesMatch(ing.name, p.name, aliases));
      if (!hit) continue;
      const list = claims[hit.id] ?? (claims[hit.id] = []);
      if (!list.includes(entry.day)) list.push(entry.day);
    }
  }
  return claims;
}

/** 2 日以上が同じ在庫を要求しているか（シートの最上段固定に使う・§10.4） */
export function isContested(claims: Record<string, number[]>, pantryItemId: string): boolean {
  return (claims[pantryItemId] ?? []).length >= 2;
}

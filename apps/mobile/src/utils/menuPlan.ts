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
import { normalizeItemName } from './itemName';

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

/**
 * `'ai'` は M2（AI 並べ替え）専用 — M1 の採点（`scoreRecipe`）が返すことはない。
 * AI の why をそのまま `subject` として保存するための入れ物（§10.10.4 の
 * 「reason に AI の why をそのまま」を、既存の `kind:subject` 保存形式に乗せる）。
 * `'ai-new'` は M3（不足分レシピの一括生成・§10.12）で新しく作って組み込んだ日。
 * subject は使わない（AI バッジ #266 はレシピ側の aiGenerated が担い、献立側は
 * 「新しく作った」ことだけ言う）。
 */
export type MenuReasonKind = 'expiry' | 'coverage' | 'pinned' | 'few-missing' | 'ai' | 'ai-new';

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
 * 未選択（`excludeIds` に無い）候補から argmax で 1 件選ぶ。
 * `buildMenu`（M1 全体を組む）と `rollMenuPlan`（ローリングの補充分だけ組む・§10.11.1）の
 * 両方が使う——**選び方を 2 箇所に書くと、いつか片方だけ直して食い違う**。
 */
function pickBestRecipe(
  pool: readonly MenuRecipe[],
  excludeIds: ReadonlySet<string>,
  available: readonly MenuPantryItem[],
  aliases: Record<string, string>,
  today: Date,
): ScoredRecipe | null {
  let best: ScoredRecipe | null = null;
  for (const recipe of pool) {
    if (excludeIds.has(recipe.id)) continue;
    const scored = scoreRecipe(recipe, available, aliases, today);
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}

/** 理由の一言に埋める語を決め手から機械的に作る（§10.3・AI 不要）。 */
function reasonSubjectFor(
  best: ScoredRecipe,
  pantry: readonly MenuPantryItem[],
  today: Date,
): string | null {
  if (best.topReason === 'expiry') {
    // 期限の決め手になった在庫の実名（偽の食い合いに気づけるように）
    const byId = new Map(pantry.map((p) => [p.id, p]));
    const soonest = best.usesPantryItemIds
      .map((id) => byId.get(id))
      .filter((p): p is MenuPantryItem => Boolean(p))
      .sort((a, b) => expiryUrgency(b.expiresOn, today) - expiryUrgency(a.expiresOn, today))[0];
    return soonest ? soonest.name : null;
  }
  if (best.topReason === 'coverage') return String(best.usesPantryItemIds.length);
  if (best.topReason === 'few-missing') return String(best.missingNames.length);
  return null;
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
    const best = pickBestRecipe(pool, used, available, aliases, today);
    if (!best) break; // 候補が尽きた。埋めない

    used.add(best.recipe.id);
    best.usesPantryItemIds.forEach((id) => claimedIds.add(id));

    out.push({
      day,
      recipeId: best.recipe.id,
      title: best.recipe.title,
      reason: best.topReason,
      reasonSubject: reasonSubjectFor(best, pantry, today),
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

/**
 * 保存する `reason` の文字列表現（`kind:subject`）。
 * 画面は i18n の鍵に戻して表示する。**文字列に押し込むのは保存形式を増やさないため**で、
 * 往復できることをテストで固定しておく（片方だけ直すと理由が黙って消える）。
 */
export function encodeReason(kind: MenuReasonKind, subject: string | null): string {
  return `${kind}:${subject ?? ''}`;
}

export function decodeReason(reason: string): { kind: MenuReasonKind | null; subject: string } {
  const index = reason.indexOf(':');
  if (index < 0) return { kind: null, subject: '' };
  const kind = reason.slice(0, index);
  const subject = reason.slice(index + 1);
  const known: MenuReasonKind[] = ['expiry', 'coverage', 'pinned', 'few-missing', 'ai', 'ai-new'];
  return {
    kind: (known as string[]).includes(kind) ? (kind as MenuReasonKind) : null,
    subject,
  };
}

// ─── A1: 毎日の自動献立モード（#215・設計 §10.11）──────────────────────────
// 起動時の鮮度判定＋ローリング。AI は 1 回も呼ばない（A2 は menu-arrange.provider 側）。

/** 暦日キー（`YYYY-MM-DD`・端末のローカル時刻）。`anchorDate` の保存形式。 */
export function menuDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `anchorDate`（暦日）から `today` まで何日経ったか。壊れた保存値は 0 扱い（触らない）。 */
function daysElapsedSince(anchorDate: string, today: Date): number {
  const anchor = new Date(`${anchorDate}T00:00:00`);
  if (Number.isNaN(anchor.getTime())) return 0;
  const anchorMidnight = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((todayMidnight.getTime() - anchorMidnight.getTime()) / 86_400_000);
}

/** ローリングが読み書きする 1 日分の形（`StoredMenuDay` と構造的に同じ）。 */
export interface RollableMenuDay {
  day: number;
  recipeId: string;
  title: string;
  reason: string;
  doneAt: string | null;
}

export interface MenuRollResult {
  /** 新しい起点日（`today` の暦日）。 */
  anchorDate: string;
  /** 生存日（先頭を落として詰め直し・日番号を振り直したもの）＋補充日。保存にそのまま使える */
  days: RollableMenuDay[];
  /** 今回**新しく末尾に入った日だけ**（自動追加の対象・§10.11.2）。生存日は含まない */
  addedDays: MenuDay[];
}

/**
 * 起動時のローリング（§10.11.1 手順 2）。
 *
 * - `anchorDate` が無ければ**何もしない**（`null` を返す）——自動モードでない
 *   手動プランには一切触らない
 * - 経過日が 0 以下（今日すでに鮮度を合わせてある）で、かつ日数設定（`targetDays`）も
 *   変わっていなければ**何もしない**。**日数設定が変わっていれば経過日が 0 でも
 *   この回で反映する**——次の変更まで待たせると「設定を変えても効かない」に見える
 *   （修正: `targetDays` を `plan.days.length` に固定していたため、初回生成後は
 *   日数設定を変えても常に元の日数へ戻っていた）
 * - 経過日ぶん先頭を落とし、**生き残った日の中身は一切変えない**（「昨日見た明日」が
 *   今日も同じ）。日番号だけ 1 から振り直す（Day2 だった日が Day1=「今日」になる）
 * - **日数設定が増えた分**は、落ちた分の補充と合わせて末尾に M1 argmax で追加する
 *   （= `addedDays`）。**日数設定が減った分**は末尾から間引くだけ——買い物リストの
 *   行には一切触らない（「自動で消すことは一切しない」の原則。§10.11.2）。
 *   間引かれた日は `addedDays` に入らない（そもそも追加していない）
 * - 落ちた分（＝離れていた日数。`targetDays` を超えて空けていたら `targetDays` でクリップ）を
 *   末尾に M1 argmax で補充する。**同じレシピの再登場は避ける**（生存日・落ちた日
 *   問わず、このプランで一度使ったレシピは除外）。生存日が使っている在庫も
 *   「取られている」側に入れ、補充が奪い合わない
 */
export function rollMenuPlan(
  plan: { anchorDate: string | null; days: readonly RollableMenuDay[] },
  today: Date,
  candidates: readonly MenuRecipe[],
  pantry: readonly MenuPantryItem[],
  aliases: Record<string, string> = {},
  // 省略時は元の日数を保つ（既存呼び出しの挙動を変えない）。現在の設定値を渡すのは
  // 呼び出し側（menu-plan.service.ts の runDailyMenuMaintenance）の責務
  targetDays: number = plan.days.length,
): MenuRollResult | null {
  if (!plan.anchorDate) return null;
  const elapsed = daysElapsedSince(plan.anchorDate, today);
  if (elapsed <= 0 && targetDays === plan.days.length) return null;

  const drop = Math.max(0, Math.min(elapsed, plan.days.length));
  const rawSurvivors = plan.days.slice(drop);
  // 日数設定が減った場合はここで末尾から間引く。中身は変えない・買い物リストは触らない
  const survivors =
    rawSurvivors.length > targetDays ? rawSurvivors.slice(0, targetDays) : rawSurvivors;
  const toAppend = Math.max(0, targetDays - survivors.length);

  // 生存日が使っている在庫を「取られている」側に先に入れる（補充がこれを奪い合わない）
  const survivorClaims = buildClaims(
    survivors.map((d) => ({ day: d.day, recipeId: d.recipeId })),
    candidates,
    pantry,
    aliases,
  );
  const claimedIds = new Set(Object.keys(survivorClaims));
  // このプランで一度でも使ったレシピは、生存日・落ちた日を問わず再登場させない
  const usedRecipeIds = new Set(plan.days.map((d) => d.recipeId));
  const pool = candidates.filter((r) => r.ingredients.length > 0 && !usedRecipeIds.has(r.id));

  const appended: MenuDay[] = [];
  const appendedIds = new Set<string>();
  for (let i = 0; i < toAppend; i += 1) {
    const available = pantry.filter((p) => !claimedIds.has(p.id));
    const best = pickBestRecipe(pool, appendedIds, available, aliases, today);
    if (!best) break; // 候補が尽きた。埋めない（§10.3 の退化と同じ扱い）

    appendedIds.add(best.recipe.id);
    best.usesPantryItemIds.forEach((id) => claimedIds.add(id));
    appended.push({
      day: survivors.length + appended.length + 1,
      recipeId: best.recipe.id,
      title: best.recipe.title,
      reason: best.topReason,
      reasonSubject: reasonSubjectFor(best, pantry, today),
      usesPantryItemIds: best.usesPantryItemIds,
      missingNames: best.missingNames,
    });
  }

  const renumberedSurvivors: RollableMenuDay[] = survivors.map((d, index) => ({
    ...d,
    day: index + 1,
  }));
  const appendedRollable: RollableMenuDay[] = appended.map((d) => ({
    day: d.day,
    recipeId: d.recipeId,
    title: d.title,
    reason: encodeReason(d.reason, d.reasonSubject),
    doneAt: null,
  }));

  return {
    anchorDate: menuDateKey(today),
    days: [...renumberedSurvivors, ...appendedRollable],
    addedDays: appended,
  };
}

/** `MenuDay`（純関数の戻り値）を `RollableMenuDay`（保存形式）へ写す。日番号・reason のエンコードだけ */
export function toRollableDays(days: readonly MenuDay[]): RollableMenuDay[] {
  return days.map((day) => ({
    day: day.day,
    recipeId: day.recipeId,
    title: day.title,
    reason: encodeReason(day.reason, day.reasonSubject),
    doneAt: null,
  }));
}

/**
 * 自動モードを有効化した瞬間・または `anchorDate` の無い既存プランを見つけた瞬間の
 * 決定（設計 §10.11.1・修正版）。**サービス層に判断を置くとテストできない**
 * （`menu-plan.service.ts` 冒頭コメントの原則）ので、ここに純関数として置く。
 *
 * - 既存プラン（手動/AI とも）は**破棄しない**。`stored` があれば `anchorDate` を
 *   今日で立てて引き継ぐだけで、`days` の中身は一切変えない
 * - プランが 1 つも無い（`stored === null`）ときだけ M1 で新規に組む
 * - **どちらでも `addedDays` は空**——この回の自動追加は必ずスキップする。
 *   「毎日高々数品」（§10.11.2）を有効化初回にも厳密に守り、子トグルが先に ON でも
 *   有効化の瞬間に最大 `targetDays` 日分が家族の共有買い物リストへ一括で入る事故を
 *   防ぐ。自動追加は翌日以降のロール（`rollMenuPlan`）で新しく末尾に入った日からだけ
 */
export function adoptOrBuildMenuPlan(
  stored: { days: readonly RollableMenuDay[] } | null,
  recipes: readonly MenuRecipe[],
  pantry: readonly MenuPantryItem[],
  targetDays: number,
  today: Date,
  aliases: Record<string, string> = {},
): { anchorDate: string; days: RollableMenuDay[]; addedDays: MenuDay[] } {
  const anchorDate = menuDateKey(today);
  if (stored) {
    return { anchorDate, days: [...stored.days], addedDays: [] };
  }
  const built = buildMenu(recipes, pantry, targetDays, today, aliases);
  return { anchorDate, days: toRollableDays(built.days), addedDays: [] };
}

/** 買い物リストへ橋渡しする「不足材料」1 件（§10.4・§10.11.2）。 */
export interface MenuShortage {
  /** 素の材料名（まとめる鍵は正規化名だが、表示・追加には素の名前を使う・§10.4） */
  name: string;
  /** 日ごとの分量（合算しない。表示側で `/` 区切りに使える） */
  amounts: string[];
  /** 由来レシピ（バッジのタップ先）。複数の日が同じ材料を要求するときは最初の日のもの */
  recipeId: string;
}

/**
 * 複数日ぶんの不足材料を**先に 1 行へまとめる**（§10.4 — まとめずに 1 件ずつ足すと、
 * `addShoppingItem` が同名の未購入行を黙って捨てるため 2 日目以降が消える）。
 *
 * まとめる鍵は**素の名前の正規化**であって名寄せ辞書ではない——辞書でまとめると
 * 「強力粉」と「薄力粉」が 1 行に潰れて片方が消える。在庫の突合（何が既に足りているか）
 * だけ名寄せ辞書を使う。
 */
export function mergeMissingIngredients(
  days: readonly { recipeId: string }[],
  recipes: readonly MenuRecipe[],
  pantry: readonly MenuPantryItem[],
  aliases: Record<string, string> = {},
): MenuShortage[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const merged = new Map<string, MenuShortage>();
  for (const day of days) {
    const recipe = byId.get(day.recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const inStock = pantry.some((p) => itemNamesMatch(ing.name, p.name, aliases));
      if (inStock) continue;
      const key = normalizeItemName(ing.name);
      if (!key) continue;
      const entry = merged.get(key) ?? { name: ing.name, amounts: [], recipeId: recipe.id };
      if (ing.amount) entry.amounts.push(ing.amount);
      merged.set(key, entry);
    }
  }
  return [...merged.values()];
}

/**
 * 献立の全日ぶんの材料を**在庫にあるか問わず** 1 行へまとめる（M3-5・§10.12）。
 *
 * `mergeMissingIngredients` が「足りないものだけ」を返すのに対し、こちらは
 * #214 の選択シートに渡す前提で**全行**返す — 在庫にある材料も理由付きで
 * 見せ、消さない（`docs/買い物リスト・在庫設計.md` §5.3-a）。在庫との突合は
 * `utils/shoppingPlan.ts` の `buildShoppingPlan` がやるので、ここではやらない。
 * まとめる鍵は素の名前の正規化（辞書でまとめない — §10.4 と同じ理由）。
 */
export interface MenuShoppingIngredient {
  name: string;
  /** 日ごとの分量を「 / 」区切りで連結（無ければ null） */
  amount: string | null;
  /** 由来レシピ（買い物リスト行の「献立から」バッジのタップ先） */
  recipeId: string;
}

export function mergeMenuIngredients(
  days: readonly { recipeId: string }[],
  recipes: readonly MenuRecipe[],
): MenuShoppingIngredient[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const merged = new Map<string, { name: string; amounts: string[]; recipeId: string }>();
  for (const day of days) {
    const recipe = byId.get(day.recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const key = normalizeItemName(ing.name);
      if (!key) continue;
      const entry = merged.get(key) ?? { name: ing.name, amounts: [], recipeId: recipe.id };
      if (ing.amount) entry.amounts.push(ing.amount);
      merged.set(key, entry);
    }
  }
  return [...merged.values()].map((entry) => ({
    name: entry.name,
    amount: entry.amounts.length > 0 ? entry.amounts.join(' / ') : null,
    recipeId: entry.recipeId,
  }));
}

// ─── M3: 不足分レシピの一括生成（§10.12）────────────────────────────────────

/**
 * 一括生成で保存したレシピを、献立の**空き日（末尾）**へ組み込む（M3・§10.12）。
 * 純関数 — サービス層（`fillMenuPlanShortfall`）は読み書きだけを持つ。
 *
 * - 既存の日（作り終わった日も含む）は一切触らない。並べ替えもしない
 * - 追加分は最終日の次の day 番号から順に積む（day の欠番は作らない前提 —
 *   `buildMenu`/`rollMenuPlan` は常に 1..k の連番を返す）
 * - `requestedDays` を**超えては積まない**（超えたぶんは捨てる。呼び出し側は
 *   不足数ちょうどで生成するので通常は起きない — 防御だけ）
 * - reason は `'ai-new'`（subject 無し）。AI バッジはレシピ側 aiGenerated（#266）が担う
 */
export function appendShortfallDays(
  currentDays: readonly RollableMenuDay[],
  requestedDays: number,
  additions: readonly { recipeId: string; title: string }[],
): RollableMenuDay[] {
  const maxDay = currentDays.reduce((max, day) => Math.max(max, day.day), 0);
  const room = Math.max(0, requestedDays - currentDays.length);
  const usedIds = new Set(currentDays.map((day) => day.recipeId));
  const appended: RollableMenuDay[] = [];
  for (const addition of additions) {
    if (appended.length >= room) break;
    if (usedIds.has(addition.recipeId)) continue; // 同じレシピを 2 つの日に入れない
    usedIds.add(addition.recipeId);
    appended.push({
      day: maxDay + appended.length + 1,
      recipeId: addition.recipeId,
      title: addition.title,
      reason: encodeReason('ai-new', null),
      doneAt: null,
    });
  }
  return [...currentDays, ...appended];
}

// ─── M2: AI 並べ替え（#215・設計 §10.10）────────────────────────────────────
// ここから先は M1 の上に AI 1 操作を載せる分だけ。M1 の関数（buildMenu 等）は
// 一切変更しない — 失敗しても M1 の並びがそのまま生きる契約（§10.5）を型で保つ。

/** AI に渡す候補 1 件（`menu-arrange.provider.ts` の `MenuCandidate` と同じ形）。 */
export interface MenuArrangeCandidate {
  id: string;
  title: string;
  cookTimeMin: number | null;
  /** カバー率（%）。整数 0..100 */
  coveragePct: number;
  missing: string[];
}

/**
 * AI 並べ替えに渡す候補一覧（≤`cap` 件・おすすめ順）。
 *
 * **在庫の「まだ他の日に取られていない」制約は掛けない** — 候補は AI が選び直す前の
 * 材料であって、M1 の日別引き当て（`buildMenu` が日を進めるたびに在庫を削る仕組み）
 * とは独立。§10.5 の契約が渡すのは「候補 30 件・在庫の品名・日数」だけで、
 * 「この在庫は何日目まで残っているか」という M1 内部の状態は渡さない。
 */
export function buildArrangeCandidates(
  recipes: readonly MenuRecipe[],
  pantry: readonly MenuPantryItem[],
  aliases: Record<string, string>,
  today: Date,
  cap = 30,
): MenuArrangeCandidate[] {
  return recipes
    .filter((r) => r.ingredients.length > 0)
    .map((recipe) => scoreRecipe(recipe, pantry, aliases, today))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((scored) => ({
      id: scored.recipe.id,
      title: scored.recipe.title,
      cookTimeMin: scored.recipe.cookTimeMin,
      coveragePct: Math.round(scored.parts.coverage * 100),
      missing: scored.missingNames,
    }));
}

/** AI が返した 1 日ぶんの並び（`menu-arrange.provider.ts` の `MenuDayPick` と同じ形）。 */
export interface ArrangeDayPick {
  day: number;
  recipeId: string;
  why?: string;
}

/** 差し替え先を引くのに要るだけの候補情報。 */
export interface ArrangeCandidateLookup {
  id: string;
  title: string;
}

/** AI 適用後・適用前どちらの日にも共通する形（`StoredMenuDay` の写し）。 */
export interface ArrangeableDay {
  day: number;
  recipeId: string;
  title: string;
  reason: string;
  doneAt: string | null;
}

/**
 * AI の並びを現在の献立へ適用する純関数（§10.10.4）。
 *
 * - AI が置いた日（`picks` に対応する `day` がある）だけを差し替える。
 *   **X 未満の結果を M1 で埋め直すことはしない**（§10.10.6-g）——
 *   `picks` に無い日は `currentDays` の値をそのまま返す（M1 の空カードも含めて）。
 * - 差し替えた日は `doneAt` を `null` に戻す。「新しい献立になった」ので
 *   作った印は持ち越さない（§10.10.4・呼び出し側が `generatedAt` も更新する）。
 * - `reason` は `encodeReason('ai', why)` で保存する。元の M1 理由（機械的な文）は
 *   AI の理由に完全に置き換わる——残すと前のレシピについての嘘になる（§10.10.4）。
 * - 候補に無い `recipeId`（＝ `validateArrangement` を通していない生の pick）が来ても
 *   保険として無視する。基本は起きない（呼び出し側が必ず検証を経由させる）。
 */
export function applyArrangement(
  currentDays: readonly ArrangeableDay[],
  picks: readonly ArrangeDayPick[],
  candidates: readonly ArrangeCandidateLookup[],
): ArrangeableDay[] {
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const pickByDay = new Map(picks.map((p) => [p.day, p]));
  return currentDays.map((current) => {
    const pick = pickByDay.get(current.day);
    if (!pick) return current;
    const candidate = candidateById.get(pick.recipeId);
    if (!candidate) return current;
    return {
      day: current.day,
      recipeId: pick.recipeId,
      title: candidate.title,
      reason: encodeReason('ai', pick.why ?? ''),
      doneAt: null,
    };
  });
}

/**
 * 相談（S-consult）の下書きが置き換わったとき、前回との差分を要約する。
 *
 * 下書きカードはタイトルしか出していなかったので、2 回目以降の要望で中身が変わっても
 * 見た目が一切変わらず「更新されない」不具合に見えた（Issue #303・2026-09-09 実機報告）。
 * 差分は決定的に計算する（AI の reply 文に頼らない — 「変えました」と言いながら同じ下書きを
 * 返すことがあり、その場合は `same` と正直に出す）。
 *
 * 項目の順は「利用者が頼んだ変更が先」: 料理名 → 追加 → 外した → 人数 → 時間 → 手順 →
 * 分量・下ごしらえ（件数だけ）。分量はモデルが「ついでに」動かすことが多く件数も多いので、
 * 個別に並べると頼んだ変更が「ほか N 件」に隠れる。
 */
import { normalizeItemName } from './itemName';
import type { RecipeFormData } from '../validation/recipe.schema';

export type DraftChangeItem =
  | { type: 'title'; to: string }
  | { type: 'ingredientAdded'; name: string }
  | { type: 'ingredientRemoved'; name: string }
  | { type: 'servings'; from: number | undefined; to: number | undefined }
  | { type: 'cookTime'; from: number | undefined; to: number | undefined }
  | { type: 'stepsCount'; from: number; to: number }
  | { type: 'stepsEdited'; count: number }
  /** 分量・下ごしらえ（note）が変わった材料の数。名前は並べない */
  | { type: 'ingredientsAdjusted'; count: number };

export type DraftChange =
  | { kind: 'new' }
  | { kind: 'same' }
  | { kind: 'changed'; items: DraftChangeItem[] };

type Ingredient = RecipeFormData['ingredients'][number];

/** 名寄せは買い物・在庫と同じ規則（NFKC・カナ統一・空白除去）。「にんにく」と「ニンニク」を同一視する */
const nameKey = (ing: Ingredient): string => normalizeItemName(ing.name).toLowerCase();
const normalizeText = (text: string): string =>
  (typeof text.normalize === 'function' ? text.normalize('NFKC') : text).trim();

/** 同名の材料を出現順で束ねる（「塩（下味）」「塩（仕上げ）」の 2 行を 1 つに潰さない） */
function groupByName(ingredients: Ingredient[]): Map<string, Ingredient[]> {
  const groups = new Map<string, Ingredient[]>();
  for (const ing of ingredients) {
    const k = nameKey(ing);
    const list = groups.get(k);
    if (list) list.push(ing);
    else groups.set(k, [ing]);
  }
  return groups;
}

/** 前回の下書き（null = 初回）と今回の下書きを比べる。 */
export function diffConsultDraft(prev: RecipeFormData | null, next: RecipeFormData): DraftChange {
  if (!prev) return { kind: 'new' };

  const items: DraftChangeItem[] = [];

  if (normalizeText(prev.title) !== normalizeText(next.title)) {
    items.push({ type: 'title', to: next.title });
  }

  const prevGroups = groupByName(prev.ingredients);
  const nextGroups = groupByName(next.ingredients);
  const added: DraftChangeItem[] = [];
  const removed: DraftChangeItem[] = [];
  let adjusted = 0;
  for (const [k, nextList] of nextGroups) {
    const prevList = prevGroups.get(k) ?? [];
    // 同名内は出現順で対応づける。余った分が追加、足りない分が削除
    const pairs = Math.min(prevList.length, nextList.length);
    for (let i = 0; i < pairs; i += 1) {
      const before = prevList[i] as Ingredient;
      const after = nextList[i] as Ingredient;
      if (
        normalizeText(before.amount) !== normalizeText(after.amount) ||
        normalizeText(before.note) !== normalizeText(after.note)
      ) {
        adjusted += 1;
      }
    }
    for (let i = pairs; i < nextList.length; i += 1) {
      added.push({ type: 'ingredientAdded', name: (nextList[i] as Ingredient).name });
    }
    for (let i = pairs; i < prevList.length; i += 1) {
      removed.push({ type: 'ingredientRemoved', name: (prevList[i] as Ingredient).name });
    }
  }
  for (const [k, prevList] of prevGroups) {
    if (!nextGroups.has(k)) {
      for (const ing of prevList) removed.push({ type: 'ingredientRemoved', name: ing.name });
    }
  }
  items.push(...added, ...removed);

  if (prev.servings !== next.servings) {
    items.push({ type: 'servings', from: prev.servings, to: next.servings });
  }
  if (prev.cookTimeMin !== next.cookTimeMin) {
    items.push({ type: 'cookTime', from: prev.cookTimeMin, to: next.cookTimeMin });
  }

  if (prev.steps.length !== next.steps.length) {
    items.push({ type: 'stepsCount', from: prev.steps.length, to: next.steps.length });
  } else {
    const edited = next.steps.filter(
      (step, i) => normalizeText(step.body) !== normalizeText(prev.steps[i]?.body ?? ''),
    ).length;
    if (edited > 0) items.push({ type: 'stepsEdited', count: edited });
  }

  if (adjusted > 0) items.push({ type: 'ingredientsAdjusted', count: adjusted });

  return items.length === 0 ? { kind: 'same' } : { kind: 'changed', items };
}

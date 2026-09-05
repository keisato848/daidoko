/**
 * 冷蔵庫写真の確認シートの純ロジック（`docs/冷蔵庫写真設計.md` §4）。
 *
 * 確認シートは**必須・自動確定はしない**。ここはその画面が使う 2 つの判断だけを持つ:
 * 1. confidence（0〜1）→ 3 段階の見た目（低いものは「たぶん◯◯」の要確認表示）
 * 2. 既存在庫との重複（名寄せ済み比較）→ 「すでに在庫にあります」表示＋既定オフ
 *
 * どちらも表示と既定値を決めるだけで、品目を勝手に消したり確定したりしない。
 * 画面から切り離した純関数なので jest でそのまま試せる。
 */
import { normalizeItemName } from './itemName';

/** 読み取りの確からしさの 3 段階（表示用）。 */
export type FridgeConfidenceBand = 'high' | 'medium' | 'low';

/**
 * confidence（0〜1）を 3 段階へ。境界は **0.8 / 0.5**（以上で上の段）。
 * low は「たぶん◯◯」の要確認表示になる。読めない値は low へ倒す —
 * 高く見せると「確認しなくてよさそう」に化ける（安全側は常に要確認）。
 */
export function classifyFridgeConfidence(confidence: number): FridgeConfidenceBand {
  if (!Number.isFinite(confidence)) return 'low';
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/**
 * 名寄せ済みの比較キー。エイリアス辞書（正規化済み表記 → 正規名）を通してから
 * 正規化する — 「豚バラ薄切り」と「豚バラ肉」が辞書で同じ正規名に落ちていれば、
 * 表記が違っても同じ品として重なる。辞書に無い名前は正規化だけで比べる。
 */
export function canonicalNameKey(name: string, aliasMap: Record<string, string>): string {
  const normalized = normalizeItemName(name);
  const canonical = aliasMap[normalized];
  return canonical ? normalizeItemName(canonical) : normalized;
}

/** 確認シートの 1 行。include の既定は「在庫に無いものだけオン」。 */
export interface FridgeReviewItem {
  id: string;
  name: string;
  band: FridgeConfidenceBand;
  /** 既存在庫と同名（名寄せ済み比較）。表示は「すでに在庫にあります」＋既定オフ */
  inPantry: boolean;
  include: boolean;
}

/**
 * 読み取り結果 → 確認シートの行。重複（在庫に既にある品）は**外さず**に見せて
 * 既定オフにする — 上書きも合算もしない・写っていない品目は絶対に消さない、の
 * 「追加のみ」マージ（設計 §4-3）。
 */
export function buildFridgeReviewItems(
  items: { name: string; confidence: number }[],
  pantryNames: string[],
  aliasMap: Record<string, string> = {},
): FridgeReviewItem[] {
  const pantryKeys = new Set(pantryNames.map((name) => canonicalNameKey(name, aliasMap)));
  return items.map((item, index) => {
    const inPantry = pantryKeys.has(canonicalNameKey(item.name, aliasMap));
    return {
      id: String(index),
      name: item.name,
      band: classifyFridgeConfidence(item.confidence),
      inPantry,
      include: !inPantry,
    };
  });
}

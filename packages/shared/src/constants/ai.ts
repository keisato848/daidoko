/**
 * AI 推論まわりの共有定数（`docs/品質基準.md` の水平展開規約・2026-09-05）。
 *
 * **ここが正。** サーバーは実行時に `@daidoko/shared` を取り込まない方針
 * （tsconfig の rootDir が src に閉じている）のため、`apps/server/src/lib/*` は
 * 同じ値の写しを持つ。写しがズレると「契約テストは緑なのに本番で 400」型の
 * 事故になる（冷蔵庫写真の実機 400・2026-09-05）ので、**片方だけ直さないこと**。
 */

/**
 * サーバーへ送る画像 1 枚の base64 上限。
 * サーバー `routes/infer.ts` の `MAX_IMAGE_BASE64_LENGTH` と同値（写し）。
 * 送信側は必ず `image-payload.ts` の縮小ヘルパーを通す — 実機のカメラ写真
 * （6.5MB JPEG → base64 8.6MB）はこの上限を超える。
 */
export const MAX_INFER_IMAGE_BASE64_LENGTH = 8_000_000;

/**
 * 品目名として認めない**カテゴリ語**（ペルソナ検証 2026-09-05・冷蔵庫写真設計 §9）。
 * 実写真の読み取りで「調味料」「飲料」がそのまま品目に混ざり、5 人全員が
 * 「在庫として役に立たない」と一致した。読み取り結果を在庫へ流す経路
 * （冷蔵庫・レシート・名寄せ・食事写真）で共通に使う。
 * **単体一致のみ**（「調味料入れ」等の複合語は対象外）。
 */
export const CATEGORY_NAME_WORDS = [
  '調味料',
  '飲料',
  '飲み物',
  '食品',
  '食材',
  '惣菜',
  '総菜',
  'その他',
  // 出力言語が英語のときの同種語
  'condiment',
  'condiments',
  'seasoning',
  'seasonings',
  'beverage',
  'beverages',
  'drink',
  'drinks',
  'food',
  'foods',
  'grocery',
  'groceries',
  'other',
  'others',
  'miscellaneous',
] as const;

/**
 * 語彙照合用の正規化キー。全半角（NFKC）・大小・カナ/かな・空白の差を吸収する。
 * 依存ゼロの純関数 — サーバーの写し（`nameKey`）と同じ変換であること。
 */
export function vocabKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

const CATEGORY_NAME_KEYS = new Set(CATEGORY_NAME_WORDS.map(vocabKey));

/** 品目名がカテゴリ語（単体一致）かどうか。 */
export function isCategoryName(name: string): boolean {
  return CATEGORY_NAME_KEYS.has(vocabKey(name));
}

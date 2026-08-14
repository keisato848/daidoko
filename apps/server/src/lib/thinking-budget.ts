/**
 * 思考トークンの既定値を一箇所で決める。
 *
 * ## なぜ既定を「切る」にしたか
 *
 * 2.5-flash の思考トークンは**課金上は出力に計上される**。R0 の実測（27件・
 * `docs/レシピ推論の評価設計.md` §9、[[recipe-inference-eval-2026-08]]）では
 * 思考が出力の大半を占め、1 推論あたり ¥0.85 → **¥0.35** の差になっていた。
 * 一方で品質差は 4 軸すべてで 0.04 以内（27件中1件が入れ替わっただけ）で、
 * **コストに見合う効果が観測できなかった**。
 *
 * 2026-08-14 に GCP の実請求を確認したところ、費用の内訳は出力トークンが支配的
 * （12日で ¥164 のうち ¥141）だったため、既定を思考オフに倒した。
 *
 * ## 戻し方
 *
 * Railway の環境変数 `GEMINI_THINKING_BUDGET` で上書きできる。**コード変更も
 * デプロイも要らない**（このリポジトリのサーバーは Play リリースと同時デプロイの
 * 運用なので、品質劣化に気づいたときコードだけでは即座に戻せない）。
 *
 * - 未設定 … 0（思考オフ・既定）
 * - `auto` … モデル既定に戻す（＝思考あり）
 * - 数値 … その値を思考トークンの上限にする
 *
 * ## 適用範囲
 *
 * だいどこのレシピ系の推論のみ。**さいえん手帳の `garden-vision.ts` は対象外**
 * （病害虫の診断は推論の深さが効く可能性があり、別アプリの品質判断なので
 * ここでまとめて倒さない）。`recipe-refine.ts` は用途都合で元から 0 固定。
 */

/** 環境変数が無いときの値。0 = 思考オフ。 */
export const DEFAULT_THINKING_BUDGET = 0;

/**
 * 適用する思考トークン上限。`undefined` は「モデル既定に任せる」を意味し、
 * 呼び出し側は `thinkingConfig` 自体を送らない。
 */
export function resolveThinkingBudget(): number | undefined {
  const raw = process.env['GEMINI_THINKING_BUDGET']?.trim();
  if (raw === undefined || raw === '') return DEFAULT_THINKING_BUDGET;
  if (raw.toLowerCase() === 'auto') return undefined;

  const parsed = Number(raw);
  // 壊れた値でうっかり思考ありに戻ると、気づかないまま課金が増える。既定に倒す。
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_THINKING_BUDGET;
  return parsed;
}

/**
 * `generationConfig` にそのまま展開できる形。`auto` のときは空になり、
 * リクエストボディに `thinkingConfig` が載らない。
 */
export function thinkingConfigFragment(): { thinkingConfig?: { thinkingBudget: number } } {
  const budget = resolveThinkingBudget();
  return budget === undefined ? {} : { thinkingConfig: { thinkingBudget: budget } };
}

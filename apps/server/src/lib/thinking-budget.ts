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
 * だいどこのレシピ系の推論と、**さいえん手帳の `garden-vision.ts`**。
 * `recipe-refine.ts` は用途都合で元から 0 固定。
 *
 * garden-vision は当初「病害虫の診断は推論の深さが効く可能性があり、別アプリの
 * 品質判断なのでここでまとめて倒さない」として除外していた。**2026-08-18 に
 * さいえん手帳側の判断で対象に入れた** — 判断の内訳:
 *
 * - 実測の品質差はレシピ生成で 4 軸すべて 0.04 以内。**診断では測っていない**が、
 *   レシピ生成の方がより推論を要する作業なので、効かない側に倒れる見込みが強い
 * - **さいえん手帳はまだ未公開でユーザーが 0 人。** いま入れれば劣化する相手がいない。
 *   公開後に触ると実利用中に診断の質が変わる
 * - さいえん手帳は写真ベースの記録（収穫の個数カウント）を計画していて、
 *   呼び出し回数が桁で増える。**コストモデルを初日から正しくしておく**必要がある
 *   （saien-techo#144）
 *
 * 品質が落ちるようなら `GEMINI_THINKING_BUDGET=auto` で戻す（**デプロイ不要**）。
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

/**
 * 手順のイラストの AI 生成（`docs/レシピ表紙AI生成設計.md` §8）。
 *
 * 表紙（`cover-image.ts`）との関係は **輸送部は共有・プロンプトだけ別**:
 * `GeminiStepImageProvider` は `GeminiCoverImageProvider` を継承して `buildPrompt` だけを
 * override する。エンドポイント・認証ヘッダ・`image_size`・55 秒の時間予算・応答の解析は
 * 1 か所（`cover-image.ts`）にある。**写さないこと** — Interactions API の応答の形は
 * ドキュメントと違っていた実績があり（`cover-image.ts` 冒頭）、2 か所あると片方だけ直す。
 *
 * プロンプトの本体は `packages/shared/src/constants/step-image.ts` が正で、
 * 下の `buildStepImagePrompt` はその**写し**（server は `rootDir` が `src` に閉じていて
 * `@daidoko/shared` を import できない）。`__tests__/shared-parity.test.ts` が突合する。
 *
 * ## モデル
 *
 * `STEP_IMAGE_MODEL` → `COVER_IMAGE_MODEL` → Lite の順（§8-3）。手順の絵だけ安いモデルに
 * 落とす・表紙だけ上げる、のどちらもデプロイ無しでできる。
 *
 * ## エラーコード
 *
 * `COVER_IMAGE_FAILED` を流用する（§8-3）。アプリ側は表紙と同じ扱いでよく、
 * 新しいコードを足すと `AgentErrorCode` の写しをモバイルにも入れる必要が出る。
 */
import { GeminiCoverImageProvider, type CoverImageInput } from './cover-image.js';

/** 表紙の入力に「どの手順か」を足したもの。`tags` は使わないので空配列でよい。 */
export interface StepImageInput extends CoverImageInput {
  /** この手順の本文 */
  stepBody: string;
  /** 1 始まり */
  stepIndex: number;
  stepCount: number;
}

// ─── プロンプト（shared `constants/step-image.ts` の写し。片方だけ直さないこと） ─────
//
// **この区画は shared と 1 文字も違わないこと**（`shared-parity.test.ts` が突合する）。

/** プロンプトの材料。**写真は送らない**（料理名・材料名・手順の文だけ・§8-4 の開示文と一致）。 */
export interface StepImagePromptInput {
  title: string;
  /** 材料名だけ（分量は渡さない — 幻覚食材を抑える手がかりとしてのみ使う。表紙と同じ） */
  ingredientNames: string[];
  /** この手順の本文 */
  stepBody: string;
  /** 1 始まり */
  stepIndex: number;
  stepCount: number;
  locale?: 'ja' | 'en';
}

/**
 * 縛り（§8-3）。表紙の `PROMPT_CONSTRAINTS` とは**別物**なので使い回さない
 * （表紙は「写真のような質感」を要求し、こちらは禁止している）。
 */
const STEP_PROMPT_CONSTRAINTS = [
  '手描きの絵のようなイラストにする。写真のような質感・実物らしさを描かない。',
  '文字・ロゴ・透かし・人物・手を描かない。',
  '材料リストに無い食材を描き足さない。',
  '完成した料理の盛り付け（できあがりの一皿）を描かない。この手順の途中の状態だけを描く。',
  '実在する店舗名・ブランド名を描かない。',
].join(' ');

/**
 * 1 つの手順を、モデルに渡す 1 つのプロンプトにまとめる。
 * 1 呼び出し 1 枚（§8-3）。純関数・依存ゼロ。
 */
export function buildStepImagePrompt(input: StepImagePromptInput): string {
  const locale = input.locale ?? 'ja';
  const lines = [`料理名: ${input.title}`];
  if (input.ingredientNames.length > 0) {
    lines.push(`使われている材料: ${input.ingredientNames.join('、')}`);
  }
  // 何番目かを渡すのは、モデルが「途中」をどのくらい進んだ状態と解釈するかの手がかり
  // （3/5 なら半ばまで進んでいる）。全体の手順数とセットでないと意味がないので必ず両方出す。
  lines.push(`手順 ${input.stepIndex} / ${input.stepCount}: ${input.stepBody}`);
  lines.push('');
  lines.push('この手順でしていることが分かるイラストを 1 枚描いてください。');
  lines.push(STEP_PROMPT_CONSTRAINTS);
  lines.push(
    locale === 'en'
      ? 'Draw it as a simple hand-drawn cooking illustration, as it would look in an English-language recipe booklet.'
      : '日本の家庭の台所で、この手順をしているところが分かる素朴な絵にする。',
  );
  return lines.join('\n');
}

// ─── provider ────────────────────────────────────────────────────────────────

export interface StepImageProvider {
  generate(input: StepImageInput): Promise<{ mimeType: string; dataBase64: string }>;
}

/**
 * 表紙の provider の輸送部に、手順のプロンプトを載せただけのもの。
 * 時間予算（55 秒・リトライなし）も表紙のまま — クライアントは 1 枚ずつ逐次に呼ぶので、
 * 1 呼び出しあたりの予算は表紙と同じでよい（`cover-image-retry-budget.test.ts` が
 * 両方を同じ定数で見張る）。
 */
export class GeminiStepImageProvider
  extends GeminiCoverImageProvider<StepImageInput>
  implements StepImageProvider
{
  constructor(opts?: { apiKey?: string; model?: string }) {
    super({
      ...(opts?.apiKey !== undefined && { apiKey: opts.apiKey }),
      model:
        opts?.model?.trim() ||
        process.env['STEP_IMAGE_MODEL']?.trim() ||
        process.env['COVER_IMAGE_MODEL']?.trim() ||
        'gemini-3.1-flash-lite-image',
    });
  }

  protected override buildPrompt(input: StepImageInput): string {
    return buildStepImagePrompt({
      title: input.title,
      ingredientNames: input.ingredientNames,
      stepBody: input.stepBody,
      stepIndex: input.stepIndex,
      stepCount: input.stepCount,
      ...(input.outputLocale !== undefined && { locale: input.outputLocale }),
    });
  }
}

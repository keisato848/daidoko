/**
 * レシピ表紙の AI 生成（イメージ）— docs/レシピ表紙AI生成設計.md。
 *
 * UI 上の呼び方は「イメージ」「AI プレビュー」（「表紙」とは言わない・設計冒頭の
 * 利用者決定）。内部名は `cover-image`（`coverPhotoPath` に引きずられた既存呼称の
 * ままでよい、と設計が明記している）。
 *
 * ## なぜ generateContent ではないか
 *
 * このリポジトリの他の provider（`menu-arrange.ts`・`recipe-consult.ts`・
 * `garden-vision.ts` 等）はテキスト/構造化出力を `generateContent`
 * （`/v1beta/models/{model}:generateContent`）で叩いている。
 * だが画像生成モデル（Gemini 3 系の image ファミリー・既定
 * `gemini-3.1-flash-lite-image`）は 2026-08-28 時点のドキュメント
 * （https://ai.google.dev/gemini-api/docs/image-generation）では
 * **Interactions API**（`POST /v1beta/interactions`。認証は `x-goog-api-key`
 * ヘッダ・`generateContent` の `?key=` クエリではない）が正式な経路として
 * 案内されている。`responseModalities`/`generationConfig.imageConfig` のような
 * `generateContent` 系のフィールド名はこのモデル系のドキュメントには出てこない。
 * エンドポイント・認証ヘッダ・リクエスト body（`response_format.image_size: '1K'`
 * まで含め）は 2026-08-29 の実呼び出しで検証済み（200 応答・
 * `scripts/cover-image-check.ts probe`）。**ただしレスポンス側の形はドキュメントと
 * 違った** — `output_image.data` ではなく `steps[]` の中の
 * `type: 'model_output'` → `content[].type === 'image'` から拾う（下記
 * `extractModelOutputImage` 参照）。ずれていた場合は本ファイルとレスポンス解釈
 * だけを直せばよい（契約 `CoverImageProvider` は変えずに済む設計にしてある）。
 *
 * ## モデルは env で差し替え可能
 *
 * `COVER_IMAGE_MODEL`（既定 'gemini-3.1-flash-lite-image'）。品質評価
 * （和食 10 題 × Lite/3.1-flash の目視比較・設計 §1）の結果で 3.1-flash に
 * 変える可能性があるため、**アプリのリリース無しで差し替えられることが目的**。
 *
 * ## タイムアウトとリトライ（設計 §5 の確定）
 *
 * **55 秒・リトライなし。** garden-vision.ts に明文化された教訓
 * （リトライ予算 < クライアントタイムアウト。超えるとクライアントが諦めた後に
 * サーバーだけ成功して課金）の極端形 — リトライ予算をゼロにすれば、
 * どんなクライアントタイムアウトに対しても超えようがない。
 * モバイル側は 75 秒で諦める想定なので 20 秒の余裕がある。
 * この不等式は `__tests__/cover-image-retry-budget.test.ts` が見張る。
 */
import { DEFAULT_OUTPUT_LOCALE, type OutputLocale } from './output-locale.js';

export interface CoverImageInput {
  title: string;
  /** 材料名だけ（分量は渡さない — 幻覚食材を抑える手がかりとしてのみ使う） */
  ingredientNames: string[];
  tags: string[];
  outputLocale?: OutputLocale;
}

/** 生成された画像そのもの（1K 解像度の JPEG を想定）。 */
export interface CoverImageResult {
  mimeType: string;
  dataBase64: string;
}

export interface CoverImageProvider {
  generate(input: CoverImageInput): Promise<CoverImageResult>;
}

export class CoverImageConfigError extends Error {}
export class CoverImageRequestError extends Error {}
/** 上流（Gemini）の利用枠切れ。再試行しても当面回復しない（他 provider と同じ扱い）。 */
export class CoverImageQuotaError extends CoverImageRequestError {}

export const MAX_COVER_INGREDIENTS = 20;
export const MAX_COVER_TAGS = 5;

/** 縛り（設計 §5）。プロンプトはサーバー側が組み立てる — 手書きプロンプトは受けない。 */
const PROMPT_CONSTRAINTS = [
  '材料リストに無い食材を描き足さない。',
  '文字・ロゴ・透かし・人物・手を描かない。',
  '実在する店舗名・ブランド名を描かない。',
  '写真のような自然な質感で、家庭の食卓に出せる一皿として構図をまとめる。',
].join(' ');

/**
 * タイトル・材料名・タグ・言語を、モデルに渡す 1 つのプロンプトにまとめる
 * （テスト・provider から共有するため公開）。
 */
export function buildCoverImagePrompt(input: CoverImageInput): string {
  const locale = input.outputLocale ?? DEFAULT_OUTPUT_LOCALE;
  const lines = [`料理名: ${input.title}`];
  if (input.ingredientNames.length > 0) {
    lines.push(`使われている材料: ${input.ingredientNames.join('、')}`);
  }
  if (input.tags.length > 0) {
    lines.push(`タグ: ${input.tags.join('、')}`);
  }
  lines.push('');
  lines.push('この料理のできあがりを写真のように 1 枚描いてください。');
  lines.push(PROMPT_CONSTRAINTS);
  lines.push(
    locale === 'en'
      ? 'Plate and style it the way it would naturally look on a table in an English-speaking household.'
      : '日本の家庭の食卓に出てくるような、自然な盛り付けにする。',
  );
  return lines.join('\n');
}

const GEMINI_INTERACTIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

/**
 * Interactions API の実応答の形（2026-08-29 実機呼び出しで検証・
 * `scripts/cover-image-check.ts probe` の結果）。
 * `output_image.data` ではなく、トップレベル `steps: [...]` の中に
 * `type: 'thought'`（`signature` フィールドに巨大な不透明文字列。画像ではない）と
 * `type: 'model_output'`（`content: [{ type: 'image', data, mime_type }]`）が
 * 混在して返る。画像は必ず `model_output` の `content[].type === 'image'` から
 * 取ること — `thought.signature` を誤って拾うと壊れた（デコード不能な）画像になる。
 */
interface InteractionsResponse {
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; data?: string; mime_type?: string }>;
  }>;
}

function extractModelOutputImage(
  json: InteractionsResponse,
): { data: string; mimeType: string } | null {
  for (const step of json.steps ?? []) {
    if (step.type !== 'model_output') continue;
    for (const item of step.content ?? []) {
      if (item.type !== 'image') continue;
      if (typeof item.data === 'string' && typeof item.mime_type === 'string') {
        return { data: item.data, mimeType: item.mime_type };
      }
    }
  }
  return null;
}

/** サーバーの時間予算（設計 §5 の確定: 55 秒・リトライなし）。 */
export const REQUEST_TIMEOUT_MS = 55_000;
export const MAX_ATTEMPTS = 1;
/** 最悪ケースの所要時間（ミリ秒）。テストが上限を見張るために公開する。 */
export const COVER_IMAGE_RETRY_BUDGET_MS = REQUEST_TIMEOUT_MS * MAX_ATTEMPTS;
/** モバイル側の待ち時間の想定（設計 §5）。garden-vision.ts と同じ形で公開する。 */
export const CLIENT_TIMEOUT_MS = 75_000;

/** Google Gemini（Interactions API）による実装。 */
export class GeminiCoverImageProvider implements CoverImageProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new CoverImageConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model =
      opts?.model?.trim() ||
      process.env['COVER_IMAGE_MODEL']?.trim() ||
      'gemini-3.1-flash-lite-image';
  }

  async generate(input: CoverImageInput): Promise<CoverImageResult> {
    const body = {
      model: this.model,
      input: [{ type: 'text', text: buildCoverImagePrompt(input) }],
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        // 大文字 K 必須。ドキュメントに明記されている（小文字は拒否される）
        image_size: '1K',
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        // 429 は「上限」と「一時的な混雑」の両方で返る。上限は再試行しても当面回復しない
        if (res.status === 429 && /quota|billing|exceeded/i.test(detail)) {
          throw new CoverImageQuotaError(`Gemini quota exceeded: ${detail}`);
        }
        throw new CoverImageRequestError(`Gemini ${res.status}: ${detail}`);
      }

      const json = (await res.json()) as InteractionsResponse;
      const found = extractModelOutputImage(json);
      if (!found) {
        throw new CoverImageRequestError('Gemini returned no image');
      }
      return { mimeType: found.mimeType, dataBase64: found.data };
    } catch (err) {
      if (err instanceof CoverImageQuotaError || err instanceof CoverImageRequestError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CoverImageRequestError('Gemini request timed out');
      }
      throw new CoverImageRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

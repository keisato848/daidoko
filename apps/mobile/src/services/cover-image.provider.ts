/**
 * レシピ「イメージ」の AI 生成（R4・クライアント側）。docs/レシピ表紙AI生成設計.md。
 *
 * 画面上の呼び方は「イメージ」「AI プレビュー」（「表紙」とは言わない）。内部名は
 * `cover-image`（`coverPhotoPath` に引きずられた既存呼称のままでよいと設計が明記）。
 *
 * プロンプト・API 表面（Interactions API・`x-goog-api-key`）は
 * `apps/server/src/lib/cover-image.ts` の写し。**片方だけ直さないこと。**
 * BYOK（自分の Gemini キー）が設定されていれば直接、無ければ managed サーバー経由
 * （`menu-arrange.provider.ts` と同じ形）。
 *
 * 別勘定のゲート（月 3 枚・広告 1 本=1 枚）は `cover-image-gate.service.ts` の役割で、
 * ここでは扱わない — このファイルは「1 回ぶん生成する」ことだけをする。
 *
 * ## タイムアウト（設計 §5 の確定）
 *
 * **クライアント 75 秒。** サーバーの時間予算（55 秒・リトライなし）の外側
 * （`apps/server/src/lib/cover-image.ts` の同名コメント参照・
 * `__tests__/cover-image-retry-budget.test.ts` が両側の不等式を見張る）。
 */
import { getInstallationId } from './app-meta.service';
import { getUserApiKey } from './byok.service';
import { requestLocale, type OutputLocale } from './ai-output-locale';
import { API_V1 } from '../config';
import { t } from '../i18n';
import { serverErrorFor } from './ai-error';

/** モバイル側の待ち時間（設計 §5）。サーバー `REQUEST_TIMEOUT_MS`(55s) の外側。 */
export const CLIENT_TIMEOUT_MS = 75_000;

export const MAX_COVER_INGREDIENTS = 20;
export const MAX_COVER_TAGS = 5;

export interface CoverImageInput {
  title: string;
  /** 材料名だけ（分量は渡さない — 幻覚食材を抑える手がかりとしてのみ使う） */
  ingredientNames: string[];
  tags: string[];
}

/** 生成された画像そのもの（1K 解像度の JPEG を想定）。 */
export interface CoverImageResult {
  mimeType: string;
  dataBase64: string;
}

export class CoverImageError extends Error {
  /** t() 済みの文言を持つ印（ai-error.ts） */
  readonly userVisible = true;
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'CoverImageError';
    this.retryable = retryable;
  }
}

// ─── プロンプト（サーバー lib/cover-image.ts の写し。片方だけ直さないこと） ──────

/** 縛り（設計 §5）。プロンプトはこちら側が組み立てる — 手書きプロンプトは受けない。 */
const PROMPT_CONSTRAINTS = [
  '材料リストに無い食材を描き足さない。',
  '文字・ロゴ・透かし・人物・手を描かない。',
  '実在する店舗名・ブランド名を描かない。',
  '写真のような自然な質感で、家庭の食卓に出せる一皿として構図をまとめる。',
].join(' ');

/** タイトル・材料名・タグ・言語を、モデルに渡す 1 つのプロンプトにまとめる。 */
export function buildCoverImagePrompt(
  input: CoverImageInput,
  locale: OutputLocale = requestLocale(),
): string {
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

function boundInput(input: CoverImageInput): CoverImageInput {
  return {
    title: input.title,
    ingredientNames: input.ingredientNames.slice(0, MAX_COVER_INGREDIENTS),
    tags: input.tags.slice(0, MAX_COVER_TAGS).map((tag) => tag.slice(0, 30)),
  };
}

// ─── BYOK（自分のキーで直接・Interactions API） ─────────────────────────────

const GEMINI_INTERACTIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';
/** BYOK 側の既定モデル。サーバーの `COVER_IMAGE_MODEL` 既定と揃える。 */
const BYOK_COVER_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

/**
 * Interactions API の実応答の形（2026-08-29 実機呼び出しで検証済み）。
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

/**
 * `apps/server/src/lib/cover-image.ts` の `extractModelOutputImage()` の写し
 * （2026-08-29 実呼び出しで検証済みの形）。片方だけ直さないこと。
 */
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

async function generateViaByok(input: CoverImageInput, apiKey: string): Promise<CoverImageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: BYOK_COVER_IMAGE_MODEL,
        input: [{ type: 'text', text: buildCoverImagePrompt(input) }],
        response_format: {
          type: 'image',
          mime_type: 'image/jpeg',
          // 大文字 K 必須（ドキュメントに明記・小文字は拒否される。サーバー側と同じ）
          image_size: '1K',
        },
      }),
      signal: controller.signal,
    });
    if (res.status === 429) throw new CoverImageError(t('ai.error.byokQuota'), false);
    if (!res.ok) {
      const info = serverErrorFor(res.status);
      throw new CoverImageError(info.message, info.retryable);
    }
    const json = (await res.json()) as InteractionsResponse;
    const found = extractModelOutputImage(json);
    if (!found) throw new CoverImageError(t('coverImage.error.failed'), true);
    return { mimeType: found.mimeType, dataBase64: found.data };
  } catch (err) {
    if (err instanceof CoverImageError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CoverImageError(t('ai.error.timeout'), true);
    }
    throw new CoverImageError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

// ─── managed サーバー経由 ────────────────────────────────────────────────────

interface ServerAgentResult {
  ok: boolean;
  data?: CoverImageResult;
  error?: { code: string; message: string; retryable: boolean };
}

async function generateViaServer(input: CoverImageInput): Promise<CoverImageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const deviceId = await getInstallationId();
    const res = await fetch(`${API_V1}/infer/cover-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({
        title: input.title,
        ingredientNames: input.ingredientNames,
        tags: input.tags,
        locale: requestLocale(),
      }),
      signal: controller.signal,
    });
    // 404/未デプロイも含め、想定外の HTTP ステータスは例外を握って失敗扱いにする
    // （[client-must-survive-server-skew] — 呼び出し側はフォームを壊さずトーストへ落とす）
    if (!res.ok) {
      const info = serverErrorFor(res.status);
      throw new CoverImageError(info.message, info.retryable);
    }
    const result = (await res.json()) as ServerAgentResult;
    if (!result.ok || !result.data) {
      const quota =
        result.error?.code === 'AI_QUOTA_EXCEEDED' || result.error?.code === 'RATE_LIMITED';
      throw new CoverImageError(
        quota ? t('error.quotaExceeded') : t('coverImage.error.failed'),
        result.error?.retryable ?? true,
      );
    }
    return result.data;
  } catch (err) {
    if (err instanceof CoverImageError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CoverImageError(t('ai.error.timeout'), true);
    }
    throw new CoverImageError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * レシピの「イメージ」を 1 枚生成する。BYOK があれば自分のキーで直接、無ければ
 * サーバー経由。**別勘定のゲート判定は呼び出し側の責務**（`cover-image-gate.service.ts`）
 * — ここは「実行してよい」と決まったあとの 1 回ぶんを生成するだけ。
 */
export async function generateCoverImage(input: CoverImageInput): Promise<CoverImageResult> {
  const bounded = boundInput(input);
  const userKey = await getUserApiKey();
  return userKey ? generateViaByok(bounded, userKey) : generateViaServer(bounded);
}

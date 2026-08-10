/**
 * Recipe refine provider — 感想（＋任意の写真）で既存レシピを店の味に近づける。
 *
 * 経路は写真レシピと同じ2つ:
 *  - BYOK: ユーザーが自分の Gemini キーを設定していれば端末から直接呼ぶ（自分で払う）
 *  - Managed: それ以外は自前サーバー（POST /api/v1/infer/refine）経由
 *
 * **プロンプトとスキーマは `apps/server/src/lib/recipe-refine.ts` が正**。
 * BYOK 経路のためにここへ写しているので、片方だけ直さないこと。
 *
 * エラー種別は写真レシピと共通（VisionInferenceError / VisionErrorKind）。
 * 「つながらない」と「上限に達した」を分ける方針は Issue #120 と同じ。
 */
import * as FileSystem from 'expo-file-system/legacy';

import { API_V1, GEMINI_MODEL } from '../config';
import { getUserApiKey } from './byok.service';
import { VisionInferenceError, type VisionErrorKind } from './vision-recipe.provider';
import type { RecipeFormData } from '../validation/recipe.schema';
import { t } from '../i18n';
import { requestLocale, withOutputLanguage } from './ai-output-locale';

const TIMEOUT_MS = 35_000;

/** 添付写真の役割。cooked = 家で作った結果（現状）/ target = 店の料理（目指す状態）。 */
export type RefineImageRole = 'cooked' | 'target';

export interface RefinePhoto {
  uri: string;
  role: RefineImageRole;
}

export interface RefineRecipeSnapshot {
  title: string;
  servings?: number;
  cookTimeMin?: number;
  description?: string;
  ingredients: { groupLabel?: string; name: string; amount?: string; note?: string }[];
  steps: { body: string }[];
  tags?: string[];
}

export interface RefineResult {
  draft: RecipeFormData;
  /** 何をどう変えたか。差分プレビューの見出しに使う */
  changeSummary: string;
}

interface ServerDraft {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients: { groupLabel?: string; name: string; amount?: string; note?: string }[];
  steps: { body: string }[];
  tags?: string[];
}

interface ServerAgentResult {
  ok: boolean;
  data?: { draft: ServerDraft; changeSummary: string };
  error?: { code: string; message: string; retryable: boolean };
}

function kindFromCode(code: string | undefined): VisionErrorKind {
  if (code === 'RATE_LIMITED' || code === 'AI_QUOTA_EXCEEDED') return 'quota_exceeded';
  if (code === 'AI_API_UNAVAILABLE') return 'transient';
  return 'failed';
}

function toFormData(draft: ServerDraft): RecipeFormData {
  return {
    title: draft.title,
    titleReading: draft.titleReading ?? '',
    description: draft.description ?? '',
    ...(draft.servings !== undefined && { servings: draft.servings }),
    ...(draft.cookTimeMin !== undefined && { cookTimeMin: draft.cookTimeMin }),
    ingredients: draft.ingredients.map((ing) => ({
      groupLabel: ing.groupLabel ?? '',
      name: ing.name,
      amount: ing.amount ?? '',
      note: ing.note ?? '',
    })),
    steps: draft.steps.map((step) => ({ body: step.body })),
    tags: draft.tags ?? [],
  };
}

function mimeTypeFor(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

interface EncodedImage {
  imageBase64: string;
  mimeType: string;
  role: RefineImageRole;
}

/** 読めなかった写真は黙って落とす（写真は任意入力なので、失敗させない）。 */
async function encodePhotos(photos: RefinePhoto[]): Promise<EncodedImage[]> {
  const encoded: EncodedImage[] = [];
  for (const photo of photos) {
    try {
      const imageBase64 = await FileSystem.readAsStringAsync(photo.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      encoded.push({ imageBase64, mimeType: mimeTypeFor(photo.uri), role: photo.role });
    } catch {
      // この写真は添えずに続ける
    }
  }
  return encoded;
}

// ── BYOK: direct Gemini call from the device (the user's own key) ───────────
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const GEMINI_BACKOFF_MS = [0, 1_500, 4_000];

/** サーバー側 `recipe-refine.ts` の SYSTEM_PROMPT と同内容（BYOK 経路用の写し）。 */
const SYSTEM_PROMPT = [
  'あなたは、家庭で作った料理をお店の味に近づける、日本語のプロの料理人です。',
  '既存のレシピと、作った人の感想（＋あれば写真）を受け取り、**感想で指示された点だけ**を直します。',
  '',
  '## 最も重要な制約: 指示された点だけを変える',
  '- 感想と無関係な材料・手順は、**一字一句そのまま**出力する。言い回しを整えることもしない。',
  '- 材料の並び順・グループ（groupLabel）・手順の順序は変えない。',
  '  変える必要があるときは、その理由を changeSummary に書く。',
  '- 料理そのものが別物だと分かる場合を除き、title は変えない。',
  '- 変更は最小限にする。「ついでに良くする」ことをしてはならない。',
  '  ユーザーは自分のレシピを育てており、勝手な書き換えは信頼を壊す。',
  '',
  '## レシピの不備は直さない',
  '手順に出てくるのに材料表にない、分量が書かれていない、といった不備に気づいても、',
  '**感想と関係がなければ直さない**。気づいた点は changeSummary の末尾に一言添えるだけにする。',
  'ユーザーが意図してそう書いている可能性があり、頼まれていない補完は書き換えと同じである。',
  '',
  '## 変えられないときは変えない',
  '感想から「何をどう変えるか」が読み取れない場合（例: 「おいしかった」「また作る」のような',
  '感想のみ、内容が空、レシピと無関係）は changed=false とし、changeSummary に',
  '**何が足りないか**を一文で書く。推測で書き換えてはならない。',
  '',
  '## 写真の使い方（添付されている場合）',
  '- role=cooked: 家で作った結果。**現状**を表す。',
  '- role=target: お店の料理。**目指す状態**を表す。',
  '- 2枚あるときは、見た目の差（焼き色・とろみ・色の濃さ・具の大きさ・量）を根拠に使う。',
  '- **写真に写らないもの（味・香り・塩気・辛さ）は、感想テキストだけを根拠にする。**',
  '  写真から味を推測してはならない。',
  '',
  '## 直し方',
  '- 分量を変えるときは具体値で（「少し減らす」ではなく「大さじ1 → 小さじ2」）。',
  '- 味の方向を変えるとき、材料を足すより**既存の材料の配合を変える**方を優先する。',
  '- 手順で解決できるもの（火加減・加熱時間・入れる順番・水分の飛ばし方）は、',
  '  材料をいじらず手順を直す。',
  '- 家庭の台所で実行できる範囲に収める。',
  '',
  '## changeSummary',
  '何をどう変えたかを、ユーザーが読んで納得できる日本語で 1〜3 文で書く。',
  '「甘みを抑えるため、みりんを大さじ2から大さじ1に減らしました」のように、',
  '**変更内容と理由をセット**で書く。',
  '',
  'ingredients と steps は、変更後の**レシピ全体**を返す（差分ではない）。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    changed: { type: 'BOOLEAN' },
    changeSummary: { type: 'STRING' },
    title: { type: 'STRING' },
    titleReading: { type: 'STRING' },
    description: { type: 'STRING' },
    servings: { type: 'INTEGER' },
    cookTimeMin: { type: 'INTEGER' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          groupLabel: { type: 'STRING' },
          name: { type: 'STRING' },
          amount: { type: 'STRING' },
          note: { type: 'STRING' },
        },
      },
    },
    steps: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { body: { type: 'STRING' } } },
    },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  // サーバー側と同じ。必須にしないとモデルが材料・手順を省くことがある（実機で被弾）
  required: ['changed', 'changeSummary', 'ingredients', 'steps'],
};

interface GeminiRefineRaw {
  changed?: boolean;
  changeSummary?: string;
  title?: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients?: { groupLabel?: string; name?: string; amount?: string; note?: string }[];
  steps?: { body?: string }[];
  tags?: string[];
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  // 構造化出力でも "null" / "undefined" という文字列が返ることがある（実測）
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined;
  return trimmed.slice(0, max);
}

function cleanPositiveInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded < min || rounded > max ? undefined : rounded;
}

/**
 * モデル出力を ServerDraft 形へ整える。**省いたフィールドは現行レシピの値を残す**
 * （省略 = 変更なし。サーバーの normalizeRefined と同じ契約）。
 * 材料・手順が全滅したら null。
 */
export function normalizeRefinedRaw(
  raw: GeminiRefineRaw,
  base: RefineRecipeSnapshot,
): ServerDraft | null {
  // 材料ごとの省略も現行レシピで埋める（サーバーの normalizeRefined と同じ担保）。
  // 感想と無関係な材料の amount が落ちた応答が実測で出たため、名前で突き合わせる
  const baseByName = new Map(base.ingredients.map((ing) => [ing.name.trim(), ing]));

  const ingredients = (raw.ingredients ?? [])
    .map((item) => {
      const name = cleanString(item?.name, 50);
      if (!name) return null;
      const original = baseByName.get(name);
      const groupLabel = cleanString(item?.groupLabel, 30) ?? original?.groupLabel;
      const amount = cleanString(item?.amount, 30) ?? original?.amount;
      // 分量が変わっていない材料の note は元のまま（サーバーの normalizeRefined と同じ）。
      // 注記だけの変更で差分が埋まると、本当の変更を見つけられなくなる
      const amountUnchanged = original !== undefined && amount === original.amount;
      const note = amountUnchanged
        ? original.note
        : (cleanString(item?.note, 100) ?? original?.note);
      return {
        name,
        ...(groupLabel !== undefined && { groupLabel }),
        ...(amount !== undefined && { amount }),
        ...(note !== undefined && { note }),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const steps = (raw.steps ?? [])
    .map((item) => {
      const body = cleanString(item?.body, 500);
      return body ? { body } : null;
    })
    .filter((item): item is { body: string } => item !== null);

  if (ingredients.length === 0 || steps.length === 0) return null;

  const titleReading = cleanString(raw.titleReading, 100);
  const description = cleanString(raw.description, 500) ?? base.description;
  const servings = cleanPositiveInt(raw.servings, 1, 99) ?? base.servings;
  const cookTimeMin = cleanPositiveInt(raw.cookTimeMin, 1, 999) ?? base.cookTimeMin;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => cleanString(tag, 30))
        .filter((tag): tag is string => tag !== undefined)
        .slice(0, 10)
    : (base.tags ?? []);

  return {
    title: cleanString(raw.title, 100) ?? base.title,
    ...(titleReading !== undefined && { titleReading }),
    ...(description !== undefined && { description }),
    ...(servings !== undefined && { servings }),
    ...(cookTimeMin !== undefined && { cookTimeMin }),
    ingredients,
    steps,
    ...(tags.length > 0 && { tags }),
  };
}

function buildUserText(
  recipe: RefineRecipeSnapshot,
  feedback: string,
  images: EncodedImage[],
): string {
  const legend =
    images.length === 0
      ? ''
      : `\n\n添付写真:\n${images
          .map(
            (image, index) =>
              `写真${index + 1}: ${
                image.role === 'cooked' ? '家で作った結果（現状）' : 'お店の料理（目指す状態）'
              }`,
          )
          .join('\n')}`;

  return [
    '次のレシピを、感想にしたがって直してください。',
    '',
    '## 現在のレシピ',
    JSON.stringify(recipe, null, 2),
    '',
    '## 作った人の感想',
    feedback.trim(),
    legend,
  ].join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refineViaByok(
  recipe: RefineRecipeSnapshot,
  feedback: string,
  images: EncodedImage[],
  apiKey: string,
): Promise<RefineResult> {
  const body = {
    systemInstruction: { parts: [{ text: withOutputLanguage(SYSTEM_PROMPT) }] },
    contents: [
      {
        role: 'user',
        parts: [
          ...images.map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.imageBase64 },
          })),
          { text: buildUserText(recipe, feedback, images) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      // レシピ全体を返させるので出力が長い。既定のままだと打ち切られる
      maxOutputTokens: 8192,
      // 思考は切る（出力枠を食う・この処理には不要・コストも下がる）
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let lastError = '';
  let lastStatusWasQuota = false;
  for (let attempt = 0; attempt < GEMINI_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(GEMINI_BACKOFF_MS[attempt] ?? 4_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      lastError = 'network';
      lastStatusWasQuota = false;
      clearTimeout(timer);
      continue;
    }
    clearTimeout(timer);

    if (!res.ok) {
      lastError = `Gemini ${res.status}`;
      lastStatusWasQuota = res.status === 429;
      if (GEMINI_RETRYABLE_STATUS.has(res.status)) continue;
      throw new VisionInferenceError(t('ai.error.apiKey'), false);
    }

    const json = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new VisionInferenceError(t('ai.error.noResult'), true);

    let raw: GeminiRefineRaw;
    try {
      raw = JSON.parse(text) as GeminiRefineRaw;
    } catch {
      throw new VisionInferenceError(t('ai.error.unparsable'), true);
    }

    if (!raw.changed) {
      throw new VisionInferenceError(
        cleanString(raw.changeSummary, 300) ?? t('recipe.refine.noChange'),
        false,
        'no_change',
      );
    }
    const draft = normalizeRefinedRaw(raw, recipe);
    if (!draft) throw new VisionInferenceError(t('recipe.refine.convertFailed'), true);
    return {
      draft: toFormData(draft),
      changeSummary: cleanString(raw.changeSummary, 300) ?? t('recipe.refine.done'),
    };
  }

  if (lastStatusWasQuota) {
    throw new VisionInferenceError(t('ai.error.byokQuota'), false, 'quota_exceeded');
  }
  throw new VisionInferenceError(
    lastError === 'network' ? t('error.offline') : t('ai.error.unreachable', { reason: lastError }),
    true,
    lastError === 'network' ? 'offline' : 'transient',
  );
}

async function refineViaServer(
  recipe: RefineRecipeSnapshot,
  feedback: string,
  images: EncodedImage[],
): Promise<RefineResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_V1}/infer/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipe,
        feedback: feedback.trim(),
        ...(images.length > 0 && { images }),
        locale: requestLocale(),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new VisionInferenceError(
        t('ai.error.serverError', { status: res.status }),
        res.status >= 500,
      );
    }

    const result = (await res.json()) as ServerAgentResult;
    if (!result.ok || !result.data) {
      const code = result.error?.code;
      throw new VisionInferenceError(
        result.error?.message ?? t('recipe.refine.failed'),
        result.error?.retryable ?? true,
        code === 'REFINE_NO_CHANGE' ? 'no_change' : kindFromCode(code),
      );
    }

    return { draft: toFormData(result.data.draft), changeSummary: result.data.changeSummary };
  } catch (err) {
    if (err instanceof VisionInferenceError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new VisionInferenceError(t('ai.error.timeout'), true, 'transient');
    }
    throw new VisionInferenceError(t('error.offline'), true, 'offline');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 感想（＋任意の写真）で既存レシピを調整する。
 * BYOK キーがあれば端末から直接、なければ自前サーバー経由。失敗時は VisionInferenceError。
 */
export async function refineRecipe(args: {
  recipe: RefineRecipeSnapshot;
  feedback: string;
  photos?: RefinePhoto[];
}): Promise<RefineResult> {
  const images = await encodePhotos(args.photos ?? []);
  const userKey = await getUserApiKey();
  if (userKey) {
    return refineViaByok(args.recipe, args.feedback, images, userKey);
  }
  return refineViaServer(args.recipe, args.feedback, images);
}

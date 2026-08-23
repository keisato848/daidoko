/**
 * 紙面のレシピ読み取り — レシピ本・食品パッケージ・手書きメモ・切り抜きに
 * **書かれているレシピ**を AI に読ませて下書きにする。
 *
 * 端末内 OCR（ML Kit）から置き換えたもの。ML Kit の `rawText` は版面のレイアウトを
 * 保存せず、イラスト脇の狭い段に組まれた 1 文が 4 つの断片に割れるため、
 * 実際のレシピ本やパッケージでは成立しなかった（`docs/レシピ推論の評価設計.md` §10）。
 *
 * **複数枚を 1 つのレシピにまとめる。** 紙面は表に料理名・裏に材料と作り方のように
 * 分かれるのが普通で、1 枚では完結しない。
 *
 * 経路は他の AI 機能と同じ 2 本:
 *  - BYOK: 利用者が自分の Gemini キーを設定していれば端末から直接（無料枠を使わない）
 *  - サーバー: それ以外は `POST /api/v1/infer/recipe-page`
 *
 * **プロンプトはサーバー `apps/server/src/lib/recipe-page.ts` の写し。**
 * BYOK はサーバーを通らないので、両方に同じ規則を置くしかない
 * （`ai-output-locale.ts` と同じ事情）。片方だけ直すと BYOK の利用者だけ挙動が変わる。
 */
import * as FileSystem from 'expo-file-system/legacy';

import { API_V1, GEMINI_MODEL } from '../config';
import { getUserApiKey } from './byok.service';
import { expoImageManipulatorPreprocessAdapter } from './expo-image-preprocess.adapter';
import { preprocessImageForOcr } from './image-preprocess.service';
import type { RecipeFormData } from '../validation/recipe.schema';
import { t } from '../i18n';
import {
  requestLocale,
  requestUnitSystem,
  withOutputLanguage,
  withUnitSystem,
} from './ai-output-locale';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000];
const TIMEOUT_MS = 40_000;

/** 1 回に送れる紙面の枚数。サーバー側 `MAX_RECIPE_PAGE_IMAGES` と揃える。 */
export const MAX_RECIPE_PAGE_IMAGES = 4;

/**
 * 送る前に縮める長辺。**縮めないと送れない。**
 * 端末のカメラは 4320x7680 のような巨大な写真を返し、そのまま base64 にすると
 * 1 枚で 10.7M 文字になってサーバーの上限（8M 文字 ≒ 6MB）を超える（実測・2026-08-23）。
 *
 * 一方で**縮めすぎると読めない**（端末内 OCR は長辺 1200 で文字が潰れて失敗していた
 * — `docs/レシピ推論の評価設計.md` §10）。2000 なら 4 枚送っても本文は数 MB に収まり、
 * 紙面の本文も判読できる大きさが残る。
 */
const PAGE_MAX_DIMENSION = 2000;

export interface RecipePageResult {
  draft: RecipeFormData;
  confidence: 'high' | 'medium' | 'low';
}

/** 読み取れなかった理由。画面はこれで文言と導線を出し分ける。 */
export type RecipePageErrorKind =
  /** 紙面にレシピが写っていない（撮り直しで直る） */
  | 'not-found'
  /** つながらない・オフライン */
  | 'offline'
  /** サーバー/モデル側の一時的な失敗 */
  | 'transient';

export class RecipePageError extends Error {
  constructor(
    message: string,
    readonly kind: RecipePageErrorKind,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'RecipePageError';
  }
}

/** サーバー `apps/server/src/lib/recipe-page.ts` の SYSTEM_PROMPT の写し。片方だけ直さないこと。 */
const SYSTEM_PROMPT = [
  'あなたは、紙面に書かれたレシピを正確に書き写す編集者です。',
  '写真に写っているレシピを、**書かれているとおりに**構造化して返します。',
  '',
  '## 最優先の制約: 書いていないことを書かない',
  '- 紙面に無い材料・分量・手順を**推測で補ってはいけません**。',
  '- 分量が書かれていない材料は、amount を空にします。埋めてはいけません。',
  '- 下味・隠し味の推定を note に書いてはいけません。ここは転記であって創作ではありません。',
  '- 読めなかった文字は、その部分を飛ばします。当て推量で埋めないでください。',
  '',
  '## 手順0: レシピが写っているかを判定する',
  '次のときは found=false とし、rejectReason を返します。レシピは書きません。',
  '- no_text: 文字がほとんど写っていない（料理や物の写真だけ）',
  '- unreadable: ぶれ・暗さ・小ささで文字が判読できない',
  '- no_recipe: 文字は読めるが、材料と作り方が書かれていない',
  '  （商品パッケージの表・広告・栄養成分表示だけ、など）',
  '**材料か作り方のどちらかが読み取れれば found=true** にします。両方揃っている必要はありません。',
  '',
  '## 複数枚は 1 つのレシピに統合する',
  '写真が複数あるときは、**同じレシピの別の面**（パッケージの表と裏、本の見開き、',
  '続きのページ）として扱い、**1 つのレシピにまとめます**。',
  '- 料理名は、それが書かれている面から取ります。',
  '- 材料と作り方は、書かれている面から取ります。',
  '- 同じ内容が複数の面に写っている場合は、重複させずに 1 回だけ書きます。',
  '',
  '## 紙面の読み方',
  '- **折り返しは 1 文につなぎます。** 紙面は幅の狭い段に組まれ、1 つの手順が何行にも',
  '  折り返されます。行ごとに分けず、文として完結する単位でまとめてください。',
  '- **点線（リーダー）は材料名と分量の区切りです。**',
  '  「じゃがいも(くし形切り)……中2個(300g)」は name=「じゃがいも(くし形切り)」、',
  '  amount=「中2個(300g)」です。',
  '- 見出しに人数が付いている場合（「材料(2人前)」）は、servings に入れ、見出しは材料に含めません。',
  '- イラストや図の中の番号（①②③）は手順の番号です。手順の本文には含めません。',
  '',
  '## 料理名の選び方',
  '- 紙面の**いちばん大きな見出し**、または商品名を料理名にします。',
  '- キャッチコピー・注意書き・ブランド名を料理名にしてはいけません。',
  '  （「冷凍素材にも」「開け口から、矢印の方向に引いて開けてください」「SPICE&HERB」などは料理名ではありません）',
  '- 料理名が紙面のどこにも無い場合は、title を空にします。作ってはいけません。',
  '',
  '## 材料と手順に入れてはいけないもの',
  '- 原材料表示・栄養成分表示・賞味期限・保存方法・加工者・問い合わせ先・バーコードの数字',
  '- 「やけどに注意」などの注意書き（手順の本文に自然に含まれている場合を除く）',
  '- 商品の宣伝文・アレンジの誘導・QR コードの説明',
  '',
  '## confidence の基準',
  '- high: 材料と作り方の両方が、欠けなく読み取れた',
  '- medium: どちらかに読み取れない箇所がある',
  '- low: 断片的にしか読み取れていない',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
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
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    rejectReason: { type: 'STRING', enum: ['no_recipe', 'unreadable', 'no_text'] },
  },
  required: ['found'],
};

interface RecipePageRaw {
  found?: boolean;
  title?: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients?: { groupLabel?: string; name?: string; amount?: string; note?: string }[];
  steps?: { body?: string }[];
  tags?: string[];
  confidence?: 'high' | 'medium' | 'low';
  rejectReason?: 'no_recipe' | 'unreadable' | 'no_text';
}

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function cleanInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : undefined;
}

/**
 * モデル / サーバーの返しを `RecipeFormData` にする。**保存スキーマの上限に収める。**
 * 紙面は片面だけを撮ることが普通なので、**材料か手順のどちらかが読めていれば通す**
 * （料理名は空でもよい。確認画面で入力させる）。
 */
export function normalizeRecipePageRaw(raw: RecipePageRaw): RecipePageResult | null {
  if (raw.found === false) return null;

  const ingredients = (raw.ingredients ?? [])
    .map((item) => {
      const name = clean(item?.name, 50);
      if (!name) return null;
      return {
        name,
        amount: clean(item?.amount, 30) ?? '',
        groupLabel: clean(item?.groupLabel, 30) ?? '',
        note: clean(item?.note, 100) ?? '',
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const steps = (raw.steps ?? [])
    .map((item) => {
      const body = clean(item?.body, 500);
      return body ? { body } : null;
    })
    .filter((item): item is { body: string } => item !== null);

  if (ingredients.length === 0 && steps.length === 0) return null;

  const servings = cleanInt(raw.servings, 1, 99);
  const cookTimeMin = cleanInt(raw.cookTimeMin, 1, 999);
  const description = clean(raw.description, 500);
  const titleReading = clean(raw.titleReading, 100);
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => clean(tag, 30))
        .filter((tag): tag is string => tag !== undefined)
        .slice(0, 10)
    : [];

  return {
    draft: {
      title: clean(raw.title, 100) ?? '',
      titleReading: titleReading ?? '',
      description: description ?? '',
      ...(servings !== undefined && { servings }),
      ...(cookTimeMin !== undefined && { cookTimeMin }),
      // 確認画面で編集するので、空でも 1 行は置く
      ingredients:
        ingredients.length > 0 ? ingredients : [{ name: '', amount: '', groupLabel: '', note: '' }],
      steps: steps.length > 0 ? steps : [{ body: '' }],
      tags,
    },
    confidence: raw.confidence ?? 'low',
  };
}

interface PageImage {
  base64: string;
  mimeType: string;
}

function mimeTypeFor(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function userText(count: number, context?: string): string {
  const lines = [
    count > 1
      ? `この ${count} 枚は同じレシピの別の面です。1 つのレシピにまとめて読み取ってください。`
      : 'この写真に書かれているレシピを読み取ってください。',
  ];
  const trimmed = context?.trim();
  if (trimmed) lines.push(`利用者からの補足: ${trimmed}`);
  return lines.join('\n');
}

async function readViaByok(
  images: PageImage[],
  context: string | undefined,
  apiKey: string,
): Promise<RecipePageRaw> {
  const body = {
    systemInstruction: {
      parts: [{ text: withUnitSystem(withOutputLanguage(SYSTEM_PROMPT)) }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          ...images.map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.base64 },
          })),
          { text: userText(images.length, context) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let res: Response | null = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    if (BACKOFF_MS[attempt] > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new RecipePageError(t('error.offline'), 'offline', true);
    }
    if (res.ok || !RETRYABLE_STATUS.has(res.status)) break;
  }
  if (!res || !res.ok) {
    throw new RecipePageError(t('recipeImport.page.failed'), 'transient', true);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new RecipePageError(t('recipeImport.page.failed'), 'transient', true);
  }
  return JSON.parse(text) as RecipePageRaw;
}

async function readViaServer(
  images: PageImage[],
  context: string | undefined,
): Promise<RecipePageRaw> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_V1}/infer/recipe-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: images.map((image) => ({
          imageBase64: image.base64,
          mimeType: image.mimeType,
        })),
        ...(context?.trim() ? { context: context.trim() } : {}),
        locale: requestLocale(),
        unitSystem: requestUnitSystem(),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new RecipePageError(t('recipeImport.page.failed'), 'transient', true);
    }
    const json = (await res.json()) as {
      ok: boolean;
      data?: RecipePageRaw;
      error?: { code?: string; message?: string; retryable?: boolean };
    };
    if (!json.ok || !json.data) {
      // サーバーが「レシピが写っていない」と判断したときは、その文言をそのまま出す。
      // 次に何をすればよいかまで書いてある（`agents/recipe-page.agent.ts`）
      const isNotFound = json.error?.code === 'RECIPE_PAGE_NOT_FOUND';
      throw new RecipePageError(
        json.error?.message ?? t('recipeImport.page.failed'),
        isNotFound ? 'not-found' : 'transient',
        json.error?.retryable === true,
      );
    }
    return json.data;
  } catch (error) {
    if (error instanceof RecipePageError) throw error;
    throw new RecipePageError(t('error.offline'), 'offline', true);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 紙面の写真からレシピの下書きを作る。**読めなければ throw する**ので、
 * 呼び出し側は理由（`kind`）で文言と導線を出し分ける。
 */
export async function readRecipeFromPages(args: {
  imageUris: string[];
  context?: string;
}): Promise<RecipePageResult> {
  const uris = args.imageUris.slice(0, MAX_RECIPE_PAGE_IMAGES);
  if (uris.length === 0) {
    throw new RecipePageError(t('recipe.photo.noImage'), 'not-found', false);
  }

  const images: PageImage[] = [];
  for (const uri of uris) {
    try {
      // 送る前に必ず縮める。原寸のままだとサーバーの上限を超えて送れない
      const processed = await preprocessImageForOcr(uri, expoImageManipulatorPreprocessAdapter, {
        maxDimension: PAGE_MAX_DIMENSION,
      });
      const base64 = await FileSystem.readAsStringAsync(processed.imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      images.push({ base64, mimeType: mimeTypeFor(processed.imageUri) });
    } catch {
      throw new RecipePageError(t('ai.error.imageLoadFailed'), 'transient', false);
    }
  }

  const userKey = await getUserApiKey();
  const raw = userKey
    ? await readViaByok(images, args.context, userKey)
    : await readViaServer(images, args.context);

  const result = normalizeRecipePageRaw(raw);
  if (!result) {
    throw new RecipePageError(t('recipeImport.page.notFound'), 'not-found', false);
  }
  return result;
}

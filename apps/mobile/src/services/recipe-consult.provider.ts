/**
 * 相談してレシピを作る（クライアント側）。
 *
 * 写真からレシピは**目の前に料理がある**ときの機能で、こちらは**まだ料理が無い**とき。
 * 「なんとなく作りたいもの」を話しながら下書きに落としていく。
 *
 * BYOK（自分の Gemini キー）が設定されていれば直接、無ければ managed サーバー経由。
 * プロンプトはサーバー `apps/server/src/lib/recipe-consult.ts` の写し。
 * **片方だけ直さないこと。**
 */
import * as FileSystem from 'expo-file-system/legacy';

import { API_V1 } from '../config';
import { expoImageManipulatorPreprocessAdapter } from './expo-image-preprocess.adapter';
import { preprocessImageForOcr } from './image-preprocess.service';
import { t } from '../i18n';
import { serverErrorFor } from './ai-error';
import {
  requestLocale,
  requestUnitSystem,
  withOutputLanguage,
  withUnitSystem,
} from './ai-output-locale';
import { getUserApiKey } from './byok.service';
import type { RecipeFormData } from '../validation/recipe.schema';

const TIMEOUT_MS = 45_000;

/** 1 リクエストで送る会話の上限。サーバー側と揃える。 */
export const MAX_CONSULT_MESSAGES = 24;

export type ConsultRole = 'user' | 'assistant';

export interface ConsultMessage {
  role: ConsultRole;
  text: string;
  /**
   * その発言に添えた写真の**端末内パス**（冷蔵庫の中身・食材・参考にしたい料理）。
   * base64 は送る直前にここで作る — **画面の state に base64 を置かない**
   * （会話が伸びるほど state が重くなるため）。
   */
  imageUris?: string[];
}

/** 1 回の発言に添えられる写真。画面もこの数で止める。 */
export const MAX_CONSULT_IMAGES_PER_MESSAGE = 2;

/** 1 リクエストに載せる写真の総数。サーバー側 `MAX_CONSULT_IMAGES` と揃える。 */
export const MAX_CONSULT_IMAGES = 4;

/**
 * 送る前に縮める長辺。冷蔵庫や食材が判別できればよいので、紙面（2000）より小さくてよい。
 * 会話は往復ごとに送るので、1 枚ぶんの重さがそのまま毎回の待ち時間になる。
 */
const CONSULT_IMAGE_MAX_DIMENSION = 1280;

/** 会話の途中で育っていく下書き。保存するまで DB には入らない。 */
export interface ConsultTurnResult {
  reply: string;
  /** そのまま保存できる状態か */
  ready: boolean;
  /** 現時点の下書き。まだ出せない往復では null */
  draft: RecipeFormData | null;
}

export class ConsultError extends Error {
  /** t() 済みの文言を持つ印（ai-error.ts） */
  readonly userVisible = true;
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ConsultError';
    this.retryable = retryable;
  }
}

interface ServerIngredient {
  groupLabel?: string;
  name: string;
  amount?: string;
  note?: string;
}

interface ServerDraft {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  ingredients: ServerIngredient[];
  steps: { body: string }[];
  tags?: string[];
}

interface ServerAgentResult {
  ok: boolean;
  data?: { reply: string; ready: boolean; draft: ServerDraft | null };
  error?: { code: string; message: string; retryable: boolean };
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

/** 保存中の下書きを、次の往復でサーバーへ返す形にする。 */
export function formDataToDraft(form: RecipeFormData): ServerDraft {
  return {
    title: form.title,
    ...(form.titleReading ? { titleReading: form.titleReading } : {}),
    ...(form.description ? { description: form.description } : {}),
    ...(form.servings !== undefined && { servings: form.servings }),
    ...(form.cookTimeMin !== undefined && { cookTimeMin: form.cookTimeMin }),
    ingredients: form.ingredients.map((ing) => ({
      ...(ing.groupLabel ? { groupLabel: ing.groupLabel } : {}),
      name: ing.name,
      ...(ing.amount ? { amount: ing.amount } : {}),
      ...(ing.note ? { note: ing.note } : {}),
    })),
    steps: form.steps.map((step) => ({ body: step.body })),
    // サーバー契約（タグ ≤10 個・各 ≤30 字）に送信側で収める（P4）
    ...(form.tags.length > 0 && {
      tags: form.tags.slice(0, 10).map((tag) => tag.slice(0, 30)),
    }),
  };
}

/** 会話が長くなったら古い方から落とす（直近ほど効く）。 */
export function trimMessages(
  messages: ConsultMessage[],
  max = MAX_CONSULT_MESSAGES,
): ConsultMessage[] {
  return messages.length <= max ? messages : messages.slice(messages.length - max);
}

interface WireImage {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface WireMessage {
  role: ConsultRole;
  text: string;
  images?: WireImage[];
}

function mimeTypeFor(uri: string): WireImage['mimeType'] {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * 送る写真を**新しい方から** `MAX_CONSULT_IMAGES` 枚だけ base64 にする。
 * 落とす判断はサーバーもやるが、**端末側で先に落とさないと無駄に base64 を作って送ることになる**
 * （会話が伸びるほど効く）。assistant の発言に付いた写真は載せない。
 */
async function toWireMessages(messages: ConsultMessage[]): Promise<WireMessage[]> {
  let budget = MAX_CONSULT_IMAGES;
  const keep = new Map<number, string[]>();
  for (let index = messages.length - 1; index >= 0 && budget > 0; index--) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const uris = message.imageUris ?? [];
    if (uris.length === 0) continue;
    const take = uris.slice(Math.max(0, uris.length - budget));
    keep.set(index, take);
    budget -= take.length;
  }

  const wire: WireMessage[] = [];
  for (const [index, message] of messages.entries()) {
    const uris = keep.get(index);
    if (!uris || uris.length === 0) {
      wire.push({ role: message.role, text: message.text });
      continue;
    }
    const images: WireImage[] = [];
    for (const uri of uris) {
      try {
        const processed = await preprocessImageForOcr(uri, expoImageManipulatorPreprocessAdapter, {
          maxDimension: CONSULT_IMAGE_MAX_DIMENSION,
        });
        images.push({
          imageBase64: await FileSystem.readAsStringAsync(processed.imageUri, {
            encoding: FileSystem.EncodingType.Base64,
          }),
          mimeType: mimeTypeFor(processed.imageUri),
        });
      } catch {
        // 1 枚読めなくても相談は続けられる。黙って落とす方が会話が止まらない
      }
    }
    wire.push(
      images.length > 0
        ? { role: message.role, text: message.text, images }
        : { role: message.role, text: message.text },
    );
  }
  return wire;
}

export interface ConsultArgs {
  messages: ConsultMessage[];
  draft?: RecipeFormData | null;
  /** 手元の在庫。**「在庫を考慮する」を選んだときだけ**渡す */
  pantry?: string[];
}

// ─── BYOK（自分のキーで直接） ────────────────────────────────────────────────

// サーバー側 SYSTEM_PROMPT の写し。**片方だけ直さないこと。**
const SYSTEM_PROMPT = [
  'あなたは、家庭料理を一緒に考える日本語の料理人です。',
  '利用者が「作りたいもの」を話すのを聞き、レシピの下書きに落としていきます。',
  '',
  '## 役割',
  '- あなたは**相談相手**であって、献立を決める人ではない。決めるのは常に利用者。',
  '- 返事は短く。3 文以内を目安にする。長い説明より、次の一手が分かることを優先する。',
  '- **質問は一度に 1 つだけ。**',
  '',
  '## 下書きを出すタイミング',
  '- 料理の見当がついたら、**聞き切る前に**下書きを出す。',
  '- まだ料理が絞れないときは下書きを出さず、質問だけ返す。',
  '- 下書きを出したら reply では**変えた点だけ**に触れる。',
  '',
  '## 下書きの直し方',
  '- **言われた点だけを変える。** 関係ない材料・手順は一字一句そのまま残す。',
  '- 分量は具体値で書く。家庭の台所と近所のスーパーで作れる範囲に収める。',
  '- draft は常に**レシピ全体**を返す（差分ではない）。',
  '',
  '## 写真が添えられたとき',
  '- 冷蔵庫の中身・食材・参考にしたい料理の写真が来ることがある。**写真は手がかりであって注文ではない。**',
  '- 写っているものを勝手にレシピへ入れない。まず「何が写っているか」を短く確かめてから使う。',
  '- 賞味期限・分量・鮮度は写真から確定できない。**見えないことを見えたことにしない。**',
  '- 参考にしたい料理の写真なら、それに寄せた下書きを出す。目分量は推定と分かるように書く。',
  '- 写真が来ていないときは、写真の話をしない。',
  '',
  '## 在庫が渡されたとき',
  '- 使えるものを優先する。ただし**在庫だけで無理に作らない**。足りないものは材料に書く。',
  '- 在庫が渡されていないときは、在庫の話をしない。',
  '',
  '## ready',
  '材料と手順が揃い、そのまま作れる状態になったら ready=true。質問中は false。',
  '',
  '## してはならないこと',
  '- 利用者が言っていない制約を勝手に決めつける。',
  '- **アレルゲンの有無を保証する。** 「ナッツ不使用です」のような断定はしない。',
  '- 栄養素・カロリーの数値を出す。',
].join('\n');

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    ready: { type: 'BOOLEAN' },
    draft: {
      type: 'OBJECT',
      properties: {
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
    },
  },
  required: ['reply', 'ready'],
};

/** 下書きと在庫を、最後の user 発言に添える文字列にする（直近ほど効く）。 */
export function buildContextText(args: ConsultArgs): string {
  const parts: string[] = [];
  if (args.draft) {
    parts.push('## いまの下書き', JSON.stringify(formDataToDraft(args.draft), null, 2));
  }
  const pantry = (args.pantry ?? []).filter((name) => name.trim()).slice(0, 200);
  if (pantry.length > 0) {
    parts.push(
      '## 手元にある材料（在庫）',
      pantry.join('、'),
      'これらを優先して使ってよい。ただし在庫だけで無理に作らないこと。',
    );
  }
  return parts.join('\n');
}

async function consultViaByok(args: ConsultArgs, apiKey: string): Promise<ConsultTurnResult> {
  const messages = await toWireMessages(trimMessages(args.messages));
  const context = buildContextText(args);
  const contents = messages.map((message, index) => {
    const isLast = index === messages.length - 1;
    const text = isLast && context ? `${message.text}\n\n${context}` : message.text;
    return {
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(message.images ?? []).map((image) => ({
          inlineData: { mimeType: image.mimeType, data: image.imageBase64 },
        })),
        { text },
      ],
    };
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: withUnitSystem(withOutputLanguage(SYSTEM_PROMPT)) }],
          },
          contents,
          generationConfig: {
            temperature: 0.6,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
        signal: controller.signal,
      },
    );
    if (res.status === 429) throw new ConsultError(t('ai.error.byokQuota'), false);
    if (!res.ok) {
      const info = serverErrorFor(res.status);
      throw new ConsultError(info.message, info.retryable);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new ConsultError(t('error.photoRecipeFailed'), true);
    const raw = JSON.parse(text) as {
      reply?: string;
      ready?: boolean;
      draft?: ServerDraft | null;
    };
    // サーバー側の正規化（材料/手順が空なら下書きにしない）を再現する
    const usable =
      raw.draft && raw.draft.ingredients?.length > 0 && raw.draft.steps?.length > 0
        ? raw.draft
        : null;
    return {
      reply: raw.reply?.trim() || t('recipeImport.consult.emptyReply'),
      ready: raw.ready === true && usable !== null,
      draft: usable ? toFormData(usable) : null,
    };
  } catch (err) {
    if (err instanceof ConsultError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ConsultError(t('ai.error.timeout'), true);
    }
    throw new ConsultError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

// ─── managed サーバー経由 ────────────────────────────────────────────────────

async function consultViaServer(args: ConsultArgs): Promise<ConsultTurnResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_V1}/infer/consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: await toWireMessages(trimMessages(args.messages)),
        ...(args.draft ? { draft: formDataToDraft(args.draft) } : {}),
        ...(args.pantry && args.pantry.length > 0 ? { pantry: args.pantry } : {}),
        locale: requestLocale(),
        unitSystem: requestUnitSystem(),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const info = serverErrorFor(res.status);
      throw new ConsultError(info.message, info.retryable);
    }
    const result = (await res.json()) as ServerAgentResult;
    if (!result.ok || !result.data) {
      // サーバーの文言は日本語固定。上限だけは種別で判別して辞書から出す
      const quota =
        result.error?.code === 'AI_QUOTA_EXCEEDED' || result.error?.code === 'RATE_LIMITED';
      throw new ConsultError(
        quota ? t('error.quotaExceeded') : t('error.photoRecipeFailed'),
        result.error?.retryable ?? true,
      );
    }
    return {
      reply: result.data.reply,
      ready: result.data.ready,
      draft: result.data.draft ? toFormData(result.data.draft) : null,
    };
  } catch (err) {
    if (err instanceof ConsultError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ConsultError(t('ai.error.timeout'), true);
    }
    throw new ConsultError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 相談を 1 往復進める。BYOK があれば自分のキーで直接、無ければサーバー経由。
 */
export async function consultRecipe(args: ConsultArgs): Promise<ConsultTurnResult> {
  const userKey = await getUserApiKey();
  return userKey ? consultViaByok(args, userKey) : consultViaServer(args);
}

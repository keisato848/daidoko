/**
 * Receipt inference — extract grocery items (name / quantity / unit) from a
 * receipt via Gemini (BYOK direct) or the managed server (/infer/receipt).
 *
 * **入力は2種類、出力は1つ。** 端末内 OCR が読めたときは文字起こししたテキストを、
 * 読めなかったときは写真を送る。構造化・非食品除外・重複統合はどちらも AI 側で
 * 同じように行う（`docs/在庫・レシート設計レビュー.md` §3.4 / Issue #178）。
 * テキストで送れると画像トークンが要らず、レシート写真そのものが端末から出ない。
 */
import * as FileSystem from 'expo-file-system/legacy';

import { API_V1, GEMINI_MODEL } from '../config';
import { normalizeItemName } from '../utils/itemName';
import { normalizeReceiptQuantity } from '../utils/receiptQuantity';
import { getUserApiKey } from './byok.service';
import { requestLocale, withOutputLanguage } from './ai-output-locale';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000];

/** 品目の作り方。**画像経路とテキスト経路で共有する**（サーバー側 `receipt-vision.ts` と対）。 */
const ITEM_RULES = [
  '品目名は家庭の在庫管理に使える一般的な名前へ正規化します（例: 半角カナ「ｷﾞｭｳﾆｭｳ」→「牛乳」）。ブランド名・容量・規格は省きます。',
  '日用品・雑貨、レジ袋、値引き行、小計・合計・ポイントなどの非商品行は除外します。',
  '同じ品目が複数行あっても 1 つにまとめます（数量がすべて読み取れる場合のみ合算し、1 行でも読めなければ quantity を省きます）。',
  'quantity には購入数量を入れます。行に数量が印字されておらず内容量（例: 「豚こま 500g」）だけが読めるときは、その内容量を quantity、単位を unit にします。',
  'unit には印字された単位・助数詞（個・本・袋・パック・g・ml など）だけを入れます。数量しか印字されていない場合は unit を省きます。',
  '数量が読み取れない・自信が無い場合は quantity を省きます（1 で埋めない）。値引き行や単価行の数字を数量として拾わないでください。',
];

const SYSTEM_PROMPT = [
  'あなたはスーパーやコンビニのレシート写真から「食材・食品の品目」を抽出する日本語の専門家です。',
  'レシートに印字された商品行のうち、食材・食品・飲料だけを items に列挙してください。',
  ...ITEM_RULES,
  '写真がレシートでない場合は isReceipt=false を返し、items は空にします。',
].join('\n');

/** 端末内 OCR の生テキストを渡す経路。画像を見る前提の文言は成り立たない。 */
const TEXT_SYSTEM_PROMPT = [
  'あなたはレシートを OCR にかけて得られたテキストから「食材・食品の品目」を抽出する日本語の専門家です。',
  '入力は OCR の生テキストです。行の折り返し・列のずれ・誤認識が含まれます。品名と数量・単価が別の行に分かれていることがあるので、レシートの体裁として自然になるように対応づけてください。',
  'テキストに含まれる商品行のうち、食材・食品・飲料だけを items に列挙してください。',
  ...ITEM_RULES,
  '意味の取れない文字列は OCR の誤認識です。品目として無理に採用しないでください。',
  'テキストがレシートのものでない場合は isReceipt=false を返し、items は空にします。',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isReceipt: { type: 'BOOLEAN' },
    store: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          // 数量・単位は任意（読めなかったことを表せる必要があるので required に入れない）
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
        },
        required: ['name'],
      },
    },
    confidence: { type: 'STRING' },
  },
  required: ['isReceipt'],
};

/**
 * A single line read off the receipt. `quantity` / `unit` are null when the
 * receipt didn't say (or the value looked implausible) — the pantry treats a
 * null quantity as "unmanaged", which is honest, whereas a guessed 1 quietly
 * inflates stock. See docs/買い物リスト・在庫設計.md §6.
 */
export interface ReceiptInferenceItem {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface ReceiptInference {
  isReceipt: boolean;
  store: string | null;
  /** Normalized, de-duplicated items in print order. */
  items: ReceiptInferenceItem[];
}

interface ReceiptVisionItemRaw {
  name?: string;
  quantity?: number | null;
  unit?: string | null;
}

interface ReceiptVisionRaw {
  isReceipt?: boolean;
  store?: string;
  items?: ReceiptVisionItemRaw[];
}

/** Sum two quantities the way the pantry does: null wins (＝数量未管理). */
function mergeQuantity(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return Math.round((a + b) * 1000) / 1000;
}

export function normalizeReceiptRaw(raw: ReceiptVisionRaw): ReceiptInference {
  // Merge duplicates on the same key the pantry merges on (normalized name ×
  // unit), so what the review screen shows matches what actually gets stored.
  const indexByKey = new Map<string, number>();
  const items: ReceiptInferenceItem[] = [];
  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 50) : '';
      if (!name) continue;
      const { quantity, unit } = normalizeReceiptQuantity(item?.quantity, item?.unit);
      const key = `${normalizeItemName(name)}|${unit ?? ''}`;
      const existingIndex = indexByKey.get(key);
      if (existingIndex != null) {
        const existing = items[existingIndex];
        items[existingIndex] = {
          ...existing,
          quantity: mergeQuantity(existing.quantity, quantity),
        };
        continue;
      }
      indexByKey.set(key, items.length);
      items.push({ name, quantity, unit });
    }
  }
  return {
    isReceipt: raw.isReceipt === true,
    store: typeof raw.store === 'string' && raw.store.trim() ? raw.store.trim() : null,
    items,
  };
}

/** AI に渡すレシート。端末内 OCR が読めたときは text、読めなかったときは image。 */
type ReceiptSource =
  | { kind: 'image'; base64: string; mimeType: string }
  | { kind: 'text'; ocrText: string };

function userPartsFor(source: ReceiptSource): Record<string, unknown>[] {
  return source.kind === 'text'
    ? [
        { text: 'このレシートの OCR テキストから食材・食品の品目を抽出してください。' },
        { text: source.ocrText },
      ]
    : [
        { inlineData: { mimeType: source.mimeType, data: source.base64 } },
        { text: 'このレシートから食材・食品の品目を抽出してください。' },
      ];
}

async function inferViaByok(source: ReceiptSource, apiKey: string): Promise<ReceiptInference> {
  const body = {
    systemInstruction: {
      parts: [
        {
          text: withOutputLanguage(source.kind === 'text' ? TEXT_SYSTEM_PROMPT : SYSTEM_PROMPT),
        },
      ],
    },
    contents: [{ role: 'user', parts: userPartsFor(source) }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let res: Response | null = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    if (BACKOFF_MS[attempt] > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok || !RETRYABLE_STATUS.has(res.status)) break;
  }
  if (!res || !res.ok) {
    throw new Error(`Gemini receipt infer failed: ${res?.status ?? 'no response'}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('empty model response');
  return normalizeReceiptRaw(JSON.parse(text));
}

async function inferViaServer(source: ReceiptSource): Promise<ReceiptInference> {
  const payload =
    source.kind === 'text'
      ? { ocrText: source.ocrText }
      : { imageBase64: source.base64, mimeType: source.mimeType };
  const res = await fetch(`${API_V1}/infer/receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, locale: requestLocale() }),
  });
  if (!res.ok) throw new Error(`server receipt infer failed: ${res.status}`);
  const json = (await res.json()) as {
    ok: boolean;
    data?: ReceiptVisionRaw;
    error?: { message?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(json.error?.message ?? 'receipt inference unavailable');
  }
  return normalizeReceiptRaw(json.data);
}

async function infer(source: ReceiptSource): Promise<ReceiptInference> {
  const userKey = await getUserApiKey();
  return userKey ? inferViaByok(source, userKey) : inferViaServer(source);
}

/** Extract grocery items from a receipt photo (BYOK if a key is set, else server). */
export async function inferReceiptFromVision(args: {
  localPath: string;
  mimeType: string;
}): Promise<ReceiptInference> {
  const base64 = await FileSystem.readAsStringAsync(args.localPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return infer({ kind: 'image', base64, mimeType: args.mimeType });
}

/**
 * Extract grocery items from text an on-device OCR already read off the receipt.
 * 写真を送らずに済む経路（`docs/在庫・レシート設計レビュー.md` §3.4）。
 */
export async function inferReceiptFromText(args: { ocrText: string }): Promise<ReceiptInference> {
  return infer({ kind: 'text', ocrText: args.ocrText });
}

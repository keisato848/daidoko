/**
 * Receipt Vision provider — extract grocery item names from a receipt photo via
 * Gemini (BYOK direct) or the managed server (/infer/receipt). Cloud fallback
 * for the on-device ML Kit OCR, which is Android-only and unavailable since
 * the SDK 54 migration. See docs/買い物リスト・在庫設計.md §5.6 / Issue #68.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { API_V1, GEMINI_MODEL } from '../config';
import { getUserApiKey } from './byok.service';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000];

const SYSTEM_PROMPT = [
  'あなたはスーパーやコンビニのレシート写真から「食材・食品の品目」を抽出する日本語の専門家です。',
  'レシートに印字された商品行のうち、食材・食品・飲料だけを items に列挙してください。',
  '品目名は家庭の在庫管理に使える一般的な名前へ正規化します（例: 半角カナ「ｷﾞｭｳﾆｭｳ」→「牛乳」）。ブランド名・容量・規格は省きます。',
  '日用品・雑貨、レジ袋、値引き行、小計・合計・ポイントなどの非商品行は除外します。',
  '同じ品目が複数行あっても 1 つにまとめます。',
  '写真がレシートでない場合は isReceipt=false を返し、items は空にします。',
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
        properties: { name: { type: 'STRING' } },
        required: ['name'],
      },
    },
    confidence: { type: 'STRING' },
  },
  required: ['isReceipt'],
};

export interface ReceiptInference {
  isReceipt: boolean;
  store: string | null;
  /** Normalized, de-duplicated item names in print order. */
  items: string[];
}

interface ReceiptVisionRaw {
  isReceipt?: boolean;
  store?: string;
  items?: { name?: string }[];
}

export function normalizeReceiptRaw(raw: ReceiptVisionRaw): ReceiptInference {
  const seen = new Set<string>();
  const items: string[] = [];
  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 50) : '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      items.push(name);
    }
  }
  return {
    isReceipt: raw.isReceipt === true,
    store: typeof raw.store === 'string' && raw.store.trim() ? raw.store.trim() : null,
    items,
  };
}

async function inferViaByok(
  base64: string,
  mimeType: string,
  apiKey: string,
): Promise<ReceiptInference> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: 'このレシートから食材・食品の品目を抽出してください。' },
        ],
      },
    ],
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

async function inferViaServer(base64: string, mimeType: string): Promise<ReceiptInference> {
  const res = await fetch(`${API_V1}/infer/receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, mimeType }),
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

/** Extract grocery items from a receipt photo (BYOK if a key is set, else server). */
export async function inferReceiptFromVision(args: {
  localPath: string;
  mimeType: string;
}): Promise<ReceiptInference> {
  const base64 = await FileSystem.readAsStringAsync(args.localPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const userKey = await getUserApiKey();
  return userKey
    ? inferViaByok(base64, args.mimeType, userKey)
    : inferViaServer(base64, args.mimeType);
}

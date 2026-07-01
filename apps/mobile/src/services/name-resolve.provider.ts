/**
 * Name-resolution provider — turns messy pantry/receipt names into canonical
 * ingredient names via Gemini (text). Uses the user's BYOK key when set,
 * otherwise the managed server. Batched: one call resolves many names.
 * See docs/買い物リスト・在庫設計.md §6.
 */
import { API_V1, GEMINI_MODEL } from '../config';
import { getUserApiKey } from './byok.service';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000];

const SYSTEM_PROMPT = [
  'あなたは食材名の正規化器です。',
  '各入力（レシートの商品名や在庫の名前）を、レシピで使う「一般的な食材名」に変換してください。',
  'ブランド名・産地・規格・分量・状態表現（洗い/カット/大袋 等）は取り除き、食材の総称にします。',
  '例: とっとごたまご→卵、アクシアルハーフベーコン→ベーコン、春よ恋強力小麦粉→小麦粉、ぶなしめじ→しめじ。',
  '食材でないもの（袋・容器・日用品・クーポン・値引 等）は canonical を空文字 "" にしてください。',
  '入力と同じ件数だけ、各要素に name（入力そのまま）と canonical を返してください。',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      canonical: { type: 'STRING' },
    },
    required: ['name', 'canonical'],
  },
};

export interface ResolvedName {
  name: string;
  canonical: string;
}

function parseResolved(raw: unknown): ResolvedName[] {
  if (!Array.isArray(raw)) return [];
  const out: ResolvedName[] = [];
  for (const item of raw) {
    if (item && typeof item.name === 'string' && typeof item.canonical === 'string') {
      out.push({ name: item.name, canonical: item.canonical });
    }
  }
  return out;
}

async function resolveViaByok(names: string[], apiKey: string): Promise<ResolvedName[]> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(names) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  const url = `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let res: Response | null = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    if (BACKOFF_MS[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
    }
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok || !RETRYABLE_STATUS.has(res.status)) break;
  }
  if (!res || !res.ok)
    throw new Error(`Gemini name-resolve failed: ${res?.status ?? 'no response'}`);

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return [];
  return parseResolved(JSON.parse(text));
}

async function resolveViaServer(names: string[]): Promise<ResolvedName[]> {
  const res = await fetch(`${API_V1}/resolve/names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  });
  if (!res.ok) throw new Error(`Server name-resolve failed: ${res.status}`);
  const json = (await res.json()) as { items?: unknown };
  return parseResolved(json.items ?? json);
}

/** Resolve names to canonical ingredient names (BYOK if a key is set, else server). */
export async function resolveNames(names: string[]): Promise<ResolvedName[]> {
  if (names.length === 0) return [];
  const userKey = await getUserApiKey();
  return userKey ? resolveViaByok(names, userKey) : resolveViaServer(names);
}

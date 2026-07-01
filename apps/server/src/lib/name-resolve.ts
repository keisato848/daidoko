/**
 * Managed name resolution — messy pantry/receipt names → canonical ingredient
 * names via Gemini (text, batched). Mirrors the mobile BYOK provider prompt.
 */
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
} as const;

export class ResolveConfigError extends Error {}

export interface ResolvedName {
  name: string;
  canonical: string;
}

export interface NameResolver {
  resolve(names: string[]): Promise<ResolvedName[]>;
}

function parseResolved(raw: unknown): ResolvedName[] {
  if (!Array.isArray(raw)) return [];
  const out: ResolvedName[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof (item as ResolvedName).name === 'string' &&
      typeof (item as ResolvedName).canonical === 'string'
    ) {
      out.push({ name: (item as ResolvedName).name, canonical: (item as ResolvedName).canonical });
    }
  }
  return out;
}

export class GeminiNameResolver implements NameResolver {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new ResolveConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async resolve(names: string[]): Promise<ResolvedName[]> {
    if (names.length === 0) return [];
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(names) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    };
    const url = `${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`;

    let res: Response | null = null;
    for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
      const delay = BACKOFF_MS[attempt] ?? 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) break;
    }
    if (!res || !res.ok) {
      throw new Error(`Gemini name-resolve failed: ${res?.status ?? 'no response'}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') return [];
    return parseResolved(JSON.parse(text));
  }
}

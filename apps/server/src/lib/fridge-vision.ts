import { DEFAULT_OUTPUT_LOCALE, withOutputLanguage, type OutputLocale } from './output-locale.js';
import { thinkingConfigFragment } from './thinking-budget.js';
/**
 * Fridge photo — read the *names* of ingredients visible in a home fridge so
 * the pantry can be stocked and "作れるレシピ" can start from reality.
 * Provider abstraction (default Gemini Flash).
 *
 * 契約の正は `packages/shared/src/types/fridge.ts`（設計は `docs/冷蔵庫写真設計.md`）。
 *
 * **数量・分量は読ませない。** 写真から数量は読めず、推測した数字は在庫で合算されて
 * 「家に無いものが在庫にある」状態を静かに作る（レシートの quantity と同じ理由で、
 * こちらは最初から欄ごと無い）。読むのは品名と、その確からしさ（confidence 0〜1）だけ。
 * 画像はこのリクエストの中でしか使わない — 保存もログ出力もしない（/photo と同じ）。
 */

/** 1 回の読み取りに送れる写真の枚数（shared `MAX_FRIDGE_IMAGES` の写し）。 */
export const MAX_FRIDGE_IMAGES = 2;
/** 1 回の読み取りが返す品目数の上限（shared `MAX_FRIDGE_ITEMS` の写し）。 */
export const MAX_FRIDGE_ITEMS = 60;

export interface FridgeVisionInput {
  /** 出力言語。省略時は ja。 */
  outputLocale?: OutputLocale;
  images: { imageBase64: string; mimeType: string }[];
}

/** モデルの生出力の 1 品目。confidence は欠けたり範囲外だったりし得る。 */
export interface FridgeVisionItemRaw {
  name?: string;
  confidence?: number;
}

export interface FridgeVisionRaw {
  items?: FridgeVisionItemRaw[];
}

/** 検証済みの 1 品目（`sanitizeFridgeItems` の出力）。 */
export interface FridgeItem {
  name: string;
  confidence: number;
}

export interface FridgeVisionProvider {
  infer(input: FridgeVisionInput): Promise<FridgeVisionRaw>;
}

export class FridgeVisionConfigError extends Error {}
export class FridgeVisionRequestError extends Error {}

export const FRIDGE_SYSTEM_PROMPT = [
  'あなたは日本の家庭の冷蔵庫・野菜室・ドアポケットの写真から「そこにある食材・食品」を読み取る専門家です。',
  '写真に写っている食材・食品・飲料の**品名だけ**を items に列挙してください。',
  '品名は家庭の在庫管理に使える一般的な名前にします（例: 「明治おいしい牛乳」→「牛乳」）。ブランド名・容量・規格は省きます。',
  'パッケージや容器で中身が推定できるもの（卵パック・牛乳パック・調味料ボトルなど）は、その中身の一般名で挙げます。',
  // カテゴリ名の禁止（ペルソナ検証 2026-09-05 — 実写真 11 品中 3 品が「調味料」
  // 「飲料」等で、在庫としてもレシピマッチにも使えなかった。設計 §9）
  '「調味料」「飲料」「食品」「食材」「惣菜」のような**カテゴリ名は品目として返しません**。必ず具体的な品名で挙げます（例: ×調味料 → ○醤油・みりん / ×飲料 → ○麦茶・牛乳）。',
  'パッケージから中身を特定できないものは、無理にカテゴリでまとめず、confidence を下げたうえで判別できる範囲の一般名（例: ドレッシング・ジャム）までにとどめます。',
  '数量・分量・単位は**絶対に出力しません**。同じ食材が複数見えても 1 品目にまとめます。',
  '各品目に confidence（0〜1 の数値）を付けます。はっきり見えて確実なら 0.9 以上、パッケージ越しの推定や一部しか見えないものは 0.5〜0.8、不明瞭で推測に近いものは 0.5 未満にします。',
  '見えないものを想像で足さないでください。判別できないものは挙げないか、confidence を大きく下げてください。',
  '食材・食品以外（保存容器・調理器具・薬など）は挙げません。',
  '写真が冷蔵庫や食材のものでない場合、items は空にします。',
].join('\n');

export const FRIDGE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['name', 'confidence'],
      },
    },
  },
  required: ['items'],
} as const;

/** 品名の重複判定キー。全半角・カナ/かな・大小・空白の差を吸収する軽い正規化。 */
function nameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

/**
 * カテゴリ語のブラックリスト（ペルソナ検証 2026-09-05・設計 §9）。
 * 実写真の読み取りで「調味料」「飲料」がそのまま品目に混ざり、5 人全員が
 * 「在庫として役に立たない」と一致した。プロンプトで禁止したうえで、
 * すり抜けた場合の網としてここで **confidence を 0（要確認）に落とす** —
 * 捨てはしない。確認シートで人が具体名に直せる余地を残す。
 * **単体一致のみ**（`nameKey` の完全一致）。「調味料入れ」等の複合語は対象外。
 * BYOK 経路（モバイルの写し）と同じ語リスト。片方だけ直さないこと。
 */
const CATEGORY_NAME_WORDS = [
  '調味料',
  '飲料',
  '飲み物',
  '食品',
  '食材',
  '惣菜',
  '総菜',
  'その他',
  // 出力言語が英語のときの同種語
  'condiment',
  'condiments',
  'seasoning',
  'seasonings',
  'beverage',
  'beverages',
  'drink',
  'drinks',
  'food',
  'foods',
  'grocery',
  'groceries',
  'other',
  'others',
  'miscellaneous',
] as const;

const CATEGORY_NAME_KEYS = new Set(CATEGORY_NAME_WORDS.map(nameKey));

/**
 * モデルの生出力を検証する。**捨てる方向のみ・埋めない**:
 * - 品名が無い・空 → 捨てる（50 字に切り詰め）
 * - confidence が数値でない・範囲外 → 0〜1 に丸める（無ければ 0 = 最も要確認側。
 *   高く埋めると「確認しなくてよさそうに見える」誤りになる — 低く倒すのが安全側）
 * - カテゴリ語（`CATEGORY_NAME_WORDS` 単体一致）→ confidence 0（要確認へ落とす。捨てない）
 * - 同名（正規化一致）の重複 → confidence が高い方を残す
 * - `MAX_FRIDGE_ITEMS` を超えたぶん → 捨てる
 * BYOK 経路（モバイル側の写し）と同じ規則。片方だけ直さないこと。
 */
export function sanitizeFridgeItems(raw: FridgeVisionRaw | null | undefined): FridgeItem[] {
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const indexByKey = new Map<string, number>();
  const items: FridgeItem[] = [];

  for (const item of rawItems) {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 50) : '';
    if (!name) continue;
    const key = nameKey(name);
    // カテゴリ語は confidence 0（要確認・「たぶん」表示）に落とす。捨てない
    const confidence = CATEGORY_NAME_KEYS.has(key)
      ? 0
      : typeof item?.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : 0;
    const existingIndex = indexByKey.get(key);
    if (existingIndex != null) {
      const existing = items[existingIndex];
      if (confidence > existing.confidence) items[existingIndex] = { name, confidence };
      continue;
    }
    if (items.length >= MAX_FRIDGE_ITEMS) continue;
    indexByKey.set(key, items.length);
    items.push({ name, confidence });
  }

  return items;
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const BACKOFF_MS = [0, 1_500, 4_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiFridgeVisionProvider implements FridgeVisionProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    if (!apiKey) throw new FridgeVisionConfigError('GEMINI_API_KEY is not configured');
    this.apiKey = apiKey;
    this.model = opts?.model?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash';
  }

  async infer(input: FridgeVisionInput): Promise<FridgeVisionRaw> {
    const parts = [
      ...input.images.map((image) => ({
        inlineData: { mimeType: image.mimeType, data: image.imageBase64 },
      })),
      { text: 'この冷蔵庫の写真に写っている食材・食品の品名を読み取ってください。' },
    ];
    const body = {
      systemInstruction: {
        parts: [
          {
            text: withOutputLanguage(
              FRIDGE_SYSTEM_PROMPT,
              input.outputLocale ?? DEFAULT_OUTPUT_LOCALE,
            ),
          },
        ],
      },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: FRIDGE_RESPONSE_SCHEMA,
        // 構造化抽出で、深い推論を要さない（`thinking-budget.ts`・レシートと同じ）。
        ...thinkingConfigFragment(),
      },
    };

    const url = `${GEMINI_ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`;
    let lastError = '';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(BACKOFF_MS[attempt] ?? 8_000);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'request failed';
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        lastError = `Gemini responded ${res.status}: ${detail.slice(0, 200)}`;
        if (RETRYABLE_STATUS.has(res.status)) continue;
        throw new FridgeVisionRequestError(lastError);
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        lastError = 'empty model response';
        continue;
      }
      return JSON.parse(text) as FridgeVisionRaw;
    }

    throw new FridgeVisionRequestError(lastError || 'Gemini request failed');
  }
}

/**
 * 冷蔵庫写真の読み取り — 庫内の写真から**食材の品名だけ**を抽出する
 * （`docs/冷蔵庫写真設計.md`）。BYOK（自分の Gemini キー）が設定されていれば直接、
 * 無ければ managed サーバー（POST /infer/fridge）経由（`menu-recipes.provider.ts` と同じ形）。
 *
 * **数量・分量は読ませない。** 写真から数量は読めず、推測した数字は在庫で合算されて
 * 「家に無いものが在庫にある」状態を静かに作る。読むのは品名と confidence（0〜1）だけ。
 *
 * プロンプト・responseSchema・検証（`sanitizeFridgeItems`）はサーバー
 * `apps/server/src/lib/fridge-vision.ts` の写し。契約の正は
 * `packages/shared/src/types/fridge.ts`。**片方だけ直さないこと。**
 */
import {
  isCategoryName,
  MAX_FRIDGE_IMAGES,
  MAX_FRIDGE_ITEMS,
  type FridgeItem,
} from '@daidoko/shared';

import { API_V1, GEMINI_MODEL } from '../config';
import { t } from '../i18n';
import { serverErrorFor } from './ai-error';
import { requestLocale, withOutputLanguage } from './ai-output-locale';
import { getInstallationId } from './app-meta.service';
import { getUserApiKey } from './byok.service';
import { toInferImagePayload, type InferImagePayload } from './image-payload';
import { resolveQuotaSource } from './usage.service';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;

export type { FridgeItem };

/** MenuRecipesError と同形（retryable のみ。文言は throw 側で `t()` により焼き込む）。 */
export class FridgeInferError extends Error {
  /** t() 済みの文言を持つ印（ai-error.ts の readableErrorMessage が見る） */
  readonly userVisible = true;
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'FridgeInferError';
    this.retryable = retryable;
  }
}

export interface FridgeInference {
  /** 検証済みの品目（品名＋confidence。分量・数量の欄は無い）。 */
  items: FridgeItem[];
  /** 無料枠のカウント対象は managed サーバー経由（'cloud'）だけ。 */
  source: 'cloud' | 'byok';
}

// ─── プロンプト・responseSchema（サーバー側の写し。片方だけ直さないこと） ──────────

const SYSTEM_PROMPT = [
  'あなたは日本の家庭の冷蔵庫・野菜室・ドアポケットの写真から「そこにある食材・食品」を読み取る専門家です。',
  '写真に写っている食材・食品・飲料の**品名だけ**を items に列挙してください。',
  '品名は家庭の在庫管理に使える一般的な名前にします（例: 「明治おいしい牛乳」→「牛乳」）。ブランド名・容量・規格は省きます。',
  'パッケージや容器で中身が推定できるもの（卵パック・牛乳パック・調味料ボトルなど）は、その中身の一般名で挙げます。',
  // カテゴリ名の禁止（ペルソナ検証 2026-09-05・設計 §9。サーバーの写し）
  '「調味料」「飲料」「食品」「食材」「惣菜」のような**カテゴリ名は品目として返しません**。必ず具体的な品名で挙げます（例: ×調味料 → ○醤油・みりん / ×飲料 → ○麦茶・牛乳）。',
  'パッケージから中身を特定できないものは、無理にカテゴリでまとめず、confidence を下げたうえで判別できる範囲の一般名（例: ドレッシング・ジャム）までにとどめます。',
  '数量・分量・単位は**絶対に出力しません**。同じ食材が複数見えても 1 品目にまとめます。',
  '各品目に confidence（0〜1 の数値）を付けます。はっきり見えて確実なら 0.9 以上、パッケージ越しの推定や一部しか見えないものは 0.5〜0.8、不明瞭で推測に近いものは 0.5 未満にします。',
  '見えないものを想像で足さないでください。判別できないものは挙げないか、confidence を大きく下げてください。',
  '食材・食品以外（保存容器・調理器具・薬など）は挙げません。',
  '写真が冷蔵庫や食材のものでない場合、items は空にします。',
].join('\n');

const RESPONSE_SCHEMA = {
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
};

// ─── 検証（サーバー `sanitizeFridgeItems` の写し） ────────────────────────────

interface FridgeVisionItemRaw {
  name?: unknown;
  confidence?: unknown;
}

interface FridgeVisionRaw {
  items?: unknown;
}

/** 品名の重複判定キー（サーバーの写し。全半角・カナ/かな・大小・空白の差を吸収）。 */
function nameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

// カテゴリ語のブラックリストは shared `CATEGORY_NAME_WORDS` / `isCategoryName` が正
//（三重同期の解消・2026-09-05）。サーバー側の写しとの突合はサーバーの
// shared-parity.test.ts が担う。

/**
 * モデルの生出力を検証する。BYOK 経路はサーバーを通らないので必須で、managed 応答にも
 * **防御的に**通す（menu-recipes.provider の `validateMenuRecipeDrafts` と同じ役割分担）。
 * 規則は捨てる方向のみ・埋めない:
 * - 品名なし・空 → 捨てる（50 字に切り詰め）
 * - confidence が数値でない・範囲外 → 0〜1 に丸める（無ければ 0 = 要確認側へ倒す）
 * - 同名（正規化一致）→ confidence が高い方を残す
 * - `MAX_FRIDGE_ITEMS` を超えたぶん → 捨てる
 */
export function sanitizeFridgeItems(raw: FridgeVisionRaw | null | undefined): FridgeItem[] {
  const rawItems: FridgeVisionItemRaw[] = Array.isArray(raw?.items)
    ? (raw.items as FridgeVisionItemRaw[])
    : [];
  const indexByKey = new Map<string, number>();
  const items: FridgeItem[] = [];

  for (const item of rawItems) {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 50) : '';
    if (!name) continue;
    const key = nameKey(name);
    // カテゴリ語は confidence 0（要確認・「たぶん」表示）に落とす。捨てない
    const confidence = isCategoryName(name)
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

// ─── BYOK（自分のキーで直接） ────────────────────────────────────────────────

async function inferViaByok(images: InferImagePayload[], apiKey: string): Promise<FridgeItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: withOutputLanguage(SYSTEM_PROMPT) }] },
        contents: [
          {
            role: 'user',
            parts: [
              ...images.map((image) => ({
                inlineData: { mimeType: image.mimeType, data: image.imageBase64 },
              })),
              { text: 'この冷蔵庫の写真に写っている食材・食品の品名を読み取ってください。' },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });
    if (res.status === 429) throw new FridgeInferError(t('ai.error.byokQuota'), false);
    if (!res.ok) {
      const info = serverErrorFor(res.status);
      throw new FridgeInferError(info.message, info.retryable);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw new FridgeInferError(t('pantry.fridge.failed'), true);
    return sanitizeFridgeItems(JSON.parse(text) as FridgeVisionRaw);
  } catch (err) {
    if (err instanceof FridgeInferError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new FridgeInferError(t('ai.error.timeout'), true);
    }
    throw new FridgeInferError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

// ─── managed サーバー経由 ────────────────────────────────────────────────────

interface ServerResult {
  ok: boolean;
  data?: FridgeVisionRaw;
  error?: { code?: string; message?: string; retryable?: boolean };
}

async function inferViaServer(images: InferImagePayload[]): Promise<FridgeItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // x-device-id は必ず送る（付け忘れるとサーバーが即 ok:false を返す —
    // /infer/menu-recipes と同じ罠）。x-quota-source はトークン/プレミアム実行のときだけ
    const [deviceId, quotaSource] = await Promise.all([getInstallationId(), resolveQuotaSource()]);
    const res = await fetch(`${API_V1}/infer/fridge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        ...(quotaSource ? { 'x-quota-source': quotaSource } : {}),
      },
      body: JSON.stringify({ images, locale: requestLocale() }),
      signal: controller.signal,
    });
    // 保険: 前処理をすり抜けた巨大画像がサーバーの Zod 上限（8,000,000 字）や
    // ボディ上限に当たると 400/413 が返る。「サーバーエラー (400)」では利用者に
    // 何もできない（実機 AQUOS 6.5MB JPEG で実際に出た）。/infer/fridge 未デプロイの
    // 404 も含め、変換は共通マッパー（ai-error.ts）に任せ、呼び出し側は文言だけ出す
    // （在庫には触らない・[client-must-survive-server-skew]）
    if (!res.ok) {
      const info = serverErrorFor(res.status);
      throw new FridgeInferError(info.message, info.retryable);
    }
    const result = (await res.json()) as ServerResult;
    if (!result.ok || !result.data) {
      const quota =
        result.error?.code === 'FREE_QUOTA_EXCEEDED' ||
        result.error?.code === 'RATE_LIMITED' ||
        result.error?.code === 'AI_QUOTA_EXCEEDED';
      throw new FridgeInferError(
        quota ? t('error.quotaExceeded') : t('pantry.fridge.failed'),
        result.error?.retryable ?? true,
      );
    }
    // managed 応答にも防御的に検証を通す（BYOK 側と同じ関数で通す）
    return sanitizeFridgeItems(result.data);
  } catch (err) {
    if (err instanceof FridgeInferError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new FridgeInferError(t('ai.error.timeout'), true);
    }
    throw new FridgeInferError(t('error.offline'), true);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 冷蔵庫写真（1〜2 枚のローカルパス）から品目を読み取る。BYOK があれば自分のキーで
 * 直接、無ければサーバー経由。1 操作 = 1 呼び出し（枚数が増えても呼び出しは 1 回）。
 * 空の items は「読み取れなかった」— エラーにせず、文言と手入力への誘導は呼び出し側の責務。
 */
export async function inferFridgeItems(args: {
  images: { localPath: string; mimeType: string }[];
}): Promise<FridgeInference> {
  const bounded = args.images.slice(0, MAX_FRIDGE_IMAGES);
  // 送信前の縮小は共通ヘルパー（image-payload.ts）に一本化されている（規約①）
  const payloads: InferImagePayload[] = await Promise.all(bounded.map(toInferImagePayload));
  const userKey = await getUserApiKey();
  if (userKey) {
    return { items: await inferViaByok(payloads, userKey), source: 'byok' };
  }
  return { items: await inferViaServer(payloads), source: 'cloud' };
}

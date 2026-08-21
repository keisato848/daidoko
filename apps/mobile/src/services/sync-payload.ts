/**
 * 同期ペイロードの組み立てと解釈（S1 — `docs/クラウド同期設計.md` §5-1b）。
 *
 * ここは **I/O を持たない純関数だけ**。DB の読み書きは `sync-entities.service.ts`、
 * 送受信は `sync-client.service.ts` が担当する（この分割の理由は「jest が動的 import を
 * 実行できない」— DB を掴む経路はテストできないので、判断のいる部分をここへ寄せている）。
 *
 * 約束（設計 §5-1b）:
 * - サーバーは payload を**解釈しない**。ここで作った JSON 文字列をそのまま預けるだけ
 * - `schemaVersion` を必ず含める（将来アプリ側の列が増えたときの互換判定用）
 * - **写真パスは含めない。** 写真は S3 の領分で、パスは端末ローカルの値。
 *   受信適用でローカルの写真列を消さないための「含めない」でもある
 * - `familyId` / `createdBy` も含めない。全端末で `family-001` / `user-kei` 固定なので
 *   運ぶ意味が無く、運ぶと受信側の外部キーを壊しうる（適用側がローカルの値を入れる）
 * - **`pinnedAt`（作りたいリスト）も含めない。** 「今度これを作りたい」は人ごとの都合で、
 *   家族で 1 つに揃うものではない。加えて、ピンを同期に載せると **1 タップの
 *   ブックマークがレシピ丸ごとのスナップショットを勝たせる**（LWW の時計を進める）ため、
 *   オフライン端末のピン 1 回で他端末の編集が巻き戻る。端末ローカルのままにする
 */
import { z } from 'zod';

/** payload の版。列を増やしたら上げる（受信側は自分より新しい版を読み飛ばす） */
export const SYNC_PAYLOAD_SCHEMA_VERSION = 1;

export const SYNC_ENTITY_RECIPE = 'recipe';
export const SYNC_ENTITY_RECIPE_BOOK = 'recipe_book';

/** S1 の同期対象。S2 で買い物・在庫が増える */
export type SyncEntityType = typeof SYNC_ENTITY_RECIPE | typeof SYNC_ENTITY_RECIPE_BOOK;

export const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  SYNC_ENTITY_RECIPE,
  SYNC_ENTITY_RECIPE_BOOK,
];

export function isSyncEntityType(value: string): value is SyncEntityType {
  return (SYNC_ENTITY_TYPES as readonly string[]).includes(value);
}

// ── レシピ ───────────────────────────────────────────────────────────────────

export interface RecipeSyncPayload {
  schemaVersion: number;
  entity: typeof SYNC_ENTITY_RECIPE;
  recipe: {
    id: string;
    title: string;
    titleReading: string | null;
    /** 'active' | 'archived'。**削除は archived**（行は消さない — 下の tombstone の項参照） */
    status: string;
    placeName: string | null;
    createdAt: string;
    updatedAt: string;
  };
  /** 現在のリビジョン。まだ無いレシピ（理論上のみ）では null */
  revision: {
    id: string;
    revisionNumber: number;
    isMajor: boolean;
    servings: number | null;
    cookTimeMin: number | null;
    prepTimeMin: number | null;
    description: string | null;
    authorNote: string | null;
    createdAt: string;
  } | null;
  /**
   * 出所。**同期する理由は Web 共有の出所ゲート**（`web-share.service.ts` の
   * `getUrlImportedRecipeIds` は `sources.type = 'url'` で判定する）。これを落とすと、
   * 受信側では「URL 取り込みのレシピ」が普通のレシピに見えてしまい、他人のレシピを
   * 公開できてしまう。OCR の生テキスト（`ocrRawText`）は運ばない — 出所判定に要らず、
   * 端末内に留めておくべき生データなので。
   */
  source: {
    id: string;
    type: string;
    url: string | null;
    siteName: string | null;
    pageTitle: string | null;
    capturedAt: string | null;
    createdAt: string;
  } | null;
  ingredients: {
    id: string;
    sortOrder: number;
    groupLabel: string | null;
    name: string;
    amount: string | null;
    note: string | null;
  }[];
  /** `photoPath` は**入れない**（写真は S3） */
  steps: {
    id: string;
    sortOrder: number;
    body: string;
    timerSec: number | null;
  }[];
  /** タグは名前で運ぶ。ID は端末ごとに別なので受信側で名前から引き当てる */
  tags: string[];
}

export interface RecipeBookSyncPayload {
  schemaVersion: number;
  entity: typeof SYNC_ENTITY_RECIPE_BOOK;
  book: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  /** 収録レシピ ID（並び順そのまま）。**Web 共有トークン類は含めない**（設計 §5-1b） */
  recipeIds: string[];
}

export type SyncPayload = RecipeSyncPayload | RecipeBookSyncPayload;

// ── 受信 payload の検証 ──────────────────────────────────────────────────────
// 他端末が送ってきた文字列は信用しない。壊れていたら**その 1 件だけ捨てる**
// （例外を投げると同期全体が止まり、以後 1 件も届かなくなる）。

const nullableText = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const nullableNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? null);

const recipePayloadSchema = z.object({
  schemaVersion: z.number(),
  entity: z.literal(SYNC_ENTITY_RECIPE),
  recipe: z.object({
    id: z.string().min(1),
    title: z.string(),
    titleReading: nullableText,
    status: z.string().min(1),
    placeName: nullableText,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }),
  revision: z
    .object({
      id: z.string().min(1),
      revisionNumber: z.number(),
      isMajor: z.boolean(),
      servings: nullableNumber,
      cookTimeMin: nullableNumber,
      prepTimeMin: nullableNumber,
      description: nullableText,
      authorNote: nullableText,
      createdAt: z.string().min(1),
    })
    .nullish()
    .transform((v) => v ?? null),
  source: z
    .object({
      id: z.string().min(1),
      type: z.string().min(1),
      url: nullableText,
      siteName: nullableText,
      pageTitle: nullableText,
      capturedAt: nullableText,
      createdAt: z.string().min(1),
    })
    .nullish()
    .transform((v) => v ?? null),
  ingredients: z.array(
    z.object({
      id: z.string().min(1),
      sortOrder: z.number(),
      groupLabel: nullableText,
      name: z.string(),
      amount: nullableText,
      note: nullableText,
    }),
  ),
  steps: z.array(
    z.object({
      id: z.string().min(1),
      sortOrder: z.number(),
      body: z.string(),
      timerSec: nullableNumber,
    }),
  ),
  tags: z.array(z.string()),
});

const recipeBookPayloadSchema = z.object({
  schemaVersion: z.number(),
  entity: z.literal(SYNC_ENTITY_RECIPE_BOOK),
  book: z.object({
    id: z.string().min(1),
    title: z.string(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }),
  recipeIds: z.array(z.string().min(1)),
});

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 受信 payload の解釈。読めない・自分より新しい版なら null（＝その 1 件を捨てる）。
 *
 * 新しい版を捨てるのは、知らない列を落として書き戻すと**相手の変更を消してしまう**ため。
 * 捨てても `last_pull_seq` は進むので同期は止まらない（アプリを更新すれば次から入る）。
 */
export function parseSyncPayload(entityType: string, raw: string | null): SyncPayload | null {
  if (raw === null || raw === '') return null;
  const json = parseJson(raw);
  if (json === null || typeof json !== 'object') return null;
  const version = (json as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number' || version > SYNC_PAYLOAD_SCHEMA_VERSION) return null;

  if (entityType === SYNC_ENTITY_RECIPE) {
    const parsed = recipePayloadSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }
  if (entityType === SYNC_ENTITY_RECIPE_BOOK) {
    const parsed = recipeBookPayloadSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

export function serializeSyncPayload(payload: SyncPayload): string {
  return JSON.stringify(payload);
}

// ── LWW（受信側の勝敗判定） ─────────────────────────────────────────────────

/**
 * 受信した変更をローカルへ適用してよいか（設計 §4）。
 *
 * 基準は `updatedAt`（端末の時計）。**同値は受信側＝サーバー優先**にする
 * （自分が押した変更は `updatedByDevice` で先に弾いているので、ここに来る同値は
 * 「別の端末が同じ時刻に書いた」＝どちらでもよい場合。決定的に倒す方を選ぶ）。
 * 壊れた時刻はローカルを守る側に倒す（サーバー側 `lwwIncomingWins` と同じ構え）。
 */
export function incomingChangeWins(
  incomingUpdatedAt: string,
  localUpdatedAt: string | null,
): boolean {
  if (localUpdatedAt === null) return true; // ローカルに無い＝新着
  const incoming = Date.parse(incomingUpdatedAt);
  const local = Date.parse(localUpdatedAt);
  if (Number.isNaN(incoming)) return false;
  if (Number.isNaN(local)) return true;
  return incoming >= local;
}

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

import { parsePartEntityId } from './pantry-quantity';

/**
 * payload の版。列を増やしたら上げる（受信側は自分より新しい版を読み飛ばす）。
 *
 * **上げるとカーソルが 0 に戻り、全端末が一度だけ全量を取り直す**（`sync-runner`）。
 * 種別を増やしたときも上げること — 上げないと、古い版のまま動いている端末が
 * 新種別を読み飛ばしたのに**カーソルだけ進んで二度と拾えない**（設計 §5-2b）。
 *
 * v2: S2 で買い物・在庫・辞書の 5 種別を追加（レシピ・帖の形は変えていないので、
 * v1 の payload はそのまま読める）
 */
export const SYNC_PAYLOAD_SCHEMA_VERSION = 3; // v3: 在庫数量の持ち分（S2-B・§5-3）

/**
 * **省略可のフィールドを足すときはバージョンを上げないこと。**
 *
 * `parseSyncPayload` は `version > SYNC_PAYLOAD_SCHEMA_VERSION` の payload を**丸ごと捨てる**。
 * 1.11.0（v3）が既に公開されているので、v4 を送ると v3 の端末では
 * **その種別の変更が 1 件も届かなくなる**（recipeId が繋がらないどころではない）。
 * zod は非 strict なので、古い端末は知らないキーを黙って無視して残りを適用する。
 * バージョンを上げるのは「古い端末に解釈させては困る」破壊的変更のときだけ。
 */

export const SYNC_ENTITY_RECIPE = 'recipe';
export const SYNC_ENTITY_RECIPE_BOOK = 'recipe_book';
export const SYNC_ENTITY_SHOPPING_ITEM = 'shopping_item';
export const SYNC_ENTITY_PANTRY_ITEM = 'pantry_item';
export const SYNC_ENTITY_NAME_ALIAS = 'name_alias';
export const SYNC_ENTITY_JAN_CATALOG = 'jan_catalog';
export const SYNC_ENTITY_STORE_GROUP_ALIAS = 'store_group_alias';
/** 在庫数量の持ち分（S2-B・設計 §5-3）。entity_id = `<品目 id>:<端末 id>` */
export const SYNC_ENTITY_PANTRY_QUANTITY = 'pantry_quantity';

/** 同期対象の種別（S1: レシピ・帖 / S2: 買い物・在庫・辞書） */
export type SyncEntityType =
  | typeof SYNC_ENTITY_RECIPE
  | typeof SYNC_ENTITY_RECIPE_BOOK
  | typeof SYNC_ENTITY_SHOPPING_ITEM
  | typeof SYNC_ENTITY_PANTRY_ITEM
  | typeof SYNC_ENTITY_NAME_ALIAS
  | typeof SYNC_ENTITY_JAN_CATALOG
  | typeof SYNC_ENTITY_STORE_GROUP_ALIAS
  | typeof SYNC_ENTITY_PANTRY_QUANTITY;

export const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  SYNC_ENTITY_RECIPE,
  SYNC_ENTITY_RECIPE_BOOK,
  SYNC_ENTITY_SHOPPING_ITEM,
  SYNC_ENTITY_PANTRY_ITEM,
  SYNC_ENTITY_NAME_ALIAS,
  SYNC_ENTITY_JAN_CATALOG,
  SYNC_ENTITY_STORE_GROUP_ALIAS,
  SYNC_ENTITY_PANTRY_QUANTITY,
];

/**
 * 自然キー（内容で一意に決まる鍵）を持つ辞書系の種別。
 *
 * これらは `(family_id, …)` の UNIQUE 索引があるので、**受信を id で upsert すると
 * 一意制約で落ちる**（同じ「たまご→卵」を両端末が別 id で持っているのが普通）。
 * 適用は id ではなく**自然キーで引き当てて中身だけ更新**する（`sync-pantry-entities`）。
 */
export const NATURAL_KEY_ENTITY_TYPES: readonly SyncEntityType[] = [
  SYNC_ENTITY_NAME_ALIAS,
  SYNC_ENTITY_JAN_CATALOG,
  SYNC_ENTITY_STORE_GROUP_ALIAS,
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
  /**
   * **どのリビジョンかを問わず** URL 取り込み由来か。
   *
   * `source` は現在のリビジョンの出所しか運ばない。URL 取り込みの後に AI 調整などで
   * 別の出所のリビジョンが現在になると、受信側には URL の出所が一つも無く、
   * 出所ゲート（`getShareBlockReason` は全リビジョンを見る）をすり抜けて
   * **他人のレシピを Web 公開できてしまう**。送信側で全リビジョンを見て立てる。
   * 省略可（古い版の送信には無い＝ false 扱い）。
   */
  urlImported?: boolean;
  /**
   * 中身（材料・手順）を AI が推定したレシピか（#266）。**レシピ単位**で、
   * リビジョンの属性ではない — 編集しても落とさない印なので、版ごとに新しい行を作る
   * リビジョン側に置くと引き継ぎを書き忘れた瞬間に消える。
   *
   * 省略可（印を知らない古い版の送信には無い）。**受信側は `false` で上書きしないこと。**
   * 未指定は「AI ではない」ではなく「分からない」なので、既に立っている印を消す根拠にならない。
   * `SYNC_PAYLOAD_SCHEMA_VERSION` は**上げない**（省略可の追加なので破壊的変更ではない）。
   */
  aiGenerated?: boolean;
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

// ── 買い物・在庫・辞書（S2 — 設計 §5-2b）─────────────────────────────────────
//
// 共通の約束:
// - `familyId` は運ばない（全端末 `family-001` 固定 — S1 と同じ理由）
// - `createdBy` / `checkedBy` も運ばない（全端末 `user-kei` 固定で区別が付かない）
// - **`shared` も運ばない。** サーバーに行があること自体が「共有されている」を意味する。
//   1→0（共有をやめる）は tombstone として送る（設計 §5-2b）
// - **数量は行の一部として LWW で運ぶ（S2-A）。** デルタ化は S2-B

export interface ShoppingItemSyncPayload {
  schemaVersion: number;
  entity: typeof SYNC_ENTITY_SHOPPING_ITEM;
  item: {
    id: string;
    name: string;
    nameNormalized: string;
    amount: string | null;
    /** 0 = 未チェック / 1 = 買った */
    checked: number;
    source: string;
    /**
     * どのレシピから足したか（v4）。**受信側はこのレシピが手元にあるときだけ設定する** —
     * `PRAGMA foreign_keys = ON` なので、まだ届いていないレシピを指すと
     * **その品目が丸ごと入らない**（買い物リストから消える方が、レシピへ飛べないより悪い）。
     * v3 以前の送信元は付けてこないので省略可。
     */
    recipeId?: string | null;
    sortOrder: number;
    storeGroup: string | null;
    createdAt: string;
    checkedAt: string | null;
    updatedAt: string;
  };
}

export interface PantryItemSyncPayload {
  schemaVersion: number;
  entity: typeof SYNC_ENTITY_PANTRY_ITEM;
  item: {
    id: string;
    name: string;
    nameNormalized: string;
    /** 表示値（目視用）。v3 からは権威ではない — 権威は quantityBase/quantityEpoch ＋ 持ち分（§5-3） */
    quantity: number | null;
    unit: string | null;
    lowStockThreshold: number | null;
    janCode: string | null;
    groupName: string | null;
    expiresOn: string | null;
    createdAt: string;
    updatedAt: string;
    /** v3: ベースライン。送信側は必ず解決して書く。v2 の受信では未定義 */
    quantityBase?: number | null;
    quantityEpoch?: number;
  };
}

/** 在庫数量の持ち分（S2-B・§5-3）。`item.id` は封筒の entityId と同じ `<品目 id>:<端末 id>` */
export interface PantryQuantitySyncPayload {
  schemaVersion: number;
  entity: typeof SYNC_ENTITY_PANTRY_QUANTITY;
  item: {
    id: string;
    itemId: string;
    deviceId: string;
    net: number;
    epoch: number;
    updatedAt: string;
  };
}

export interface NameAliasSyncPayload {
  schemaVersion: number;
  entity: typeof SYNC_ENTITY_NAME_ALIAS;
  item: {
    id: string;
    sourceNormalized: string;
    canonical: string;
    updatedAt: string;
  };
}

export interface JanCatalogSyncPayload {
  schemaVersion: number;
  entity: typeof SYNC_ENTITY_JAN_CATALOG;
  item: {
    id: string;
    janCode: string;
    name: string;
    unit: string | null;
    updatedAt: string;
  };
}

export interface StoreGroupAliasSyncPayload {
  schemaVersion: number;
  entity: typeof SYNC_ENTITY_STORE_GROUP_ALIAS;
  item: {
    id: string;
    storeName: string;
    groupName: string;
    createdAt: string;
    updatedAt: string;
  };
}

export type SyncPayload =
  | RecipeSyncPayload
  | RecipeBookSyncPayload
  | ShoppingItemSyncPayload
  | PantryItemSyncPayload
  | NameAliasSyncPayload
  | JanCatalogSyncPayload
  | PantryQuantitySyncPayload
  | StoreGroupAliasSyncPayload;

/** 行を 1 つ運ぶだけの種別が共通で持つ形（適用側の分岐を薄くするため） */
export type RowSyncPayload =
  | ShoppingItemSyncPayload
  | PantryItemSyncPayload
  | NameAliasSyncPayload
  | JanCatalogSyncPayload
  | StoreGroupAliasSyncPayload
  | PantryQuantitySyncPayload;

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
  urlImported: z.boolean().optional(),
  aiGenerated: z.boolean().optional(),
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

const shoppingItemPayloadSchema = z.object({
  schemaVersion: z.number(),
  entity: z.literal(SYNC_ENTITY_SHOPPING_ITEM),
  item: z.object({
    id: z.string().min(1),
    name: z.string(),
    nameNormalized: z.string(),
    amount: nullableText,
    checked: z.number(),
    source: z.string(),
    /** v4。古い送信元は付けてこないので optional */
    recipeId: nullableText.optional(),
    sortOrder: z.number(),
    storeGroup: nullableText,
    createdAt: z.string().min(1),
    checkedAt: nullableText,
    updatedAt: z.string().min(1),
  }),
});

const pantryItemPayloadSchema = z.object({
  schemaVersion: z.number(),
  entity: z.literal(SYNC_ENTITY_PANTRY_ITEM),
  item: z.object({
    id: z.string().min(1),
    name: z.string(),
    nameNormalized: z.string(),
    quantity: nullableNumber,
    unit: nullableText,
    lowStockThreshold: nullableNumber,
    janCode: nullableText,
    groupName: nullableText,
    expiresOn: nullableText,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    quantityBase: nullableNumber.optional(),
    quantityEpoch: z.number().optional(),
  }),
});

const pantryQuantityPayloadSchema = z.object({
  schemaVersion: z.number(),
  entity: z.literal(SYNC_ENTITY_PANTRY_QUANTITY),
  item: z.object({
    id: z.string().min(3),
    itemId: z.string().min(1),
    deviceId: z.string().min(1),
    net: z.number(),
    epoch: z.number(),
    updatedAt: z.string().min(1),
  }),
});

const nameAliasPayloadSchema = z.object({
  schemaVersion: z.number(),
  entity: z.literal(SYNC_ENTITY_NAME_ALIAS),
  item: z.object({
    id: z.string().min(1),
    sourceNormalized: z.string().min(1),
    canonical: z.string().min(1),
    updatedAt: z.string().min(1),
  }),
});

const janCatalogPayloadSchema = z.object({
  schemaVersion: z.number(),
  entity: z.literal(SYNC_ENTITY_JAN_CATALOG),
  item: z.object({
    id: z.string().min(1),
    janCode: z.string().min(1),
    name: z.string(),
    unit: nullableText,
    updatedAt: z.string().min(1),
  }),
});

const storeGroupAliasPayloadSchema = z.object({
  schemaVersion: z.number(),
  entity: z.literal(SYNC_ENTITY_STORE_GROUP_ALIAS),
  item: z.object({
    id: z.string().min(1),
    storeName: z.string().min(1),
    groupName: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }),
});

/** entityType → zod スキーマ。増やすのはここだけで済むようにしておく */
const PAYLOAD_SCHEMAS = {
  [SYNC_ENTITY_RECIPE]: recipePayloadSchema,
  [SYNC_ENTITY_RECIPE_BOOK]: recipeBookPayloadSchema,
  [SYNC_ENTITY_SHOPPING_ITEM]: shoppingItemPayloadSchema,
  [SYNC_ENTITY_PANTRY_ITEM]: pantryItemPayloadSchema,
  [SYNC_ENTITY_NAME_ALIAS]: nameAliasPayloadSchema,
  [SYNC_ENTITY_JAN_CATALOG]: janCatalogPayloadSchema,
  [SYNC_ENTITY_STORE_GROUP_ALIAS]: storeGroupAliasPayloadSchema,
  [SYNC_ENTITY_PANTRY_QUANTITY]: pantryQuantityPayloadSchema,
} as const;

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

  const schema = (PAYLOAD_SCHEMAS as Record<string, z.ZodTypeAny | undefined>)[entityType];
  if (!schema) return null; // 知らない種別（古いアプリが新しい種別を受けたとき）
  const parsed = schema.safeParse(json);
  return parsed.success ? (parsed.data as SyncPayload) : null;
}

/** 行を 1 つ運ぶだけの種別か（適用側が共通処理へ振り分けるのに使う） */
export function isRowSyncPayload(payload: SyncPayload): payload is RowSyncPayload {
  return payload.entity !== SYNC_ENTITY_RECIPE && payload.entity !== SYNC_ENTITY_RECIPE_BOOK;
}

/** 自然キーで引き当てる辞書系か */
export function hasNaturalKey(entityType: string): boolean {
  return (NATURAL_KEY_ENTITY_TYPES as readonly string[]).includes(entityType);
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

// ── 多グループ（G-2a — 設計 §12-3・共有設計 §5-4）──────────────────────────
// entity_groups（ローカル DB）の読み書きは entity-groups.service.ts。ここには
// **判断だけ**を置く（DB を掴む経路は jest で叩けない — このファイル冒頭の分割方針）。

/** 所属解決の鍵（entity_groups の (entity_type, entity_id) に対応する） */
export interface EntityGroupKey {
  entityType: string;
  entityId: string;
}

/**
 * この実体の所属を引くための鍵。
 *
 * **在庫数量の持ち分（pantry_quantity）は自分では所属を持たず、親品目に従う。**
 * 持ち分は品目の数量の一部でしかなく、別々のグループに入れられる形にすると
 * 「品目はグループ A・数量はグループ B」という意味の無い状態を作れてしまう。
 */
export function entityGroupKeyOf(entityType: string, entityId: string): EntityGroupKey {
  if (entityType === SYNC_ENTITY_PANTRY_QUANTITY) {
    const parsed = parsePartEntityId(entityId);
    if (parsed) return { entityType: SYNC_ENTITY_PANTRY_ITEM, entityId: parsed.itemId };
  }
  return { entityType, entityId };
}

/** Map の鍵（entityType/entityId の組を 1 文字列に。区切りは id に現れない NUL） */
export function entityGroupMapKey(key: EntityGroupKey): string {
  return `${key.entityType}\u0000${key.entityId}`;
}

/**
 * 所属の無い実体に「現在のグループ」を既定所属として付けてよいか（G2）。
 *
 * - 既に所属がある → 付けない（既定は初回だけ。以後の所属変更は利用者の操作）
 * - 行が無い（＝削除済みの tombstone）→ 付けない。過去に共有していれば所属が
 *   残っていてそこへ届くし、一度も共有していなければ**削除の事実ごと外に出さない**
 * - `shared = 0`（自分だけ）→ 付けない（G9: どのグループにも入れない）。
 *   `null` は共有扱い（`sync-row-entities.service.ts` の `isShared` と同じ読み方）
 */
export function shouldAssignDefaultGroup(input: {
  hasMemberships: boolean;
  rowExists: boolean;
  shared: number | null;
}): boolean {
  if (input.hasMemberships) return false;
  if (!input.rowExists) return false;
  return input.shared !== 0;
}

/** push のファンアウト計画。indices は入力 `entities` の添字 */
export interface PushFanoutPlan {
  /** グループごとの送信対象。**主グループが先頭**、以降は groupId 昇順（決定的） */
  groups: { groupId: string; indices: number[] }[];
  /**
   * どのグループにも属さない実体（G9: 自分だけ）。**送らずに送信待ちから消してよい。**
   * 移行（§12-4）で既存実体には必ず所属が付くので、所属ゼロは「送らない」と確定できる
   */
  selfOnlyIndices: number[];
}

/**
 * 送信 1 バッチをグループ別に分配する（G3: 所属グループぶんファンアウト）。
 *
 * `memberships` の鍵は `entityGroupMapKey(entityGroupKeyOf(...))`。呼び出し側
 * （entity-groups.service）が **参加中のグループとの交わりを取った後**の所属を渡す
 * （他人のバックアップ復元などで残った、参加していないグループへは送らない —
 * 送ると 401 で同期全体が止まる）。
 */
export function planPushFanout(
  entities: readonly EntityGroupKey[],
  memberships: ReadonlyMap<string, readonly string[]>,
  primaryGroupId: string,
): PushFanoutPlan {
  const byGroup = new Map<string, number[]>();
  const selfOnlyIndices: number[] = [];
  entities.forEach((entity, index) => {
    const key = entityGroupMapKey(entityGroupKeyOf(entity.entityType, entity.entityId));
    const groups = memberships.get(key) ?? [];
    if (groups.length === 0) {
      selfOnlyIndices.push(index);
      return;
    }
    for (const groupId of new Set(groups)) {
      const list = byGroup.get(groupId);
      if (list) list.push(index);
      else byGroup.set(groupId, [index]);
    }
  });
  const order = [...byGroup.keys()].sort((a, b) => {
    if (a === primaryGroupId) return -1;
    if (b === primaryGroupId) return 1;
    return a < b ? -1 : 1;
  });
  return {
    groups: order.map((groupId) => ({ groupId, indices: byGroup.get(groupId) ?? [] })),
    selfOnlyIndices,
  };
}

/** 同期カーソルを保存する app_meta の鍵（従来からの単一グループ用） */
export const SYNC_CURSOR_META_KEY = 'sync_cursor';

/**
 * グループごとのカーソル保存鍵。
 *
 * **主グループは従来の鍵のまま**にする — これが §12-4「既存キーは主グループの
 * カーソルとして読み替える」の実体で、データ移行そのものが要らない
 * （1.13.0 以前が書いた `sync_cursor` を 1.13.1 がそのまま主グループとして読む）。
 */
export function syncCursorStorageKey(groupId: string, primaryGroupId: string): string {
  return groupId === primaryGroupId ? SYNC_CURSOR_META_KEY : `${SYNC_CURSOR_META_KEY}:${groupId}`;
}

/**
 * 「現在のグループ」（G2 の既定所属先）の解決。
 * 未設定・参加していないグループを指している（他人のバックアップ復元・離脱後の残骸）
 * ときは**主グループへ倒す** — 現行の単一グループ挙動そのもの。
 */
export function resolveCurrentGroupId(
  stored: string | null,
  primaryGroupId: string,
  knownGroupIds: readonly string[],
): string {
  return stored && knownGroupIds.includes(stored) ? stored : primaryGroupId;
}

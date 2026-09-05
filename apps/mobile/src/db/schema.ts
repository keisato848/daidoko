/**
 * SQLite schema for だいどこ mobile app
 * Drizzle ORM (expo-sqlite) definitions
 *
 * Entities: User, Family, FamilyMember, Recipe, RecipeRevision, Ingredient, Step,
 *           Tag, RecipeTag, Source, CookingLog, CookingPhoto, Memo, SyncMeta, AppMeta
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ─── User ──────────────────────���────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── Family ──────────────────────��──────────────────────────────────────────
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── FamilyMember ──────────────────────────────────────────────────────────
export const familyMembers = sqliteTable(
  'family_members',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('member'), // 'owner' | 'member'
    joinedAt: text('joined_at').notNull(),
  },
  (table) => ({
    familyUserIdx: uniqueIndex('idx_family_members_family_user').on(table.familyId, table.userId),
    familyIdx: index('idx_family_members_family').on(table.familyId),
  }),
);

// ─── Source ──────────────────────────────────────���──────────────────────────
export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'url' | 'ocr' | 'manual' | 'photo'
  url: text('url'),
  ocrRawText: text('ocr_raw_text'),
  siteName: text('site_name'),
  pageTitle: text('page_title'),
  thumbnailUrl: text('thumbnail_url'),
  capturedAt: text('captured_at'),
  createdAt: text('created_at').notNull(),
});

// ─── Recipe ────────────────���──────────────────────────────────────���─────────
export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    title: text('title').notNull(),
    titleReading: text('title_reading'),
    currentRevId: text('current_rev_id'),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    coverPhotoPath: text('cover_photo_path'), // 表紙写真（端末内パス, v7）
    pinnedAt: text('pinned_at'), // 作りたいリスト（ピン留め日時, v8）— null = 未ピン
    /**
     * お店の名前（v12・任意）。「あの店のあの料理」を再現する単位はレシピ 1 件なので、
     * 店名はレシピが持つ。**表示は常にここを見る。**
     * 記録（`cooking_logs.place_name`）にも列があるが、あちらは初回に入力されたときだけ
     * 埋まる履歴で、**後から店名を入れても過去の記録は変わらない** — 表示に使うと
     * 「後から入力したのに出てこない」が起きる。
     */
    placeName: text('place_name'),
    /**
     * 中身を AI が推定したレシピ（v17）。`1` = AI 由来 / `NULL` = 不明。
     *
     * **レシピ単位で持ち、一度立てたら消さない。** リビジョン側に置かないのは、
     * 分量を 1 つ直しただけで「人が作ったレシピ」に化けると、安全表示として逆方向だから。
     * リビジョンは編集のたびに新しい行を作るので、あちらに置くと引き継ぎを書き忘れた
     * 瞬間に印が落ちる。
     *
     * **`NULL` は「AI ではない」ではなく「不明」。** v17 より前に作られたレシピのうち、
     * 写真・紙面 OCR 由来のものは移行時に遡って `1` を立てるが（`sources` に記録が残る）、
     * **`sources` 行を作らない経路は遡れない**（相談・貼り付けテキスト・手入力・refine）。
     * したがって **`NULL` を根拠に「人が書きました」と断言する表示は作らないこと。**
     * 出してよいのは `1` のときの注意書きだけ。
     */
    aiGenerated: integer('ai_generated'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyStatusIdx: index('idx_recipes_family_status').on(table.familyId, table.status),
    familyUpdatedIdx: index('idx_recipes_family_updated').on(table.familyId, table.updatedAt),
  }),
);

// ─── RecipeRevision ��────────────────────────────────────────────────────────
export const recipeRevisions = sqliteTable(
  'recipe_revisions',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    revisionNumber: integer('revision_number').notNull(),
    isMajor: integer('is_major', { mode: 'boolean' }).notNull().default(true),
    servings: integer('servings'),
    cookTimeMin: integer('cook_time_min'),
    prepTimeMin: integer('prep_time_min'),
    description: text('description'),
    authorNote: text('author_note'),
    sourceId: text('source_id').references(() => sources.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    recipeNumIdx: index('idx_revisions_recipe_num').on(table.recipeId, table.revisionNumber),
  }),
);

// ─── Ingredient ────────��────────────────────────────────────────────────────
export const ingredients = sqliteTable(
  'ingredients',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => recipeRevisions.id),
    sortOrder: integer('sort_order').notNull(),
    groupLabel: text('group_label'),
    name: text('name').notNull(),
    amount: text('amount'),
    note: text('note'),
  },
  (table) => ({
    revisionIdx: index('idx_ingredients_revision').on(table.revisionId),
  }),
);

// ─── Step ─────────────────���─────────────────────────────────���───────────────
export const steps = sqliteTable(
  'steps',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => recipeRevisions.id),
    sortOrder: integer('sort_order').notNull(),
    body: text('body').notNull(),
    timerSec: integer('timer_sec'),
    photoId: text('photo_id'), // 将来のクラウド写真エンティティ用（未使用）
    photoPath: text('photo_path'), // 手順写真（端末内パス, v7）
  },
  (table) => ({
    revisionIdx: index('idx_steps_revision').on(table.revisionId),
  }),
);

// ─── Tag ──────────────────��────────────────────────────��────────────────────
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    color: text('color'),
  },
  (table) => ({
    familyNameIdx: uniqueIndex('idx_tags_family_name').on(table.familyId, table.name),
  }),
);

// ─── RecipeTag (join table) ──────────���──────────────────────────────────────
export const recipeTags = sqliteTable(
  'recipe_tags',
  {
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => ({
    recipeIdx: index('idx_recipe_tags_recipe').on(table.recipeId),
    tagIdx: index('idx_recipe_tags_tag').on(table.tagId),
  }),
);

// ─── CookingLog ───────────────────────────────────────────────��─────────────
export const cookingLogs = sqliteTable(
  'cooking_logs',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    recipeId: text('recipe_id').references(() => recipes.id),
    revisionId: text('revision_id').references(() => recipeRevisions.id),
    cookedBy: text('cooked_by')
      .notNull()
      .references(() => users.id),
    cookedAt: text('cooked_at').notNull(),
    servings: integer('servings'),
    rating: integer('rating'),
    memo: text('memo'),
    createdAt: text('created_at').notNull(),
    /**
     * 体験の種類（v9）。'cooked' = 家で作った（既定）/ 'eaten_out' = 店で食べた。
     * 「食べた」も「作った」もその料理を体験した記録なので、テーブルは分けず列で区別する
     * （`docs/お店の味を再現設計.md` §3）。
     */
    kind: text('kind').notNull().default('cooked'),
    /**
     * 店名（kind='eaten_out' のとき。任意）。
     * **表示には使わない** — 表示は `recipes.place_name` を正とする（v12）。
     * ここは「その日どこで食べたか」の事実として残す。
     */
    placeName: text('place_name'),
  },
  (table) => ({
    familyDateIdx: index('idx_cooking_logs_family_date').on(table.familyId, table.cookedAt),
    recipeDateIdx: index('idx_cooking_logs_recipe_date').on(table.recipeId, table.cookedAt),
  }),
);

/** 調理記録の種類。'eaten_out' は店で食べた記録で、調理はしていない。 */
export type CookingLogKind = 'cooked' | 'eaten_out';

// ─── CookingPhoto ─────────��──────────────────────────────────��──────────────
export const cookingPhotos = sqliteTable(
  'cooking_photos',
  {
    id: text('id').primaryKey(),
    logId: text('log_id')
      .notNull()
      .references(() => cookingLogs.id),
    localPath: text('local_path').notNull(),
    cloudUrl: text('cloud_url'),
    sortOrder: integer('sort_order').notNull(),
    takenAt: text('taken_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    logIdx: index('idx_cooking_photos_log').on(table.logId),
  }),
);

// ─── Memo ───────────────���───────────────────────────────────────────────────
export const memos = sqliteTable(
  'memos',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    recipeIdx: index('idx_memos_recipe').on(table.recipeId),
  }),
);

// ─── SyncMeta ──────────────────��─────────────────────────────────���──────────
export const syncMeta = sqliteTable('sync_meta', {
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  vectorClock: text('vector_clock').notNull(), // JSON string
  deletedAt: text('deleted_at'),
  lastSyncedAt: text('last_synced_at'),
});

// ─── SyncQueue（クラウド同期の送信待ち, v14 — docs/クラウド同期設計.md §5-1b）──
/**
 * 「この行が変わった」という**印だけ**を積むキュー。payload は持たない。
 *
 * 送信時に最新の DB から payload を作り直すので、連続編集は自然に 1 回の送信へ合流する
 * （3 回直したら 3 通送る、にならない）。主キーを (entity_type, entity_id) にしてあるのは
 * その合流をテーブル側で保証するため — キューの行数はエンティティ数を超えない。
 *
 * **バックアップには含めない**（`backup.service.ts` の BACKUP_TABLES に入れない）。
 * 他人のバックアップを復元した端末が、その人の送信待ちを自分のグループへ流してしまう。
 */
export const syncQueue = sqliteTable(
  'sync_queue',
  {
    /** 'recipe' | 'recipe_book'（S2 で買い物・在庫が増える） */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    queuedAt: text('queued_at').notNull(),
    /** 送信に失敗した回数。増えても捨てはしない（次の起動で再挑戦する） */
    retryCount: integer('retry_count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.entityType, table.entityId] }),
    queuedIdx: index('idx_sync_queue_queued').on(table.queuedAt),
  }),
);

// ─── AppMeta ────────────────────────────────────────────────────────────────
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ─── FTS5 Virtual Table ────���────────────────────────────────────────────────
// Note: Drizzle ORM does not natively support FTS5. We define it via raw SQL
// in migrations/setup. This constant holds the CREATE statement for reference.
export const RECIPE_FTS_CREATE_SQL = sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS recipe_fts USING fts5(
    recipe_id UNINDEXED,
    title,
    title_reading,
    ingredient_names,
    tokenize='unicode61'
  )
`;

// ─── Nutrition (future, defined for completeness) ──────────────���────────────
export const ingredientNutrition = sqliteTable('ingredient_nutrition', {
  id: text('id').primaryKey(),
  ingredientId: text('ingredient_id')
    .notNull()
    .references(() => ingredients.id)
    .unique(),
  caloriesKcal: real('calories_kcal'),
  proteinG: real('protein_g'),
  fatG: real('fat_g'),
  carbsG: real('carbs_g'),
  saltG: real('salt_g'),
  dataSource: text('data_source').notNull().default('manual'), // 'manual' | 'api' | 'estimated'
  updatedAt: text('updated_at').notNull(),
});

// ─── ShoppingItem（買い物リスト, P1）────────────────────────────────────────
// 集約買い物リスト。家族グループ単位。名前正規化キーで突合（docs/買い物リスト・在庫設計.md）。
export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    amount: text('amount'),
    checked: integer('checked').notNull().default(0),
    source: text('source').notNull().default('manual'), // 'manual' | 'recipe' | 'low_stock' | 'receipt'
    recipeId: text('recipe_id').references(() => recipes.id),
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * 買う場所のグループ（v13・任意）。例: スーパー / ドラッグストア。
     *
     * 在庫のグループ（**どこにしまうか**）とは**軸が別**。「スーパーで買って冷蔵庫にしまう」は
     * 普通なので、片方から他方は決まらない。店内で「今いる店の分だけ見たい」ための絞り込みで、
     * **照合には使わない**（同じ品を別の店で買うことがあるため — レシート消し込みは品目名だけで判定）。
     */
    storeGroup: text('store_group'),
    /** 入れた人（v13）。同期すると「これ誰が要るって言ったの？」が起きるので記録する */
    createdBy: text('created_by').references(() => users.id),
    /** チェックした（買った）人（v13）。`checked_at` と対で「いつ・誰が」になる */
    checkedBy: text('checked_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
    checkedAt: text('checked_at'),
    /**
     * 最終更新（v15）。**同期の LWW の基準**（`docs/クラウド同期設計.md` §5-2b）。
     *
     * `checked_at` は代用できない — チェックを外すと null に戻り、時計が巻き戻るため。
     * **nullable にしてある**: `NOT NULL` にすると、この列を持たない古いバックアップの
     * 復元が丸ごと失敗する（`replaceDatabase` が明示的に NULL を渡すので DEFAULT が効かない）。
     * null のときは `checked_at ?? created_at` を代用する。
     */
    updatedAt: text('updated_at'),
    /**
     * 家族と共有するか（v15・0 = 自分だけ / 1 = 家族と共有 / **null = 共有**）。
     *
     * null を「共有」と読むのは、列を持たない古いデータ・古いバックアップが
     * 現行どおり（全部共有）に見えるようにするため（設計 §5-2b の「守る約束」2・3）。
     */
    shared: integer('shared'),
  },
  (table) => ({
    familyCheckedIdx: index('idx_shopping_items_family_checked').on(table.familyId, table.checked),
  }),
);

// ─── PantryItem（在庫, P2）──────────────────────────────────────────────────
// 家の在庫。数量×単位は厳密管理（同一商品は合算）。包装品は jan_code で識別（P2b）。
export const pantryItems = sqliteTable(
  'pantry_items',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    lowStockThreshold: real('low_stock_threshold'),
    janCode: text('jan_code'),
    /**
     * 置き場所・用途のグループ（v13・任意）。例: 冷蔵庫 / 〇〇の米 / 災害用備蓄。
     *
     * **合算の鍵に入る。** 同じ米が「パントリー」と「〇〇の米」に別々にあるのは正常なので、
     * 鍵に含めないと勝手に 1 行へまとめられてしまう（`addPantryItem` の同一判定を参照）。
     * null（未設定）は**それ自体がひとつのバケツ**として扱う。
     */
    groupName: text('group_name'),
    /**
     * 賞味期限（v13・任意・YYYY-MM-DD）。**メインの機能ではない**ので入力は強制せず、
     * push 通知でも追い立てない（2026-07-07 に「入力が続かない・通知疲れ」で一度取り下げ、
     * 2026-08-19 に「記録できるようにしてよい」と再開した経緯）。
     *
     * 在庫は同じ品目を 1 行に合算するので、**期限は行に 1 つだけ**持ち、合算時は
     * **近い方（早い日付）を残す**。買った回ごとに行を分ける（ロット）案は、合算をやめる
     * 代償（一覧が「牛乳 1本」「牛乳 1本」と並ぶ・充足判定の取り直し）が大きすぎるため採らない。
     */
    expiresOn: text('expires_on'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /**
     * 家族と共有するか（v15・0 = 自分だけ / 1 = 家族と共有 / **null = 共有**）。
     * null の扱いと nullable にした理由は `shopping_items.shared` と同じ。
     */
    shared: integer('shared'),
    /**
     * 数量のベースライン（v16・S2-B・設計 §5-3）。`quantity` は
     * `max(0, quantity_base + Σ pantry_quantity_parts.net)` から**導出**する表示値。
     * `quantity_epoch` が NULL の行は v16 未移行（`quantity` をそのまま base と読む）。
     */
    quantityBase: real('quantity_base'),
    quantityEpoch: integer('quantity_epoch'),
  },
  (table) => ({
    familyNameIdx: index('idx_pantry_items_family_name').on(table.familyId, table.nameNormalized),
  }),
);

/**
 * 在庫数量の持ち分（v16・S2-B・設計 §5-3）。`(品目, 端末)` ごとの累計増減。
 * 書き手は 1 台だけなので LWW が競合せず、状態なので再適用が冪等。
 * 外部キーは持たない — 行が part より**後の seq** で届くことがある。
 * バックアップに**入れる**（`quantity` と対になる中身そのもの。§5-3-1）。
 */
export const pantryQuantityParts = sqliteTable(
  'pantry_quantity_parts',
  {
    itemId: text('item_id').notNull(),
    deviceId: text('device_id').notNull(),
    /** NULL = 0 */
    net: real('net'),
    /** どの世代（`pantry_items.quantity_epoch`）の持ち分か。NULL = 0 */
    epoch: integer('epoch'),
    /** part の LWW 基準（端末内で単調） */
    updatedAt: text('updated_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.itemId, table.deviceId] }),
    itemIdx: index('idx_pantry_quantity_parts_item').on(table.itemId),
  }),
);

// ─── JanCatalog（JAN→商品名の記憶, P2b）─────────────────────────────────────
// バーコード(JAN)→名前/単位 のローカル辞書。初回入力で記憶し、次回スキャンで自動補完。
export const janCatalog = sqliteTable(
  'jan_catalog',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    janCode: text('jan_code').notNull(),
    name: text('name').notNull(),
    unit: text('unit'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyJanIdx: uniqueIndex('idx_jan_catalog_family_jan').on(table.familyId, table.janCode),
  }),
);

// ─── NameAlias（AI名寄せキャッシュ, name-matching）─────────────────────────────
// 正規化名 → 正規食材名（canonical）のキャッシュ。AI で一度解決して記憶し、以降の
// 在庫⇄レシピ突合に使う。辞書はソースに持たず、ここ（データ）に蓄積する。
export const nameAliases = sqliteTable(
  'name_aliases',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    sourceNormalized: text('source_normalized').notNull(),
    canonical: text('canonical').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familySourceIdx: uniqueIndex('idx_name_aliases_family_source').on(
      table.familyId,
      table.sourceNormalized,
    ),
  }),
);

// ─── RecipeBook（レシピ帖, S4 — docs/Web共有設計.md §7）───────────────────────
// 帖はローカルの実体。共有は任意の後続で、share_* が NULL なら未共有。
// share_delete_token は取り消し＋更新（PATCH）の鍵 — 端末外に出さない。
/**
 * 店名 → 買い物グループ の対応表（v13）。
 *
 * レシートは店名を読めるのに使っていなかった。ここに覚えておくと、次に同じ品を
 * 買い物リストへ入れたとき店を既定で埋められる。**毎回選ばせる形だと続かない**ので、
 * 初めての店名のときだけ確認して覚える。対応は名寄せ辞書と同じく後から直せる。
 *
 * 照合は**レシートの生の店名で完全一致**。「マックスバリュ松山店」と「マックスバリュ空港店」は
 * 別エントリになるが、どちらも同じグループ（例: スーパー）に向ければ利用者の目的には足りる。
 */
export const storeGroupAliases = sqliteTable(
  'store_group_aliases',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id),
    /** レシートから読んだ店名（生の文字列） */
    storeName: text('store_name').notNull(),
    /** 対応させる買い物グループ名（`shopping_items.store_group` と同じ値） */
    groupName: text('group_name').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    familyStoreIdx: uniqueIndex('idx_store_group_aliases_family_store').on(
      table.familyId,
      table.storeName,
    ),
  }),
);

export const recipeBooks = sqliteTable('recipe_books', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  shareSlug: text('share_slug'),
  shareUrl: text('share_url'),
  shareDeleteToken: text('share_delete_token'),
  sharedAt: text('shared_at'),
  shareLocale: text('share_locale'),
  /** 公開の強度（S4-2）。パスコードは更新時に再送するため平文で持つ（端末内のみ） */
  sharePasscode: text('share_passcode'),
  shareExpiresAt: text('share_expires_at'),
  /** S2（app_meta 時代）に公開した帖 — 収録レシピ不明。停止のみ可 */
  isLegacyShare: integer('is_legacy_share').notNull().default(0),
});

export const recipeBookItems = sqliteTable(
  'recipe_book_items',
  {
    bookId: text('book_id')
      .notNull()
      .references(() => recipeBooks.id),
    recipeId: text('recipe_id').notNull(),
    position: integer('position').notNull(),
  },
  (table) => ({
    bookRecipeIdx: uniqueIndex('idx_recipe_book_items_book_recipe').on(
      table.bookId,
      table.recipeId,
    ),
  }),
);

// ─── MenuPlan（献立, v19 — docs/買い物リスト・在庫設計.md §10.6）────────────
/**
 * 献立プラン（v19）。**時間帯（朝/昼/夕）ごとに 1 本**で、`meal_time` が UNIQUE。
 *
 * v18 までは `app_meta` の `menu_plan` キーに JSON 1 本だった（§10.6 旧設計）。
 * 時間帯の共存（夕を保ったまま休日昼を組む）と、次版の 1 日複数品（主菜＋副菜の
 * 行分割）はどちらも「1 キー 1 JSON」では成立しないため、テーブルへ移した
 * （オーナー決定・2026-09-05）。旧 JSON は**読み側でレイジーに取り込む**
 * （`menu-plan.service.ts` — 旧バックアップの復元後も同じ経路で移行される）。
 *
 * 献立は**ローカル専用**（同期対象外）。バックアップには入れる（`backup.service.ts`）。
 */
export const menuPlans = sqliteTable('menu_plans', {
  id: text('id').primaryKey(),
  /** 'breakfast' | 'lunch' | 'dinner'。UNIQUE — 1 時間帯 1 プラン（1.13.1 の固定仕様） */
  mealTime: text('meal_time').notNull().default('dinner').unique(),
  generatedAt: text('generated_at').notNull(),
  /** 'coverage'（M1 の決定的な並び）| 'ai'（M2）。どちらの経路で出たかを残す（§10.6） */
  source: text('source').notNull().default('coverage'),
  pantrySignature: text('pantry_signature').notNull(),
  /** 自動モード（§10.11・夕のみ）の起点日 `YYYY-MM-DD`。null = 手動プラン */
  anchorDate: text('anchor_date'),
  /** 「組む」で要求した日数（§10.7-a）。null = 旧データ（不足の表示を出さない） */
  requestedDays: integer('requested_days'),
  /** M2 の AI が返した献立全体への一言。null = 無し */
  aiNote: text('ai_note'),
  /** 直近の自動追加バッチの `shopping_items.id` の JSON 配列文字列（§10.11.2）。null = 無し */
  autoAddedItemIds: text('auto_added_item_ids'),
});

/**
 * 献立の 1 日分（v19）。プラン置換時に親と一緒に消す（サービス層が days → plan の順で消す）。
 *
 * `recipe_id` は**弱参照**（REFERENCES を張らない）。レシピが削除・アーカイブされても
 * 日は残り、`title` の写しで「このレシピは無くなりました」を出す（§10.6 の挙動を維持）。
 * FK を張って CASCADE にすると、レシピ削除で献立の日が黙って消える。
 */
export const menuPlanDays = sqliteTable(
  'menu_plan_days',
  {
    planId: text('plan_id')
      .notNull()
      .references(() => menuPlans.id),
    /** 1 始まりの日番号 */
    day: integer('day').notNull(),
    /** 弱参照（意図的に .references() しない — 上のコメント） */
    recipeId: text('recipe_id').notNull(),
    /** 表示用の写し。レシピが消えたときに「無くなりました」を出せる */
    title: text('title').notNull(),
    reason: text('reason').notNull().default(''),
    /** 作り終わった日（調理記録から埋める）。null = まだ */
    doneAt: text('done_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.planId, table.day] }),
  }),
);

// ─── EntityGroups（多グループの所属, v18 — docs/クラウド同期設計.md §12-3）────
/**
 * 「この実体はどの同期グループに属するか」。ローカル行は 1 つのまま、
 * **所属だけを多重化**する（1 実体・複数グループ参照 — 共有設計 §5-4 G3）。
 *
 * - 行が無い ＝ どのグループにも送らない（「自分だけ」— G9。`shared = 0` の写像先）
 * - `pantry_quantity`（持ち分）は行を持たず、**親品目の所属に従う**
 *   （`sync-payload.ts` の `entityGroupKeyOf`）
 * - **バックアップには含めない**（`sync_queue` と同じ扱い）。所属は再構築できる —
 *   復元時は `onLocalDataReplaced` が白紙にし、バックフィル（→主グループ）と
 *   カーソル 0 からの pull（→受信元グループ）で付き直る。逆に他人のバックアップの
 *   所属を持ち込むと、参加していないグループ宛ての所属が残って push が「自分だけ」に
 *   誤読される（G-2b で所属が利用者の見える状態になったら方針を見直す）
 */
export const entityGroups = sqliteTable(
  'entity_groups',
  {
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    groupId: text('group_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.entityType, table.entityId, table.groupId] }),
  }),
);

/**
 * Service layer shared types
 * Used across all services for consistent data contracts
 */

export interface RecipeListItem {
  id: string;
  title: string;
  /** かな読み（検索用） — null if not registered */
  titleReading: string | null;
  cookTimeMin: number | null;
  rating: number | null;
  tags: string[];
  ingredientNames: string[];
  /** ISO timestamp the recipe was created (for "newest" sort) */
  createdAt: string;
  /** Number of cooking logs recorded for this recipe (for "most cooked" sort) */
  cookCount: number;
  /** Card image: the cover photo, else the latest cooking photo, if any */
  heroPhotoUri: string | null;
  /** 作りたいリスト: ピン留め日時（ISO） — null = 未ピン */
  pinnedAt: string | null;
}

export interface RecipeDetail {
  id: string;
  title: string;
  /**
   * 料理名の読みがな（かな検索に使う）。**編集画面がここを読まないと、
   * 開いて更新しただけで消える**（#220）。
   */
  titleReading: string | null;
  servings: number | null;
  cookTimeMin: number | null;
  /** 下ごしらえの時間（分）。`titleReading` と同じ理由で詳細も返す */
  prepTimeMin: number | null;
  description: string | null;
  rating: number | null;
  tags: string[];
  ingredients: IngredientItem[];
  steps: StepItem[];
  /** Detail header image: the cover photo, else the latest cooking photo, if any */
  heroPhotoUri: string | null;
  /** The recipe's own cover photo (端末内パス) — null if none set */
  coverPhotoPath: string | null;
  /** 作りたいリスト: ピン留め日時（ISO） — null = 未ピン */
  pinnedAt: string | null;
  /** お店の名前（任意）。レシピが持つ（記録側は履歴なので表示に使わない） */
  placeName: string | null;
}

export interface MemoItem {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
}

export interface RecipeRevisionSummary {
  id: string;
  recipeId: string;
  revisionNumber: number;
  isMajor: boolean;
  createdBy: string;
  createdAt: string;
  servings: number | null;
  cookTimeMin: number | null;
  prepTimeMin: number | null;
  description: string | null;
  authorNote: string | null;
  sourceId: string | null;
  ingredientCount: number;
  stepCount: number;
  isCurrent: boolean;
}

export interface IngredientItem {
  id: string;
  groupLabel: string | null;
  name: string;
  amount: string | null;
  note: string | null;
  sortOrder: number;
}

export interface StepItem {
  id: string;
  body: string;
  timerSec: number | null;
  sortOrder: number;
  /** 手順写真（端末内パス） */
  photoPath: string | null;
}

/** 体験の種類。'eaten_out' は店で食べた記録で、調理はしていない。 */
export type CookingLogKind = 'cooked' | 'eaten_out';

export interface TimelineEntry {
  id: string;
  recipeId: string | null;
  recipeTitle: string;
  userName: string;
  cookedAt: string;
  servings: number | null;
  rating: number | null;
  memo: string | null;
  photos: CookingPhotoItem[];
  kind: CookingLogKind;
  /** 店名（kind='eaten_out' のとき） */
  placeName: string | null;
}

export interface CookingPhotoItem {
  id: string;
  localPath: string;
  cloudUrl: string | null;
  sortOrder: number;
  takenAt: string | null;
  createdAt: string;
}

export interface SaveRecipeInput {
  title: string;
  titleReading?: string;
  description?: string;
  servings?: number;
  cookTimeMin?: number;
  prepTimeMin?: number;
  authorNote?: string;
  sourceId?: string;
  ingredients: {
    groupLabel?: string;
    name: string;
    amount?: string;
    note?: string;
  }[];
  steps: {
    body: string;
    timerSec?: number;
    /** 手順写真（端末内パス） */
    photoPath?: string | null;
  }[];
  tags: string[];
  /** 表紙写真（端末内パス）。null/undefined = なし */
  coverPhotoPath?: string | null;
  /** お店の名前（任意）。空文字・undefined = 未設定 */
  placeName?: string | null;
}

/**
 * レシピの更新。**`undefined` は「触らない」、`null`・空文字は「消す」。**
 *
 * 以前は `SaveRecipeInput` をそのまま継承した全置換 API で、渡さなかった欄が
 * 黙って `null` になっていた。呼び出し元は 2 つしか無いのに **2 つとも
 * `titleReading` と `prepTimeMin` を落としていて**、レシピを開いて更新するだけで
 * 読みがなが消えた（#220）。`refine` は `placeName` も落としていた —
 * 主役機能の「お店の味に近づける」を通すたびに店名が消える形だった。
 *
 * 呼び出し元が増えるたび同じ穴が開くので、**画面ごとに塞ぐのではなく
 * ここで「渡されなかった欄は現行値を引き継ぐ」**ことにした。
 * `sourceId` は以前から同じ扱い（引き継がないと Web 共有の出所ゲートが外れる）。
 *
 * したがって呼び出し側の約束はこう:
 * - **自分が持っている欄は必ず渡す**（消したいなら `null` か空文字）
 * - 持っていない欄は渡さない
 */
export interface UpdateRecipeInput extends Omit<
  SaveRecipeInput,
  'titleReading' | 'description' | 'servings' | 'cookTimeMin' | 'prepTimeMin'
> {
  titleReading?: string | null;
  description?: string | null;
  servings?: number | null;
  cookTimeMin?: number | null;
  prepTimeMin?: number | null;
  isMajor?: boolean;
}

export interface TagItem {
  id: string;
  name: string;
  color: string | null;
}

export type FamilyRole = 'owner' | 'member';

export interface CurrentUser {
  id: string;
  displayName: string;
}

export interface CurrentFamily {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
  memberCount: number;
}

export interface FamilyMember {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: FamilyRole;
  joinedAt: string;
  isCurrentUser: boolean;
}

export interface JoinFamilyResult {
  status: 'joined' | 'already-member';
  family: CurrentFamily;
}

export interface SaveCookingLogInput {
  recipeId?: string;
  servings?: number;
  rating?: number;
  memo?: string;
  cookedAt: string;
  photos?: SaveCookingPhotoInput[];
  /** 省略時は 'cooked'（家で作った） */
  kind?: CookingLogKind;
  /** 店名（kind='eaten_out' のとき） */
  placeName?: string;
}

export interface SaveCookingPhotoInput {
  localPath: string;
  cloudUrl?: string | null;
  takenAt?: string;
}

export interface CookingLogEntry {
  id: string;
  recipeId: string | null;
  recipeTitle: string;
  userName: string;
  cookedAt: string;
  servings: number | null;
  rating: number | null;
  memo: string | null;
  photos: CookingPhotoItem[];
  kind: CookingLogKind;
  /** 店名（kind='eaten_out' のとき） */
  placeName: string | null;
}

export type ShoppingItemSource = 'manual' | 'recipe' | 'low_stock' | 'receipt';

export interface ShoppingItem {
  id: string;
  name: string;
  amount: string | null;
  checked: boolean;
  source: ShoppingItemSource;
  recipeId: string | null;
  /** 買う場所のグループ（v13・任意）。例: スーパー / ドラッグストア。null = 未設定 */
  storeGroup: string | null;
  /** 入れた人・チェックした人（v13）。家族で共有したとき「誰が」を辿れるように */
  createdBy: string | null;
  checkedBy: string | null;
  /**
   * 家族と共有するか（v15）。**グループに入っていない間は UI に出さない**
   * （使わない人の画面を変えない — `docs/クラウド同期設計.md` §5-2）。
   */
  shared: boolean;
}

export interface PantryItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  lowStockThreshold: number | null;
  janCode: string | null;
  /** 置き場所・用途のグループ（v13）。null = 未設定バケツ */
  groupName: string | null;
  /** 賞味期限 YYYY-MM-DD（v13・任意）。合算時は近い方を残す */
  expiresOn: string | null;
  /** 家族と共有するか（v15）。詳細は `ShoppingItem.shared` */
  shared: boolean;
}

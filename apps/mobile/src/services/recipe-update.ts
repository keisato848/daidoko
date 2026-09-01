/**
 * レシピ更新の「渡されなかった欄をどうするか」だけを決める純関数。
 *
 * **`undefined` = 触らない / `null`・空文字 = 消す。**
 *
 * なぜ切り出してあるか: この規則は SQLite 実装（`recipe.service.updateRecipe`）と
 * web モック（`db/mock.updateMockRecipe`）の**両方**が守らないといけない。
 * 手写しで二重化すると、**jest は mock 側しか通らないので実装側だけ壊れても緑になる**
 * （実際に #220 は 2026-05-08 から 1.11.x まで、916 件のテストが緑のまま出荷され続けた）。
 * 分岐の手前にある純関数にしておけば、`isNativePlatform` のモック値に関係なく規則を試せる。
 *
 * 呼び出し側の約束:
 * - **自分が持っている欄は必ず渡す**（消したいなら `null` か空文字）
 * - 持っていない欄は渡さない
 */
import { toStoredPhotoPath } from './photo-path';
import type { UpdateRecipeInput } from './types';

/** 更新前の値。`revision` は現行リビジョン（無ければ null） */
export interface RecipeUpdateCurrent {
  titleReading: string | null;
  coverPhotoPath: string | null;
  placeName: string | null;
  /** 中身が AI 由来か（#266）。一度立ったら下がらない */
  aiGenerated: boolean;
  revision: {
    servings: number | null;
    cookTimeMin: number | null;
    prepTimeMin: number | null;
    description: string | null;
    sourceId: string | null;
  } | null;
}

/** 書き込む値。`recipes` 行と新しいリビジョンの両方ぶんを含む */
export interface ResolvedRecipeUpdate {
  titleReading: string | null;
  coverPhotoPath: string | null;
  placeName: string | null;
  /** 中身が AI 由来か（#266）。一度立ったら下がらない */
  aiGenerated: boolean;
  servings: number | null;
  cookTimeMin: number | null;
  prepTimeMin: number | null;
  description: string | null;
  sourceId: string | null;
}

/** 渡されたなら採用、`undefined` なら現行値。 */
function keep<T>(given: T | undefined, current: T): T {
  return given === undefined ? current : given;
}

/**
 * 空文字は「消す」の意味なので null に寄せる。`undefined` は素通し（＝触らない）。
 *
 * `createRecipe` からも使う — **作成と更新で `''` の扱いが違うと、
 * 相談・写真レシピで作ったレシピが `title_reading = ''` で入り、最初の編集で
 * 初めて null に化ける**（同じ値なのに保存経路で形が変わる）。
 */
export function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() ? value.trim() : null;
}

export function resolveRecipeUpdate(
  input: UpdateRecipeInput,
  current: RecipeUpdateCurrent,
): ResolvedRecipeUpdate {
  const rev = current.revision;

  return {
    titleReading: keep(blankToNull(input.titleReading), current.titleReading),
    placeName: keep(blankToNull(input.placeName), current.placeName),
    // 写真は DB 保存形（相対パス）へ正規化してから比べる。`''` は toStoredPhotoPath が null にする
    coverPhotoPath: keep(
      input.coverPhotoPath === undefined ? undefined : toStoredPhotoPath(input.coverPhotoPath),
      current.coverPhotoPath,
    ),
    // 数値は `null` が「消す」。`?? undefined` に潰すと、フォームで空にしても消せなくなる
    servings: keep(input.servings, rev?.servings ?? null),
    cookTimeMin: keep(input.cookTimeMin, rev?.cookTimeMin ?? null),
    prepTimeMin: keep(input.prepTimeMin, rev?.prepTimeMin ?? null),
    description: keep(blankToNull(input.description), rev?.description ?? null),
    /*
      出所は必ず引き継ぐ。編集で落とすと **URL 取り込みの印が消え、Web 共有の出所ゲート
      （sources.type='url' で判定）が外れて他人のサイト由来のレシピを公開できてしまう**。
      同期でも現行リビジョンの出所しか運ばないので、ここで切れると受信側で素通りになる。
    */
    sourceId: input.sourceId ?? rev?.sourceId ?? null,
    /*
      AI 由来の印は**一方向**。立てることはできるが、下げることはできない（#266）。

      `keep()` を使わないのはそのため。編集で `undefined` が来たら現行値を保つのは
      同じだが、`false` が来ても現行の `true` を消さない点が違う。**分量を 1 つ
      直しただけで「人が作ったレシピ」に化けると、安全表示として逆方向になる。**

      同期でも同じ理由で効く。印を知らない古い端末から `aiGenerated` の無い
      payload が後勝ちで届いても、ここを通れば印は残る。
    */
    aiGenerated: current.aiGenerated || input.aiGenerated === true,
  };
}

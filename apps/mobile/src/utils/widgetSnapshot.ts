/**
 * ウィジェットに渡すスナップショットの契約（W0・`docs/ウィジェット設計.md` §1）。
 *
 * **ウィジェットから DB を直読みしない。** iOS の App Group へ DB を移すのは
 * 既存全ユーザーのファイル移動＝**データ消失リスクの新設**で、Android の
 * Headless から expo-sqlite を読むのも確証が無い。表示に要るのは高々 10 行なので、
 * **アプリが JSON を 1 本書き出して、両 OS がそれを読む**。
 *
 * ここは組み立てる純関数だけ。書き出し先（iOS = App Group / Android =
 * documentDirectory）はサービス側が持つ。
 */

/** 契約の版。**増やすときは省略可フィールドで足す** — 旧ウィジェットが読めなくなるため */
export const WIDGET_SNAPSHOT_VERSION = 1;

/** 小サイズで出す上限。中サイズは 6 行＋「ほか n 品」（設計 §2） */
export const WIDGET_SHOPPING_PREVIEW = 6;

/** 週間表示（W2 大サイズ）で出す上限。7 日分（設計 §2・ペルソナ確定） */
export const WIDGET_MENU_WEEK_MAX = 7;

/**
 * 週間表示（大サイズ）の 1 日分。**省略可フィールドで足したもの**（版は上げない・§1）。
 * `title`/`recipeId` が null の日は「未定」（—）として描く。`isToday` は
 * `anchorDate` を持つ自動モードのときだけ true になりうる（手動プランは日付が無い）。
 */
export interface WidgetMenuWeekDay {
  title: string | null;
  /** タップ先。無ければ null（未定・削除済みは献立画面へ） */
  recipeId: string | null;
  /** 作り終わった日（ISO）。null = まだ。薄く描くのに使う */
  doneAt: string | null;
  /** 今日の行。金色で強調するのに使う */
  isToday: boolean;
}

export interface WidgetSnapshot {
  version: number;
  /** 書き出した時刻（ISO）。ウィジェットは「HH:mm 時点」として**必ず表示する** */
  writtenAt: string;
  /** 文言をどちらで描くか。ウィジェットはアプリの i18n を読めない */
  locale: 'ja' | 'en';
  shopping: {
    /** 未購入の総数 */
    remaining: number;
    /** 先頭の品名（最大 WIDGET_SHOPPING_PREVIEW 件） */
    names: string[];
  };
  menu: {
    /**
     * 見出しに使う語。`anchorDate` を持つ自動モードのときだけ 'today'。
     * M1 の手動プランは日付を持たないので 'next'（＝「次の一品」）。
     * **ホームのカードと同じ規約**（設計 §2・§10.10.4）— 片方だけ「今日」と
     * 言うと、同じデータが画面によって違う顔をする。
     */
    kind: 'today' | 'next' | null;
    /** 出す 1 品。無ければ null */
    title: string | null;
    /**
     * 出す 1 品のレシピ ID（タップ先 `daidoko://recipes/<id>`）。無ければ null。
     * **省略可フィールドで足したもの**（旧ウィジェットは無視する・§1）。
     */
    recipeId?: string | null;
    /**
     * 週間表示（W2 大サイズ）用の 7 日分。**省略可フィールド**。
     * 旧アプリが書いた（この欄が無い）スナップショットも読める。
     */
    week?: WidgetMenuWeekDay[];
    /**
     * 「組む」で要求した日数（`StoredMenuPlan.requestedDays`）。**省略可フィールドで
     * 足したもの**（版は上げない・§1）。週間表示（大）で `week.length` がこれに
     * 満たないとき「残り◯日分はレシピが足りません」を末尾に出す。
     * 旧アプリ・旧プラン（要求日数を保存していない）には無い — 無ければ不足行を出さない。
     */
    requestedDays?: number;
    /**
     * 出しているプランの時間帯（v19・設計 §10.13）。**省略可フィールドで足したもの**
     * （版は上げない・§1）。**無ければ夕** — 夕のときは書かないので、夕の表示は
     * 旧スナップショット・旧ウィジェットと 1 文字も変わらない。朝/昼のときだけ
     * 見出しに「（昼）」等を付ける（`menuWidgetContent`）。
     */
    mealTime?: 'breakfast' | 'lunch';
  };
}

export interface SnapshotInput {
  shoppingItems: readonly { name: string; checked: boolean }[];
  /**
   * 献立の日。`doneAt` が null の最初の日を「今日/次の一品」に出す。
   * `recipeId`（タップ先）・`day`（自動モードの日番号・1 始まり）は省略可 —
   * 手動プランや旧データには無い。`day` と `anchorDate` が揃うと週間表示の
   * 「今日」判定ができる。
   */
  menuDays: readonly {
    title: string;
    doneAt: string | null;
    missing?: boolean;
    recipeId?: string;
    day?: number;
  }[];
  /** 自動モードの起点日。**あるときだけ「今日」と言える**（§10.11 で入る） */
  anchorDate: string | null;
  /** 「組む」で要求した日数。省略可 — 旧プランには保存されていない */
  requestedDays?: number | null;
  /**
   * 出すプランの時間帯。省略・'dinner'・未知の値はどれも「夕」= スナップショットに
   * 書かない（表示ルール: 夕は無印・§10.13）。
   */
  mealTime?: string | null;
  locale: 'ja' | 'en';
  now: Date;
}

/** ローカル暦日のキー（`YYYY-MM-DD`）。`menuDateKey`（menuPlan）と同じ規約 */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM-DD` に `add` 日足したキー。壊れた anchor なら null */
function addDaysToDateKey(anchor: string, add: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + add);
  return localDateKey(d);
}

/**
 * スナップショットを組み立てる。**空でも必ず 1 本書く** — 書かないと
 * ウィジェットが前回の姿を出し続け、古いことが利用者に見えない。
 */
export function buildWidgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  const unchecked = input.shoppingItems.filter((item) => !item.checked);
  // 削除されたレシピの日は飛ばす（ウィジェットに「無くなりました」は出せない）
  const nextDay = input.menuDays.find((day) => day.doneAt === null && !day.missing) ?? null;

  // 週間表示（大サイズ）用に先頭 7 日分を写す。「今日」は anchorDate（自動モード）が
  // あるときだけ日番号から暦日を割り当てて判定する（手動プランは日付が無い・§2）。
  const todayKey = localDateKey(input.now);
  const week: WidgetMenuWeekDay[] = input.menuDays.slice(0, WIDGET_MENU_WEEK_MAX).map((day) => {
    const missing = day.missing === true;
    let isToday = false;
    if (input.anchorDate && typeof day.day === 'number') {
      const key = addDaysToDateKey(input.anchorDate, day.day - 1);
      isToday = key !== null && key === todayKey;
    }
    return {
      title: missing ? null : day.title,
      recipeId: missing ? null : (day.recipeId ?? null),
      doneAt: day.doneAt,
      isToday,
    };
  });

  return {
    version: WIDGET_SNAPSHOT_VERSION,
    writtenAt: input.now.toISOString(),
    locale: input.locale,
    shopping: {
      remaining: unchecked.length,
      names: unchecked.slice(0, WIDGET_SHOPPING_PREVIEW).map((item) => item.name),
    },
    menu: {
      kind: nextDay ? (input.anchorDate ? 'today' : 'next') : null,
      title: nextDay ? nextDay.title : null,
      recipeId: nextDay ? (nextDay.recipeId ?? null) : null,
      week,
      // 要求日数（不足行用）。無い・壊れた値は載せない（旧プランと同じ「出さない」へ倒す）
      ...(typeof input.requestedDays === 'number' &&
      Number.isInteger(input.requestedDays) &&
      input.requestedDays > 0
        ? { requestedDays: input.requestedDays }
        : {}),
      // 時間帯（§10.13）。朝/昼のときだけ書く — 夕は書かない（無印の規約そのもの）
      ...(input.mealTime === 'breakfast' || input.mealTime === 'lunch'
        ? { mealTime: input.mealTime }
        : {}),
    },
  };
}

/**
 * 読む側の検証。**知らない版は捨てる**（前方互換は諦める — ウィジェットが
 * 壊れた形を描くより、何も出さない方がよい）。省略可フィールドの追加は
 * 版を上げないので、ここは `>` ではなく `!==` にしない。
 */
export function parseWidgetSnapshot(raw: string): WidgetSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const snapshot = value as Partial<WidgetSnapshot>;
  if (typeof snapshot.version !== 'number' || snapshot.version > WIDGET_SNAPSHOT_VERSION) {
    return null;
  }
  if (typeof snapshot.writtenAt !== 'string') return null;
  if (snapshot.locale !== 'ja' && snapshot.locale !== 'en') return null;
  const shopping = snapshot.shopping;
  if (
    typeof shopping !== 'object' ||
    shopping === null ||
    typeof shopping.remaining !== 'number' ||
    !Array.isArray(shopping.names)
  ) {
    return null;
  }
  const menu = snapshot.menu;
  if (typeof menu !== 'object' || menu === null) return null;
  if (menu.kind !== null && menu.kind !== 'today' && menu.kind !== 'next') return null;

  return {
    version: snapshot.version,
    writtenAt: snapshot.writtenAt,
    locale: snapshot.locale,
    shopping: {
      remaining: shopping.remaining,
      names: shopping.names.filter((n): n is string => typeof n === 'string'),
    },
    menu: {
      kind: menu.kind ?? null,
      title: typeof menu.title === 'string' ? menu.title : null,
      recipeId: typeof menu.recipeId === 'string' ? menu.recipeId : null,
      // 旧アプリが書いた（week の無い）スナップショットも読める。壊れた行は捨てる
      week: Array.isArray(menu.week)
        ? menu.week.map(sanitizeWeekDay).filter((d): d is WidgetMenuWeekDay => d !== null)
        : [],
      // 要求日数（不足行用・省略可）。無い・壊れた値は「無い」として読む
      ...(typeof menu.requestedDays === 'number' &&
      Number.isInteger(menu.requestedDays) &&
      menu.requestedDays > 0
        ? { requestedDays: menu.requestedDays }
        : {}),
      // 時間帯（省略可・§10.13）。無い・未知の値は「夕」として読む（= 載せない）
      ...(menu.mealTime === 'breakfast' || menu.mealTime === 'lunch'
        ? { mealTime: menu.mealTime }
        : {}),
    },
  };
}

/** 週間表示の 1 日分を読む側で正規化する。オブジェクトでなければ null（その行は捨てる） */
function sanitizeWeekDay(value: unknown): WidgetMenuWeekDay | null {
  if (typeof value !== 'object' || value === null) return null;
  const day = value as Record<string, unknown>;
  return {
    title: typeof day.title === 'string' ? day.title : null,
    recipeId: typeof day.recipeId === 'string' ? day.recipeId : null,
    doneAt: typeof day.doneAt === 'string' ? day.doneAt : null,
    isToday: day.isToday === true,
  };
}

/**
 * 「HH:mm 時点」の表示。**スナップショットは最後にアプリが動いた時点の姿**なので、
 * 古さを黙って見せない（設計 §2）。ウィジェットは端末のロケールで描く。
 */
export function formatSnapshotTime(writtenAt: string): string {
  const at = new Date(writtenAt);
  if (Number.isNaN(at.getTime())) return '';
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

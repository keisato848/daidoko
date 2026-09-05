/**
 * 献立ウィジェット（W2・Android・`docs/ウィジェット設計.md` §2）の文言・行整形。
 *
 * ペルソナ確定の設計（由紀・美咲ら 5 人の総意）:
 * - **既定は「今日の一品」を大きく**。小/中サイズは 1 品だけ。タップ →
 *   そのレシピ詳細（`daidoko://recipes/<id>`）。無ければ献立画面（`daidoko://menu`）。
 * - **週間一覧は大サイズのときだけ**（ウィジェット内トグルは
 *   react-native-android-widget では困難なので、サイズで出し分ける）。今日は金色で
 *   強調、調理済みは薄く、未定の日は「—」＋グレー。
 * - **「HH:mm 時点」の鮮度表示は必須**（W1 と同じ・スナップショットは最後に
 *   アプリが動いた時点）。
 *
 * `shoppingWidgetContent.ts` と同じ作法 — ここは**純関数だけ**（JSX 組み立ては
 * `MenuWidget.tsx`）。アプリの i18n は読めないので `snapshot.locale` で ja/en を
 * 描き分ける小さな辞書を持つ。
 */
import { formatSnapshotTime } from '../utils/widgetSnapshot';
import type { WidgetSnapshot } from '../utils/widgetSnapshot';

/** 小/中=今日の一品、大=週間一覧（設計 §2） */
export type MenuWidgetSize = 'small' | 'medium' | 'large';

/** タップ先のスキーム（設計 §9: いずれもタブ残置画面で再編の影響なし） */
export const MENU_URI = 'daidoko://menu';
export function recipeUri(recipeId: string): string {
  return `daidoko://recipes/${recipeId}`;
}

/**
 * ウィジェットの幅・高さ（dp）から表示サイズを決める。
 *
 * **週間（大）は縦に 7 行積む**ので高さで判定する（横幅だけ広げても週間には
 * しない — 1 行の今日を大きく出す方がペルソナの既定）。中は横幅が広いとき
 * （写真サムネの余地がある想定）、それ未満は小。plugin の
 * `maxResizeHeight`（app.json）まで伸ばすと大に入る。
 */
const LARGE_MIN_HEIGHT_DP = 250;
const MEDIUM_MIN_WIDTH_DP = 250;

export function menuWidgetSize(widthDp: number, heightDp: number): MenuWidgetSize {
  if (heightDp >= LARGE_MIN_HEIGHT_DP) return 'large';
  return widthDp >= MEDIUM_MIN_WIDTH_DP ? 'medium' : 'small';
}

const MENU_DICT = {
  ja: {
    today: '今日の一品',
    next: '次の一品',
    week: '今週の献立',
    asOf: (hhmm: string) => `${hhmm} 時点`,
    undecided: '未定',
    // 献立がまだ無い/未定。タップで献立画面へ
    noMenu: '献立はまだありません',
    noSnapshot: 'アプリを開くと表示されます',
    // 週間（大）の末尾に 1 行。要求日数に組めた日数が満たないとき（由紀の案）
    shortfall: (count: number) => `残り${count}日分はレシピが足りません`,
    // 時間帯の印（v19・§10.13）。**朝/昼のときだけ**見出しに付ける — 夕は無印のまま
    // 1 文字も変えない（snapshot に mealTime が無い = 夕）
    mealSuffix: { breakfast: '（朝）', lunch: '（昼）' },
  },
  en: {
    today: "Today's dish",
    next: 'Next dish',
    week: 'This week',
    asOf: (hhmm: string) => `as of ${hhmm}`,
    undecided: 'TBD',
    noMenu: 'No menu yet',
    noSnapshot: 'Open the app to see your menu',
    shortfall: (count: number) =>
      count === 1
        ? 'Not enough recipes for 1 more day'
        : `Not enough recipes for ${count} more days`,
    mealSuffix: { breakfast: ' (breakfast)', lunch: ' (lunch)' },
  },
} as const;

/** 見出しに付ける時間帯の印。夕（mealTime 無し）は空文字 = 見出しは従来のまま */
function mealTimeSuffix(
  dict: (typeof MENU_DICT)[keyof typeof MENU_DICT],
  mealTime: 'breakfast' | 'lunch' | undefined,
): string {
  return mealTime ? dict.mealSuffix[mealTime] : '';
}

/** 週間表示の 1 行（大サイズ） */
export interface MenuWidgetWeekRow {
  /** 料理名。未定・削除済みは「—」 */
  label: string;
  /** 今日の行（金色で強調） */
  isToday: boolean;
  /** 調理済み（薄く描く） */
  isDone: boolean;
  /** 未定・削除済み（グレーの「—」） */
  isUndecided: boolean;
  /** タップ先。レシピがあればその詳細、無ければ献立画面 */
  uri: string;
}

/** 「今日の一品」表示（小/中） */
export interface MenuWidgetTodayContent {
  mode: 'today';
  locale: 'ja' | 'en';
  /** 見出し（今日の一品 / 次の一品 / 献立）。kind により変わる */
  heading: string;
  /** 料理名。無ければ null（案内文を出す） */
  dishName: string | null;
  /** 献立が無い/未定のときの案内。無ければ null */
  emptyMessage: string | null;
  /** 「HH:mm 時点」。スナップショット無しのときは null */
  timeLabel: string | null;
  /** ウィジェット全体のタップ先 */
  uri: string;
}

/** 週間一覧表示（大） */
export interface MenuWidgetWeekContent {
  mode: 'week';
  locale: 'ja' | 'en';
  heading: string;
  rows: MenuWidgetWeekRow[];
  /** 献立が 1 件も無いときの案内。無ければ null */
  emptyMessage: string | null;
  /**
   * 要求日数に組めた日数が満たないときの末尾 1 行（「残り◯日分はレシピが足りません」）。
   * 満ちている・要求日数が分からない（旧データ）・献立自体が無いときは null。
   */
  shortfallMessage: string | null;
  timeLabel: string | null;
  /** ウィジェット全体（見出し等）のタップ先。各行は行ごとの uri を持つ */
  uri: string;
}

export type MenuWidgetContent = MenuWidgetTodayContent | MenuWidgetWeekContent;

/**
 * スナップショットからウィジェットに出す内容を組む。
 *
 * `snapshot` が null（ファイルが無い・パース失敗）のときは**ロケールの手掛かりが
 * 無い**ので ja 固定で「アプリを開くと表示されます」を出す（`shoppingWidgetContent`
 * と同じ・設計 §6-1）。タップ先は献立画面（レシピ ID が無い）。
 */
export function buildMenuWidgetContent(
  snapshot: WidgetSnapshot | null,
  size: MenuWidgetSize,
): MenuWidgetContent {
  if (!snapshot) {
    const dict = MENU_DICT.ja;
    if (size === 'large') {
      return {
        mode: 'week',
        locale: 'ja',
        heading: dict.week,
        rows: [],
        emptyMessage: dict.noSnapshot,
        shortfallMessage: null,
        timeLabel: null,
        uri: MENU_URI,
      };
    }
    return {
      mode: 'today',
      locale: 'ja',
      heading: dict.today,
      dishName: null,
      emptyMessage: dict.noSnapshot,
      timeLabel: null,
      uri: MENU_URI,
    };
  }

  const dict = MENU_DICT[snapshot.locale];
  const timeLabel = dict.asOf(formatSnapshotTime(snapshot.writtenAt));
  // 朝/昼のときだけ見出しに印（§10.13）。夕（mealTime 無し）は空文字で従来どおり
  const suffix = mealTimeSuffix(dict, snapshot.menu.mealTime);

  if (size === 'large') {
    const week = snapshot.menu.week ?? [];
    const rows: MenuWidgetWeekRow[] = week.map((day) => {
      const isUndecided = day.title === null;
      return {
        label: day.title ?? '—',
        isToday: day.isToday,
        isDone: day.doneAt !== null,
        isUndecided,
        uri: day.recipeId ? recipeUri(day.recipeId) : MENU_URI,
      };
    });
    // 要求日数に満たない分の末尾 1 行。要求日数が無い（旧アプリ・旧プラン）なら出さない。
    // 実の献立が 1 つも無いときも出さない — その場合は noMenu の案内に一本化する
    const requested = snapshot.menu.requestedDays;
    const hasAnyDish = rows.some((r) => !r.isUndecided);
    const shortfall = typeof requested === 'number' ? requested - week.length : 0;
    return {
      mode: 'week',
      locale: snapshot.locale,
      heading: dict.week + suffix,
      rows,
      // 実の献立が 1 つも無い（全部未定 or 空）なら案内を出す
      emptyMessage: hasAnyDish ? null : dict.noMenu,
      shortfallMessage: hasAnyDish && shortfall > 0 ? dict.shortfall(shortfall) : null,
      timeLabel,
      uri: MENU_URI,
    };
  }

  // 小/中 = 今日の一品
  const heading = (snapshot.menu.kind === 'next' ? dict.next : dict.today) + suffix;
  const dishName = snapshot.menu.title;
  const recipeId = snapshot.menu.recipeId ?? null;
  return {
    mode: 'today',
    locale: snapshot.locale,
    heading,
    dishName,
    emptyMessage: dishName ? null : dict.noMenu,
    timeLabel,
    uri: recipeId ? recipeUri(recipeId) : MENU_URI,
  };
}

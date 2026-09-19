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

/** 小/中=今日の一品、大/特大=週間一覧（設計 §2） */
export type MenuWidgetSize = 'small' | 'medium' | 'large' | 'xlarge';

/** タップ先のスキーム（設計 §9: いずれもタブ残置画面で再編の影響なし） */
export const MENU_URI = 'daidoko://menu';
export function recipeUri(recipeId: string): string {
  return `daidoko://recipes/${recipeId}`;
}

/**
 * ウィジェットの幅・高さ（dp）から表示サイズを決める。
 *
 * **週間（大/特大）は縦に 7 行積む**ので高さで判定する。特大はさらに幅が必要。
 * 中は横幅が広いとき、それ未満は小。
 */
const LARGE_MIN_HEIGHT_DP = 250;
const MEDIUM_MIN_WIDTH_DP = 250;
export const MENU_WIDGET_XL_MIN_WIDTH_DP = 400; // 仮

export function menuWidgetSize(widthDp: number, heightDp: number): MenuWidgetSize {
  if (heightDp >= LARGE_MIN_HEIGHT_DP) {
    return widthDp >= MENU_WIDGET_XL_MIN_WIDTH_DP ? 'xlarge' : 'large';
  }
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
    otherSides: (count: number) => `ほか${count}品`,
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
    otherSides: (count: number) => `+${count} more`,
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
  /** 副菜（特大サイズ用）。「汁物 味噌汁・副菜 冷奴」のように連結済み。無ければ null */
  sidesText: string | null;
}

/** 「今日の一品」表示（小/中） */
export interface MenuWidgetTodayContent {
  mode: 'today';
  locale: 'ja' | 'en';
  /** 見出し（今日の一品 / 次の一品 / 献立）。kind により変わる */
  heading: string;
  /** 料理名。無ければ null（案内文を出す） */
  dishName: string | null;
  /** 副菜のリスト（小は最大 2 件、中は最大 4 件） */
  sides: { text: string; uri: string; isDone: boolean }[];
  /** 切り捨てた副菜の数。無ければ 0 */
  sidesOverflowCount: number;
  /** 溢れたときに出す「ほか◯品」の文言。無ければ null */
  sidesOverflowText: string | null;
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
  /** 特大サイズか（副菜を各行に出す） */
  isXLarge: boolean;
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
    if (size === 'large' || size === 'xlarge') {
      return {
        mode: 'week',
        locale: 'ja',
        heading: dict.week,
        rows: [],
        isXLarge: size === 'xlarge',
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
      sides: [],
      sidesOverflowCount: 0,
      sidesOverflowText: null,
      emptyMessage: dict.noSnapshot,
      timeLabel: null,
      uri: MENU_URI,
    };
  }

  const dict = MENU_DICT[snapshot.locale];
  const timeLabel = dict.asOf(formatSnapshotTime(snapshot.writtenAt));
  // 朝/昼のときだけ見出しに印（§10.13）。夕（mealTime 無し）は空文字で従来どおり
  const suffix = mealTimeSuffix(dict, snapshot.menu.mealTime);

  if (size === 'large' || size === 'xlarge') {
    const week = snapshot.menu.week ?? [];
    const isXLarge = size === 'xlarge';
    const rows: MenuWidgetWeekRow[] = week.map((day) => {
      const isUndecided = day.title === null;
      const sidesText =
        isXLarge && day.sides && day.sides.length > 0
          ? day.sides.map((s) => `${s.label} ${s.title}`).join('・')
          : null;
      return {
        label: day.title ?? '—',
        isToday: day.isToday,
        isDone: day.doneAt !== null,
        isUndecided,
        uri: day.recipeId ? recipeUri(day.recipeId) : MENU_URI,
        sidesText,
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
      isXLarge,
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
  const maxSides = size === 'small' ? 2 : 4;
  const rawSides = snapshot.menu.sides ?? [];
  const sides = rawSides.slice(0, maxSides).map((s) => ({
    text: `${s.label}  ${s.title}`,
    uri: s.recipeId ? recipeUri(s.recipeId) : MENU_URI,
    isDone: s.doneAt !== null,
  }));
  const sidesOverflowCount = Math.max(0, rawSides.length - maxSides);
  const sidesOverflowText = sidesOverflowCount > 0 ? dict.otherSides(sidesOverflowCount) : null;

  return {
    mode: 'today',
    locale: snapshot.locale,
    heading,
    dishName,
    sides,
    sidesOverflowCount,
    sidesOverflowText,
    emptyMessage: dishName ? null : dict.noMenu,
    timeLabel,
    uri: recipeId ? recipeUri(recipeId) : MENU_URI,
  };
}

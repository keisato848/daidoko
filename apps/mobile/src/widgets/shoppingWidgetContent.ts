/**
 * 買い物リストウィジェット（W1・`docs/ウィジェット設計.md` §2）の文言・行整形。
 *
 * **アプリの i18n（src/i18n）はここから読めない** — ウィジェットは Android の
 * Headless プロセスから描かれ、react-native-android-widget の JSX を組み立てる側
 * （`ShoppingListWidget.tsx`）は expo-router のツリー外にいる。そのため
 * `snapshot.locale`（W0 でアプリ側が書き出した値）で ja/en を描き分ける、
 * ここだけの小さな辞書を持つ。
 *
 * ここは**純関数だけ**（JSX を組み立てる `ShoppingListWidget.tsx` から分離）。
 * react-native-android-widget の描画はネイティブモジュール経由で jest が素朴に
 * 通せないため、テストが要る「文言選択・行整形」のロジックをここへ切り出して
 * 単体テストする（R5 実装方針）。
 */
import { formatSnapshotTime } from '../utils/widgetSnapshot';
import type { WidgetSnapshot } from '../utils/widgetSnapshot';

export type WidgetSize = 'small' | 'medium';

/** サイズごとの品名プレビュー件数（設計 §2: 小=上位3品名・中=最大6行） */
export const WIDGET_PREVIEW_COUNT: Record<WidgetSize, number> = {
  small: 3,
  medium: 6,
};

/**
 * react-native-android-widget が渡す幅（dp）から表示サイズを決める閾値。
 * plugin 設定の `targetCellWidth`（3セル=180dp / 最大resize 5セル=320dp。
 * app.json 参照）に合わせて、4セル境界の 250dp を中サイズの下限にする。
 */
const MEDIUM_MIN_WIDTH_DP = 250;

export function widgetSizeFromWidth(widthDp: number): WidgetSize {
  return widthDp >= MEDIUM_MIN_WIDTH_DP ? 'medium' : 'small';
}

const WIDGET_DICT = {
  ja: {
    title: '買い物リスト',
    remaining: (n: number) => `未購入 ${n} 品`,
    more: (n: number) => `ほか ${n} 品`,
    asOf: (hhmm: string) => `${hhmm} 時点`,
    allDone: '買うものはありません',
    // スナップショットがまだ無い（アプリ未起動）ときの案内
    noSnapshot: 'アプリを開くと表示されます',
  },
  en: {
    title: 'Shopping List',
    remaining: (n: number) => `${n} to buy`,
    more: (n: number) => `+${n} more`,
    asOf: (hhmm: string) => `as of ${hhmm}`,
    allDone: 'Nothing to buy',
    noSnapshot: 'Open the app to see your list',
  },
} as const;

export interface ShoppingWidgetContent {
  locale: 'ja' | 'en';
  title: string;
  /** 「未購入 N 品」。0 件（または未取得）のときは null */
  countLabel: string | null;
  /** 品名の行（サイズに応じて上位 3 / 6 件） */
  lines: string[];
  /** 「ほか n 品」。中サイズで、表示しきれない残りがあるときだけ */
  moreLabel: string | null;
  /** 「HH:mm 時点」。スナップショットが無いときは null（設計 §2: 必ず表示） */
  timeLabel: string | null;
  /** 案内 1 行（スナップショット無し／購入済みで空）。無ければ null */
  emptyMessage: string | null;
}

/**
 * スナップショットからウィジェットに出す内容を組む。
 *
 * `snapshot` が null（ファイルが無い・パース失敗）のときは**ロケールの手掛かりが
 * 無い**ので ja 固定で「アプリを開くと表示されます」を出す（設計 §6-1: 読めない
 * ときにウィジェットを壊れた形で見せるより、素直に案内する）。
 */
export function buildShoppingWidgetContent(
  snapshot: WidgetSnapshot | null,
  size: WidgetSize,
): ShoppingWidgetContent {
  if (!snapshot) {
    const dict = WIDGET_DICT.ja;
    return {
      locale: 'ja',
      title: dict.title,
      countLabel: null,
      lines: [],
      moreLabel: null,
      timeLabel: null,
      emptyMessage: dict.noSnapshot,
    };
  }

  const dict = WIDGET_DICT[snapshot.locale];
  const previewCount = WIDGET_PREVIEW_COUNT[size];
  const lines = snapshot.shopping.names.slice(0, previewCount);
  const remainingAfterShown = snapshot.shopping.remaining - lines.length;

  return {
    locale: snapshot.locale,
    title: dict.title,
    countLabel:
      snapshot.shopping.remaining > 0 ? dict.remaining(snapshot.shopping.remaining) : null,
    lines,
    moreLabel: size === 'medium' && remainingAfterShown > 0 ? dict.more(remainingAfterShown) : null,
    timeLabel: dict.asOf(formatSnapshotTime(snapshot.writtenAt)),
    emptyMessage: snapshot.shopping.remaining === 0 ? dict.allDone : null,
  };
}

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
  };
}

export interface SnapshotInput {
  shoppingItems: readonly { name: string; checked: boolean }[];
  /** 献立の日。`doneAt` が null の最初の日を出す */
  menuDays: readonly { title: string; doneAt: string | null; missing?: boolean }[];
  /** 自動モードの起点日。**あるときだけ「今日」と言える**（§10.11 で入る） */
  anchorDate: string | null;
  locale: 'ja' | 'en';
  now: Date;
}

/**
 * スナップショットを組み立てる。**空でも必ず 1 本書く** — 書かないと
 * ウィジェットが前回の姿を出し続け、古いことが利用者に見えない。
 */
export function buildWidgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  const unchecked = input.shoppingItems.filter((item) => !item.checked);
  // 削除されたレシピの日は飛ばす（ウィジェットに「無くなりました」は出せない）
  const nextDay = input.menuDays.find((day) => day.doneAt === null && !day.missing) ?? null;

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
    },
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

/**
 * App Group への書き出しと、ウィジェットの再読み込み（W1-iOS・#238）。
 *
 * **`@bacons/apple-targets` の ExtensionStorage を使わない理由**
 * （`docs/ウィジェット設計.md` §7）:
 * autolinking に拾われず Pod に入らないうえ、JS 側がネイティブ不在時に
 * **何もしないスタブへ黙って落ちる**実装だった。例外もログも出ないので、
 * 「書けたつもりで実は書けていない」が実機で見るまで分からない。
 *
 * **ここは同じ轍を踏まない。** ネイティブが無いときは no-op ではなく
 * **警告を 1 回だけ出す**（毎回出すと買い物リストの操作ごとにログが溢れる）。
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

interface DaidokoWidgetStorageNativeModule {
  /** App Group の UserDefaults へ書く。entitlement が無ければ false */
  setString(key: string, value: string, appGroup: string): boolean;
  getString(key: string, appGroup: string): string | null;
  /** kind 未指定なら全ウィジェット */
  reloadWidgets(kind?: string | null): void;
}

const nativeModule =
  requireOptionalNativeModule<DaidokoWidgetStorageNativeModule>('DaidokoWidgetStorage');

/** 警告は 1 回だけ。連打のたびにログを埋めない */
let warnedMissingNative = false;

function warnOnce(reason: string): void {
  if (warnedMissingNative) return;
  warnedMissingNative = true;
  console.warn(
    `[widget] iOS ウィジェットへ書き出せませんでした: ${reason}. ` +
      'ネイティブモジュールが未リンクの可能性があります（prebuild と pod install を確認）。',
  );
}

/**
 * スナップショットを App Group へ置く。**書けたかどうかを返す** —
 * 呼び出し側が「静かに失敗した」を検知できるようにする。
 */
export function setWidgetSnapshot(key: string, value: string, appGroup: string): boolean {
  if (!nativeModule) {
    warnOnce('ネイティブモジュールが見つかりません');
    return false;
  }
  const ok = nativeModule.setString(key, value, appGroup);
  if (!ok) {
    warnOnce(`App Group '${appGroup}' を開けません（entitlement を確認）`);
  }
  return ok;
}

/** 確認用。ネイティブが無ければ null */
export function getWidgetSnapshot(key: string, appGroup: string): string | null {
  return nativeModule?.getString(key, appGroup) ?? null;
}

/** ホーム画面のウィジェットへ即時反映を促す。無ければ何もしない（警告済みのはず） */
export function reloadWidgets(kind?: string): void {
  nativeModule?.reloadWidgets(kind ?? null);
}

/** ネイティブが繋がっているか。テスト・診断用 */
export const isWidgetStorageAvailable = nativeModule != null;

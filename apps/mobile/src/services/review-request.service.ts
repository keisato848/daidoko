/**
 * ストア評価の導線 — 2 系統。
 *
 * 1. In-App Review（OS ネイティブの評価ダイアログ）を「うまくいった瞬間」に出す。
 *    Google Play ポリシー上、評価への見返り（クレジット付与等）は禁止であり、API 自体も
 *    「評価したか・何点か」を一切返さない設計のため、結果に応じた処理は行わない（行えない）。
 *    表示可否・頻度の最終判断は OS 側のクォータに委ねられる（Apple は端末ごと年 3 回まで）。
 *    呼び出し側は fire-and-forget（失敗しても保存フローを妨げない）。
 *
 *    発火点は「最初の成功の瞬間」に置く（2026-09-05 決定）。以前は調理記録 2 件以上だったが、
 *    その条件に到達した利用者がおらず評価 0 件のままだった。定着前に低評価が付くリスクより、
 *    そもそも出ないリスクの方が大きい母数（両 OS 合計 9）なので前倒しした。
 *    端末（インストール）ごと 1 回だけ、の自前ガードは残す。
 *
 * 2. 設定画面からストアの製品ページを開く常設リンク。OS のクォータを受けない。
 *    iOS は独自の評価ダイアログを禁じている（App Store Review Guidelines 5.6.4）ので、
 *    「気に入りましたか？」の前段階は置かず、ストアへ飛ばすだけにする。
 */
import { Linking, Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';

import { isNativePlatform } from '../db/client';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { getCookingLogCount } from './cooking-log.service';

const REQUESTED_AT_KEY = 'store_review_requested_at';

/** 調理記録の保存直後に出すときの最低件数（1 件目＝最初の成功の瞬間）。 */
export const MIN_COOKING_LOGS_FOR_REVIEW = 1;

/**
 * どの成功の瞬間から呼ばれたか。
 * - `cooking-log`: 調理記録を保存した直後（件数条件あり）
 * - `ai-recipe`: 写真・相談から AI の下書きを保存した直後（件数条件なし。掲載文の主役機能が
 *   初めて形になった瞬間なので、これ自体が成功の瞬間）
 */
export type ReviewMoment = 'cooking-log' | 'ai-recipe';

/**
 * 条件を満たすときだけストア評価ダイアログを要求する。
 * 実際に requestReview を呼んだら true（表示されたかは OS 次第で不可知）。
 */
export async function maybeRequestStoreReview(moment: ReviewMoment): Promise<boolean> {
  try {
    if (!isNativePlatform) return false;

    // 端末（インストール）ごとに 1 回だけ。OS クォータとは独立の自前ガード
    if ((await getAppMeta(REQUESTED_AT_KEY)) != null) return false;

    if (moment === 'cooking-log' && (await getCookingLogCount()) < MIN_COOKING_LOGS_FOR_REVIEW) {
      return false;
    }

    if (!(await StoreReview.isAvailableAsync())) return false;

    await StoreReview.requestReview();
    await setAppMeta(REQUESTED_AT_KEY, new Date().toISOString());
    return true;
  } catch {
    // 評価プロンプトは本流の副次機能 — どんな失敗も呼び出し元へ伝播させない
    return false;
  }
}

/** App Store の App ID（`docs/store/app-store/SUBMISSION.md`）。 */
const APP_STORE_ID = '6800964382';
/** Android のパッケージ名（`app.json`）。 */
const ANDROID_PACKAGE = 'com.daidoko.app';

/** ストアの評価ページ URL（第 1 候補: ストアアプリを直接開く / 第 2 候補: Web）。 */
export function storeReviewUrls(os: 'ios' | 'android'): [primary: string, fallback: string] {
  if (os === 'ios') {
    return [
      `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}?action=write-review`,
      `https://apps.apple.com/jp/app/id${APP_STORE_ID}?action=write-review`,
    ];
  }
  return [
    `market://details?id=${ANDROID_PACKAGE}`,
    `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`,
  ];
}

/**
 * 設定画面の「アプリを評価する」。ストアアプリが開けなければ Web の製品ページへ倒す。
 * 開けたら true。どちらも失敗したら false（呼び出し側は失敗時の案内を出してよい）。
 */
export async function openStoreReviewPage(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
  const [primary, fallback] = storeReviewUrls(Platform.OS);
  for (const url of [primary, fallback]) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // 次の候補へ
    }
  }
  return false;
}

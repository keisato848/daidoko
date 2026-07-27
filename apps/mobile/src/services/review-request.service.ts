/**
 * In-App Review（ストア評価プロンプト）— 調理記録の保存直後という「うまくいった瞬間」に
 * OS ネイティブの評価ダイアログを出す。Google Play ポリシー上、評価への見返り
 * （クレジット付与等）は禁止であり、API 自体も「評価したか・何点か」を一切返さない設計
 * のため、結果に応じた処理は行わない（行えない）。表示可否・頻度の最終判断は OS 側の
 * クォータに委ねられる。呼び出し側は fire-and-forget（失敗しても保存フローを妨げない）。
 */
import * as StoreReview from 'expo-store-review';

import { isNativePlatform } from '../db/client';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { getCookingLogCount } from './cooking-log.service';

const REQUESTED_AT_KEY = 'store_review_requested_at';

/** この回数以上の調理記録があるユーザーにだけ出す（定着前の低評価を避ける）。 */
export const MIN_COOKING_LOGS_FOR_REVIEW = 2;

/**
 * 条件を満たすときだけストア評価ダイアログを要求する。
 * 実際に requestReview を呼んだら true（表示されたかは OS 次第で不可知）。
 */
export async function maybeRequestStoreReview(): Promise<boolean> {
  try {
    if (!isNativePlatform) return false;

    // 端末（インストール）ごとに 1 回だけ。OS クォータとは独立の自前ガード
    if ((await getAppMeta(REQUESTED_AT_KEY)) != null) return false;

    if ((await getCookingLogCount()) < MIN_COOKING_LOGS_FOR_REVIEW) return false;

    if (!(await StoreReview.isAvailableAsync())) return false;

    await StoreReview.requestReview();
    await setAppMeta(REQUESTED_AT_KEY, new Date().toISOString());
    return true;
  } catch {
    // 評価プロンプトは本流の副次機能 — どんな失敗も呼び出し元へ伝播させない
    return false;
  }
}

/**
 * UMP（ユーザーメッセージングプラットフォーム）の同意状態を 1 箇所で扱う。
 *
 * **なぜ切り出したか**（2026-09-06・Issue #295）:
 * リワード（`ad-reward.admob.ts`）とアプリ起動（`app-open-ad.admob.ts`）は
 * それぞれ private な `ensureInitialized` の中で同意を確認していたが、
 * **バナー（`components/AdBanner.tsx`）だけが確認せずに広告をリクエストしていた**。
 * 同じ処理が 2 箇所に複製されていて 3 箇所目で漏れた、という形なので、
 * 共有の入口をここに置く。
 *
 * `gatherConsent()` は EEA / 英国でだけフォームを出し、それ以外の地域では
 * 何も表示せずに同意情報を更新するだけ。日本の利用者の見た目は変わらない。
 */
import { AdsConsent } from 'react-native-google-mobile-ads';

import { ADMOB_ENABLED } from '../config';

/**
 * 同意情報を更新し、広告をリクエストしてよいかを返す。
 *
 * 例外は投げない — 同意が取れないことは「広告を出さない」で表現する。
 * ネットワーク不通で更新に失敗しても、前回の同意状態（`canRequestAds`）で判断する。
 */
export async function canRequestAds(): Promise<boolean> {
  if (!ADMOB_ENABLED) return false;
  try {
    // requestInfoUpdate ＋ 必要ならフォーム表示（EEA/UK のみ）を一括で行う
    await AdsConsent.gatherConsent();
  } catch {
    // 更新できなくても、下で前回の同意状態を見る
  }
  try {
    const info = await AdsConsent.getConsentInfo();
    return info.canRequestAds;
  } catch {
    return false;
  }
}

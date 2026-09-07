/**
 * 一覧系画面の下部に置くバナー広告（2026-08-12 採用）。
 *
 * 置いてよい場所は**眺める画面**（蔵書庫一覧・買い物リスト・在庫）だけ。
 * **料理中モードには絶対に出さない** — ストア掲載文で「広告なし」を約束している
 * （listing-ja/en の料理中モードの行）。レシピ詳細・撮影・AI 系画面にも出さない。
 *
 * ゲートは 4 つすべて必要:
 *   - ADMOB_ENABLED（広告有効ビルド）
 *   - ユニット ID が設定されている（空 = そのプラットフォームでは未配線。
 *     空をプロバイダに渡すとテスト ID にフォールバックして本番に出る）
 *   - プレミアムでない
 *   - **UMP の同意が取れている**（2026-09-06 追加・Issue #295）。
 *     リワードとアプリ起動は元から確認していたのに、ここだけ抜けていた。
 *     日本では `gatherConsent()` が何も表示せず素通りするので見た目は変わらない。
 *     EEA / 英国では同意前・拒否後に広告をリクエストしなくなる
 *
 * 失敗（no-fill・読み込みエラー）は静かに畳む。広告の都合で画面を揺らさない。
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import { ADMOB_BANNER_UNIT_ID, ADMOB_ENABLED } from '../config';
import { canRequestAds } from '../services/ads-consent.service';
import { isPremium } from '../services/entitlement.service';

/** 表示可否の純粋判定（テスト対象）。 */
export function shouldShowBanner(input: {
  enabled: boolean;
  unitId: string;
  premium: boolean;
  consented: boolean;
}): boolean {
  return input.enabled && input.unitId !== '' && !input.premium && input.consented;
}

export function AdBanner() {
  const [premium, setPremium] = useState<boolean | null>(null);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    isPremium()
      .then((value) => mounted && setPremium(value))
      .catch(() => mounted && setPremium(false));
    return () => {
      mounted = false;
    };
  }, []);

  // 同意はマウントのたびに取り直す。設定から撤回された直後でも、次に
  // バナーのある画面へ入った時点で反映される（撤回中の画面には残るが、
  // 3 画面とも画面遷移で作り直されるので実質すぐ消える）
  useEffect(() => {
    let mounted = true;
    canRequestAds()
      .then((value) => mounted && setConsented(value))
      .catch(() => mounted && setConsented(false));
    return () => {
      mounted = false;
    };
  }, []);

  // null（判定中）は出さない。後から広告が挿さって画面が跳ねるより、
  // 最初から出ないほうがましという判断。同意も同じ扱いにする
  if (
    premium === null ||
    consented === null ||
    failed ||
    !shouldShowBanner({
      enabled: ADMOB_ENABLED,
      unitId: ADMOB_BANNER_UNIT_ID,
      premium,
      consented,
    })
  ) {
    return null;
  }

  return (
    <View style={styles.container}>
      <BannerAd
        unitId={ADMOB_BANNER_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
});

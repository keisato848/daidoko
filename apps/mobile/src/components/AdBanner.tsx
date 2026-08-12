/**
 * 一覧系画面の下部に置くバナー広告（2026-08-12 採用）。
 *
 * 置いてよい場所は**眺める画面**（蔵書庫一覧・買い物リスト・在庫）だけ。
 * **料理中モードには絶対に出さない** — ストア掲載文で「広告なし」を約束している
 * （listing-ja/en の料理中モードの行）。レシピ詳細・撮影・AI 系画面にも出さない。
 *
 * ゲートは 3 つすべて必要:
 *   - ADMOB_ENABLED（広告有効ビルド）
 *   - ユニット ID が設定されている（空 = そのプラットフォームでは未配線。
 *     空をプロバイダに渡すとテスト ID にフォールバックして本番に出る）
 *   - プレミアムでない
 *
 * 失敗（no-fill・読み込みエラー）は静かに畳む。広告の都合で画面を揺らさない。
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

import { ADMOB_BANNER_UNIT_ID, ADMOB_ENABLED } from '../config';
import { isPremium } from '../services/entitlement.service';

/** 表示可否の純粋判定（テスト対象）。 */
export function shouldShowBanner(input: {
  enabled: boolean;
  unitId: string;
  premium: boolean;
}): boolean {
  return input.enabled && input.unitId !== '' && !input.premium;
}

export function AdBanner() {
  const [premium, setPremium] = useState<boolean | null>(null);
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

  // premium === null（判定中）は出さない。後から広告が挿さって画面が跳ねるより、
  // 最初から出ないほうがましという判断
  if (
    premium === null ||
    failed ||
    !shouldShowBanner({ enabled: ADMOB_ENABLED, unitId: ADMOB_BANNER_UNIT_ID, premium })
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

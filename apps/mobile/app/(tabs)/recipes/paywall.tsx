/**
 * Paywall — get more AI photo-recipes: watch a rewarded ad for one more, or
 * subscribe to premium (unlimited, ad-free). Reached from Settings, or when a
 * free user is out of uses **and no ad can be shown** (no-fill / ads-disabled
 * build / offline) — the in-place ad offer in `inference-gate.service` handles
 * every other exhausted case, with no per-day watch cap.
 */
import { useRouter } from 'expo-router';
import { Check, Crown, Gift, KeyRound, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EULA_URL, PRIVACY_POLICY_URL } from '../../../src/constants/legal';
import { Colors } from '../../../src/constants/theme';
import { t, tCount } from '../../../src/i18n';
import { getAdRewardProvider, isAdRewardAvailable } from '../../../src/services/ad-reward.service';
import type { PreparedRewardedAd } from '../../../src/services/ad-reward.types';
import { dialog } from '../../../src/services/dialog.service';
import {
  getEntitlementProvider,
  isEntitlementConfigured,
} from '../../../src/services/entitlement.service';
import { EntitlementUnavailableError } from '../../../src/services/entitlement.types';
import {
  FREE_LIFETIME_LIMIT,
  getFreemiumStatus,
  grantAdBonus,
} from '../../../src/services/usage.service';

// **定数に文言を焼き付けない。** import 時のロケールで固定される
const BENEFIT_KEYS = ['unlimited', 'noWorry', 'future'] as const;

function benefitText(key: (typeof BENEFIT_KEYS)[number]): string {
  if (key === 'unlimited') return t('paywall.benefit.unlimited');
  if (key === 'noWorry') return t('paywall.benefit.noWorry');
  return t('paywall.benefit.future');
}

export default function PaywallScreen() {
  const router = useRouter();
  // 課金が使えるプラットフォームでだけ購入 UI を出す。
  // 有料化は iOS 先行で、Android は住所公開の制約が未解決のまま（`docs/フリーミアム設計.md` §6）。
  // **買えないのに購入ボタンを出すと、押した先で必ず失敗する。**
  const premiumAvailable = isEntitlementConfigured();
  const [price, setPrice] = useState<string | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [canWatchAd, setCanWatchAd] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(0);
  /**
   * ロード済みの広告。**null のあいだ広告ボタンは出さない** — 公開直後の iOS は
   * no-fill がほぼ確実で、押すと必ず失敗するボタンを出すと審査に落ちる
   * （Guideline 2.1 却下 2026-08-21）。ロードできたときだけボタンが現れる。
   */
  const [preparedAd, setPreparedAd] = useState<PreparedRewardedAd | null>(null);

  const loadAd = useCallback(async () => {
    if (!isAdRewardAvailable()) return;
    try {
      const ad = await getAdRewardProvider().loadRewardedAd();
      setPreparedAd(ad);
    } catch {
      setPreparedAd(null); // no-fill 等 — ボタンを出さないだけでエラーは出さない
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getEntitlementProvider()
      .getOffering()
      .then((offer) => {
        if (mounted) setPrice(offer?.priceString ?? null);
      })
      .catch(() => {
        if (mounted) setPrice(null);
      })
      .finally(() => {
        if (mounted) setLoadingOffer(false);
      });
    getFreemiumStatus()
      .then((status) => {
        if (mounted) {
          setCanWatchAd(status.canWatchAdForMore);
          setTokenBalance(status.tokenBalance);
        }
      })
      .catch(() => {
        if (mounted) setCanWatchAd(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (canWatchAd) void loadAd();
  }, [canWatchAd, loadAd]);

  const handleWatchAd = useCallback(async () => {
    const ad = preparedAd;
    if (!ad) return;
    setBusy(true);
    setPreparedAd(null); // 1 枚のロード済み広告は 1 回しか出せない
    try {
      const { rewarded } = await ad.show();
      if (rewarded) {
        const newBalance = await grantAdBonus();
        setTokenBalance(newBalance);
        // 直後に画面を離れるのでトーストでは見えない。通知ダイアログのまま（§7-1）
        await dialog.alert({
          title: t('paywall.thanksTitle'),
          message: tCount('paywall.adGranted', newBalance),
        });
        router.back();
        return;
      }
      void loadAd(); // 途中で閉じた — 次の 1 枚を用意する
    } catch {
      void dialog.alert({ title: t('paywall.noticeTitle'), message: t('paywall.adFailed') });
      void loadAd();
    } finally {
      setBusy(false);
    }
  }, [preparedAd, loadAd, router]);

  const handleSubscribe = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await getEntitlementProvider().purchasePremium();
      if (outcome.success) {
        await dialog.alert({ title: t('paywall.thanksTitle'), message: t('paywall.subscribed') });
        router.back();
      }
      // cancelled === true: the user backed out — stay quietly on the paywall.
    } catch (error) {
      const message =
        error instanceof EntitlementUnavailableError ? error.message : t('paywall.purchaseFailed');
      void dialog.alert({ title: t('paywall.noticeTitle'), message });
    } finally {
      setBusy(false);
    }
  }, [router]);

  const handleRestore = useCallback(async () => {
    setBusy(true);
    try {
      const restored = await getEntitlementProvider().restore();
      if (restored) {
        await dialog.alert({
          title: t('paywall.restoredTitle'),
          message: t('paywall.restoredBody'),
        });
        router.back();
      } else {
        void dialog.alert({
          title: t('paywall.noticeTitle'),
          message: t('paywall.nothingToRestore'),
        });
      }
    } catch {
      void dialog.alert({ title: t('paywall.noticeTitle'), message: t('paywall.restoreFailed') });
    } finally {
      setBusy(false);
    }
  }, [router]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel={t('common.close')}
        >
          <X size={20} color={Colors.muted} />
        </Pressable>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.crownWrap}>
          <Crown size={40} color={Colors.gold} />
        </View>
        <Text style={styles.title}>
          {premiumAvailable ? t('paywall.title') : t('paywall.freeTitle')}
        </Text>
        <Text style={styles.subtitle}>
          {tCount(
            premiumAvailable ? 'paywall.subtitle' : 'paywall.freeSubtitle',
            FREE_LIFETIME_LIMIT,
          )}
        </Text>

        {premiumAvailable && (
          <>
            <View style={styles.benefits}>
              {BENEFIT_KEYS.map((key) => (
                <View key={key} style={styles.benefitRow}>
                  <Check size={18} color={Colors.gold} />
                  <Text style={styles.benefitText}>{benefitText(key)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.priceCard}>
              {loadingOffer ? (
                <ActivityIndicator color={Colors.gold} />
              ) : (
                <>
                  <Text style={styles.priceValue}>{price ?? t('paywall.priceFallback')}</Text>
                  <Text style={styles.priceUnit}>
                    {price ? t('paywall.priceUnit') : t('paywall.priceUnitFallback')}
                  </Text>
                </>
              )}
            </View>

            <Pressable
              accessibilityRole="button"
              style={[styles.subscribeButton, busy && styles.buttonDisabled]}
              onPress={handleSubscribe}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={Colors.bg} />
              ) : (
                <Text style={styles.subscribeText}>{t('paywall.subscribe')}</Text>
              )}
            </Pressable>
          </>
        )}

        {canWatchAd && preparedAd !== null && (
          <>
            {/* 「または」は購入ボタンとの二択で初めて意味を持つ。課金が使えない
                プラットフォームでは前段が無く、接続詞だけが浮いて読めなくなる。 */}
            {premiumAvailable && <Text style={styles.orText}>{t('paywall.or')}</Text>}
            <Pressable
              accessibilityRole="button"
              style={[styles.adButton, busy && styles.buttonDisabled]}
              onPress={handleWatchAd}
              disabled={busy}
            >
              <Gift size={18} color={Colors.gold} />
              <Text style={styles.adButtonText}>{t('paywall.watchAd')}</Text>
            </Pressable>
            <Text style={styles.tokenHint}>{t('paywall.tokenHint')}</Text>
          </>
        )}
        {tokenBalance > 0 && (
          <Text style={styles.tokenBalance}>{tCount('paywall.tokenBalance', tokenBalance)}</Text>
        )}

        {/* 課金が使えないプラットフォームでは、無制限にする手段が BYOK しかない。
            無料枠が残っている間は広告ボタンも出ないので、これが無いと画面が
            本文だけの行き止まりになる（実機で確認）。 */}
        {!premiumAvailable && (
          <>
            <Pressable
              accessibilityRole="button"
              style={styles.adButton}
              onPress={() => router.replace('/(tabs)/ai-key')}
            >
              <KeyRound size={18} color={Colors.gold} />
              <Text style={styles.adButtonText}>{t('paywall.useOwnKey')}</Text>
            </Pressable>
            <Text style={styles.tokenHint}>{t('paywall.useOwnKeyHint')}</Text>
          </>
        )}

        {premiumAvailable && (
          <>
            <Pressable
              accessibilityRole="button"
              style={styles.restoreButton}
              onPress={handleRestore}
              disabled={busy}
            >
              <Text style={styles.restoreText}>{t('paywall.restore')}</Text>
            </Pressable>

            <Text style={styles.terms}>{t('paywall.terms')}</Text>

            {/* App Store の審査ガイドライン 3.1.2 は、自動更新サブスクの画面に
                利用規約とプライバシーポリシーへの**機能するリンク**を求める。
                文言だけでは足りず、リンクが無いと審査で止まる。 */}
            <View style={styles.legalLinks}>
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(EULA_URL)}>
                <Text style={styles.legalLink}>{t('paywall.eula')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
              >
                <Text style={styles.legalLink}>{t('paywall.privacyPolicy')}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
  },
  headerSpacer: { width: 20 },
  body: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingBottom: 48,
    gap: 18,
  },
  crownWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: Colors.paper,
    textAlign: 'center',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.paperDim,
    textAlign: 'center',
    lineHeight: 22,
  },
  benefits: {
    width: '100%',
    gap: 14,
    marginTop: 4,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  benefitText: {
    flex: 1,
    fontSize: 15,
    color: Colors.paper,
    lineHeight: 22,
  },
  priceCard: {
    width: '100%',
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.gold,
    backgroundColor: '#150F07',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 2,
  },
  priceValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.gold,
  },
  priceUnit: {
    fontSize: 12,
    color: Colors.paperDim,
  },
  subscribeButton: {
    width: '100%',
    backgroundColor: Colors.gold,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  subscribeText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.bg,
  },
  buttonDisabled: { opacity: 0.55 },
  orText: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
  },
  adButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.gold,
    backgroundColor: '#150F07',
    minHeight: 48,
  },
  adButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.gold,
  },
  tokenHint: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 16,
  },
  tokenBalance: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.gold,
    textAlign: 'center',
  },
  restoreButton: {
    paddingVertical: 8,
  },
  restoreText: {
    fontSize: 14,
    color: Colors.gold,
    textDecorationLine: 'underline',
  },
  terms: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 4,
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    // 区切りは記号ではなく余白で出す。中黒は日本語の文字なので英語面に持ち込めない。
    columnGap: 20,
    marginTop: 10,
  },
  legalLink: {
    fontSize: 11,
    color: Colors.gold,
    textDecorationLine: 'underline',
    // 小さい文字なので、指で押せる高さを確保する
    paddingVertical: 6,
  },
});

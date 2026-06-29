/**
 * Paywall — get more AI photo-recipes: watch a rewarded ad for one more, or
 * subscribe to premium (unlimited, ad-free). Reached when a free user has used
 * their daily quota, or from Settings.
 */
import { useRouter } from 'expo-router';
import { Check, Crown, Gift, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors } from '../../../src/constants/theme';
import { getAdRewardProvider } from '../../../src/services/ad-reward.service';
import { getEntitlementProvider } from '../../../src/services/entitlement.service';
import { EntitlementUnavailableError } from '../../../src/services/entitlement.types';
import {
  FREE_DAILY_LIMIT,
  getFreemiumStatus,
  grantAdBonus,
} from '../../../src/services/usage.service';

const BENEFITS = [
  '写真からのレシピづくりが使い放題',
  '回数の上限を気にせず、思いついたときにすぐ',
  'これからふえる便利な機能もぜんぶ',
];

export default function PaywallScreen() {
  const router = useRouter();
  const [price, setPrice] = useState<string | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [canWatchAd, setCanWatchAd] = useState(false);

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
        if (mounted) setCanWatchAd(status.canWatchAdForMore);
      })
      .catch(() => {
        if (mounted) setCanWatchAd(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleWatchAd = useCallback(async () => {
    setBusy(true);
    try {
      const { rewarded } = await getAdRewardProvider().showRewardedAd();
      if (rewarded) {
        await grantAdBonus();
        Alert.alert('ありがとうございます', '写真からのレシピづくりを 1 回ぶん追加しました。');
        router.back();
      }
    } catch {
      Alert.alert('お知らせ', '広告を読み込めませんでした。時間をおいてお試しください。');
    } finally {
      setBusy(false);
    }
  }, [router]);

  const handleSubscribe = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await getEntitlementProvider().purchasePremium();
      if (outcome.success) {
        Alert.alert(
          'ありがとうございます',
          'プレミアムになりました。写真からのレシピづくりを使い放題でお楽しみください。',
        );
        router.back();
      }
      // cancelled === true: the user backed out — stay quietly on the paywall.
    } catch (error) {
      const message =
        error instanceof EntitlementUnavailableError
          ? error.message
          : '購入を完了できませんでした。時間をおいてお試しください。';
      Alert.alert('お知らせ', message);
    } finally {
      setBusy(false);
    }
  }, [router]);

  const handleRestore = useCallback(async () => {
    setBusy(true);
    try {
      const restored = await getEntitlementProvider().restore();
      if (restored) {
        Alert.alert('復元しました', 'プレミアムが有効になりました。');
        router.back();
      } else {
        Alert.alert('お知らせ', '復元できる購入が見つかりませんでした。');
      }
    } catch {
      Alert.alert('お知らせ', '購入の復元に失敗しました。時間をおいてお試しください。');
    } finally {
      setBusy(false);
    }
  }, [router]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.muted} />
        </Pressable>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.crownWrap}>
          <Crown size={40} color={Colors.gold} />
        </View>
        <Text style={styles.title}>DAIDOKO プレミアム</Text>
        <Text style={styles.subtitle}>
          無料で使えるAI写真レシピは1日{FREE_DAILY_LIMIT}回まで。{'\n'}
          プレミアムなら、回数を気にせず使えます。
        </Text>

        <View style={styles.benefits}>
          {BENEFITS.map((benefit) => (
            <View key={benefit} style={styles.benefitRow}>
              <Check size={18} color={Colors.gold} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        <View style={styles.priceCard}>
          {loadingOffer ? (
            <ActivityIndicator color={Colors.gold} />
          ) : (
            <>
              <Text style={styles.priceValue}>{price ?? '月額サブスク'}</Text>
              <Text style={styles.priceUnit}>
                {price ? '/ 月（いつでも解約可能）' : 'いつでも解約可能'}
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
            <Text style={styles.subscribeText}>プレミアムを始める</Text>
          )}
        </Pressable>

        {canWatchAd && (
          <>
            <Text style={styles.orText}>または</Text>
            <Pressable
              accessibilityRole="button"
              style={[styles.adButton, busy && styles.buttonDisabled]}
              onPress={handleWatchAd}
              disabled={busy}
            >
              <Gift size={18} color={Colors.gold} />
              <Text style={styles.adButtonText}>広告を見て 1 回ぶん使う</Text>
            </Pressable>
          </>
        )}

        <Pressable
          accessibilityRole="button"
          style={styles.restoreButton}
          onPress={handleRestore}
          disabled={busy}
        >
          <Text style={styles.restoreText}>購入を復元する</Text>
        </Pressable>

        <Text style={styles.terms}>
          サブスクリプションは購入時に課金され、解約しない限り自動更新されます。解約はストアのアカウント設定からいつでも行えます。
        </Text>
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
});

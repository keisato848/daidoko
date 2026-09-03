/**
 * 共有の管理（設定 → データ → 共有の管理）。
 *
 * 「共有方法と、今なにが誰に共有されているのかが分かりづらい」（2026-09-03 利用者指摘）への回答。
 * 3 系統の共有 — 家族グループ / リンク公開 / 品目ごとの「自分だけ」 — を 1 画面に集約し、
 * それぞれ「誰に見えるか」を明記する。編集はここではせず、各画面へ送る
 * （帖の一覧は既存のレシピ帖管理と重複させない — 導線を 2 つ持つと案内が腐る）。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Link2, Share2, Trash2, Users } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import { dialog } from '../../src/services/dialog.service';
import { getShareStatus, type ShareStatus } from '../../src/services/share-status.service';
import {
  renewWebShare,
  revokeWebShare,
  type WebShareRecipeListItem,
} from '../../src/services/web-share.service';

export default function ShareStatusScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ShareStatus | null>(null);

  const load = useCallback(async () => {
    setStatus(await getShareStatus());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleResend = async (item: WebShareRecipeListItem) => {
    // 受け取り期限を張り直してから送る（§3-6・ベストエフォート）
    void renewWebShare(item.recipeId);
    try {
      await Share.share({
        message: `${item.title ?? t('settings.shareStatus.deletedRecipe')}\n${item.record.url}`,
      });
    } catch {
      // 共有シートのキャンセルは無視
    }
  };

  const handleStop = async (item: WebShareRecipeListItem) => {
    const confirmed = await dialog.confirm({
      title: t('settings.shareStatus.stopTitle'),
      message: t('settings.shareStatus.stopConfirm'),
      confirmLabel: t('settings.shareStatus.stopAction'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await revokeWebShare(item.recipeId);
      await load();
    } catch {
      void dialog.alert({
        title: t('settings.shareStatus.stopTitle'),
        message: t('settings.shareStatus.stopFailed'),
      });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.shareStatus.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>
      {status && (
        <ScrollView contentContainerStyle={styles.list}>
          {/* ── 家族グループ ── */}
          <Text style={styles.sectionLabel}>{t('settings.shareStatus.familySection')}</Text>
          <Pressable style={styles.card} onPress={() => router.push('/(tabs)/family')}>
            <Users size={18} color={Colors.gold} />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>
                {status.familyJoined
                  ? t('settings.shareStatus.familyJoined')
                  : t('settings.shareStatus.familyNotJoined')}
              </Text>
              <Text style={styles.cardMeta}>
                {status.familyJoined
                  ? t('settings.shareStatus.familyJoinedNote')
                  : t('settings.shareStatus.familyNotJoinedNote')}
              </Text>
            </View>
            <ChevronRight size={16} color={Colors.muted} />
          </Pressable>
          <Text style={styles.scopeNote}>{t('settings.shareStatus.familyScope')}</Text>

          {/* ── リンクで公開中 ── */}
          <Text style={styles.sectionLabel}>{t('settings.shareStatus.linkSection')}</Text>
          <Text style={styles.scopeNote}>{t('settings.shareStatus.linkScope')}</Text>
          {status.sharedRecipes.length === 0 && status.sharedBookCount === 0 && (
            <Text style={styles.emptyBody}>{t('settings.shareStatus.linkEmpty')}</Text>
          )}
          {status.sharedRecipes.map((item) => (
            <View key={item.recipeId} style={styles.card}>
              <Link2 size={16} color={Colors.goldDim} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title ?? t('settings.shareStatus.deletedRecipe')}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {item.record.url}
                </Text>
              </View>
              <Pressable
                onPress={() => void handleResend(item)}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel={t('settings.shareStatus.resend')}
              >
                <Share2 size={18} color={Colors.gold} />
              </Pressable>
              <Pressable
                onPress={() => void handleStop(item)}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel={t('settings.shareStatus.stopAction')}
              >
                <Trash2 size={18} color={Colors.muted} />
              </Pressable>
            </View>
          ))}
          {status.sharedBookCount > 0 && (
            <Pressable style={styles.card} onPress={() => router.push('/(tabs)/web-shares')}>
              <Link2 size={16} color={Colors.goldDim} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>
                  {tCount('settings.shareStatus.sharedBooks', status.sharedBookCount)}
                </Text>
                <Text style={styles.cardMeta}>{t('settings.shareStatus.sharedBooksNote')}</Text>
              </View>
              <ChevronRight size={16} color={Colors.muted} />
            </Pressable>
          )}

          {/* ── 自分だけの品目 ── */}
          <Text style={styles.sectionLabel}>{t('settings.shareStatus.privateSection')}</Text>
          <Text style={styles.scopeNote}>{t('settings.shareStatus.privateScope')}</Text>
          <Pressable style={styles.card} onPress={() => router.push('/(tabs)/shopping')}>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>
                {tCount('settings.shareStatus.privateShopping', status.privateShoppingCount)}
              </Text>
            </View>
            <ChevronRight size={16} color={Colors.muted} />
          </Pressable>
          <Pressable style={styles.card} onPress={() => router.push('/(tabs)/pantry')}>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>
                {tCount('settings.shareStatus.privatePantry', status.privatePantryCount)}
              </Text>
            </View>
            <ChevronRight size={16} color={Colors.muted} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  backButton: { padding: 8 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '500',
    color: Colors.paper,
  },
  headerSpacer: { width: 36 },
  list: { padding: 16, paddingBottom: 32, gap: 10 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.goldDim,
    marginTop: 14,
    letterSpacing: 1,
  },
  scopeNote: { fontSize: 12, color: Colors.paperDim, lineHeight: 18 },
  emptyBody: { fontSize: 13, color: Colors.muted, paddingVertical: 6 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.paper },
  cardMeta: { fontSize: 12, color: Colors.paperDim },
  iconBtn: { padding: 6 },
});

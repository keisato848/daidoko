/**
 * 在庫で作れるレシピ（P4）— 在庫画面から開く。
 * 各レシピの在庫充足率（在庫にある材料 / 全材料）でランキング表示。
 * 開いた時に未解決の在庫名を AI で名寄せ（無料枠内・広告で拡張）してから照合。
 * docs/買い物リスト・在庫設計.md §5.4 / §6
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Sparkles, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { GroupChips } from '../src/components/GroupChips';
import { Colors } from '../src/constants/theme';
import { t, tCount } from '../src/i18n';
import { getAdRewardProvider, isAdRewardAvailable } from '../src/services/ad-reward.service';
import type { PreparedRewardedAd } from '../src/services/ad-reward.types';
import { getCookableRecipes, type CookableRecipe } from '../src/services/cookable.service';
import { getAppMeta, setAppMeta } from '../src/services/app-meta.service';
import { grantResolveAdBonus, resolveUnmatchedNames } from '../src/services/name-resolve.service';
import { getPantryGroups, UNGROUPED } from '../src/services/pantry.service';

/** 直前に選んだ絞り込みを覚えておく（毎回「冷蔵庫」を選び直させない） */
const GROUP_FILTER_KEY = 'cookable_group_filter';

export default function CookableScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<CookableRecipe[]>([]);
  const [resolving, setResolving] = useState(false);
  const [adRemaining, setAdRemaining] = useState<number | null>(null);
  /** ロード済みの広告。null のあいだバナーは出さない（押すと失敗するボタンを出さない） */
  const [preparedAd, setPreparedAd] = useState<PreparedRewardedAd | null>(null);

  const loadAd = useCallback(async () => {
    if (!isAdRewardAvailable()) return;
    try {
      setPreparedAd(await getAdRewardProvider().loadRewardedAd());
    } catch {
      setPreparedAd(null);
    }
  }, []);
  const [groups, setGroups] = useState<string[]>([]);
  /** null = すべての置き場所から探す */
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [filterLoaded, setFilterLoaded] = useState(false);

  // 覚えている絞り込みを復元してから照合する（復元前に「すべて」で走らせない）
  useEffect(() => {
    let mounted = true;
    Promise.all([
      getPantryGroups().catch((): string[] => []),
      getAppMeta(GROUP_FILTER_KEY).catch(() => null),
    ])
      .then(([names, saved]) => {
        if (!mounted) return;
        setGroups(names);
        // 消えたグループを覚えたままだと 0 件の画面から抜けられない
        if (saved && (saved === UNGROUPED || names.includes(saved))) setGroupFilter(saved);
        setFilterLoaded(true);
      })
      .catch(() => {
        if (mounted) setFilterLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectGroup = useCallback((group: string | null) => {
    setGroupFilter(group);
    void setAppMeta(GROUP_FILTER_KEY, group ?? '').catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setRecipes(await getCookableRecipes(groupFilter ? [groupFilter] : undefined));
    } catch {
      setRecipes([]);
    }
  }, [groupFilter]);

  const autoResolve = useCallback(async () => {
    setResolving(true);
    try {
      const result = await resolveUnmatchedNames();
      if (result.resolved > 0) await refresh();
      setAdRemaining(result.canWatchAd ? result.remaining : null);
      if (result.canWatchAd && result.remaining > 0) void loadAd();
    } catch {
      setAdRemaining(null);
    } finally {
      setResolving(false);
    }
  }, [refresh, loadAd]);

  useFocusEffect(
    useCallback(() => {
      if (!filterLoaded) return;
      let active = true;
      void (async () => {
        await refresh();
        if (active) await autoResolve();
      })();
      return () => {
        active = false;
      };
    }, [filterLoaded, refresh, autoResolve]),
  );

  const handleWatchAd = useCallback(async () => {
    const ad = preparedAd;
    if (!ad) return;
    setPreparedAd(null);
    try {
      const { rewarded } = await ad.show();
      if (rewarded) {
        await grantResolveAdBonus();
        await autoResolve(); // 成功すれば autoResolve が次の 1 枚をロードする
        return;
      }
      void loadAd();
    } catch {
      // ignore — matching still works with what is already resolved
      void loadAd();
    }
  }, [preparedAd, loadAd, autoResolve]);

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
        <Text style={styles.headerTitle}>{t('pantry.cookable.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <GroupChips
        groups={groups}
        selected={groupFilter}
        onSelect={handleSelectGroup}
        allLabel={t('pantry.group.all')}
        ungroupedLabel={t('pantry.group.ungrouped')}
        ungroupedValue={UNGROUPED}
      />

      {resolving && (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color={Colors.gold} />
          <Text style={styles.bannerText}>{t('pantry.cookable.matching')}</Text>
        </View>
      )}
      {!resolving && adRemaining != null && adRemaining > 0 && preparedAd !== null && (
        <Pressable
          style={styles.banner}
          onPress={handleWatchAd}
          accessibilityLabel={t('pantry.cookable.watchAd')}
        >
          <Sparkles size={16} color={Colors.gold} />
          <Text style={styles.bannerText}>
            {tCount('pantry.cookable.watchAdRemaining', adRemaining)}
          </Text>
        </Pressable>
      )}

      <FlatList
        data={recipes}
        keyExtractor={(item) => item.recipeId}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>{t('pantry.cookable.empty')}</Text>}
        renderItem={({ item }) => {
          const full = item.total > 0 && item.inStock === item.total;
          return (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/(tabs)/recipes/${item.recipeId}`)}
            >
              <View style={styles.rowTop}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.fraction, full && styles.fractionFull]}>
                  {full ? t('pantry.cookable.ready') : `${item.inStock}/${item.total}`}
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.round(item.coverage * 100)}%` }]} />
              </View>
              {!full && item.missing.length > 0 && (
                <Text style={styles.missing} numberOfLines={1}>
                  {tCount('pantry.cookable.missing', item.missing.length)}
                  {item.missing.slice(0, 4).join(t('common.listSeparator'))}
                </Text>
              )}
            </Pressable>
          );
        }}
      />
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
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 15, fontWeight: '500', color: Colors.paper, letterSpacing: 0.5 },
  headerSpacer: { width: 20 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#150F07',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  bannerText: { fontSize: 13, color: Colors.gold },
  listContent: { paddingHorizontal: 20, paddingVertical: 8 },
  empty: { color: Colors.muted, textAlign: 'center', marginTop: 48, lineHeight: 22, fontSize: 14 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontSize: 15, color: Colors.paper },
  fraction: { fontSize: 13, color: Colors.paperDim },
  fractionFull: { color: Colors.gold, fontWeight: '600' },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: '#2A2114', overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: Colors.gold },
  missing: { fontSize: 12, color: Colors.muted },
});

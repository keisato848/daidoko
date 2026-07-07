/**
 * S01: Home / Timeline screen
 * Shows the want-to-cook shelf (pinned recipes), monthly stats, and recent
 * cooking logs with filter tabs
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Bookmark, CalendarDays, LayoutGrid, ShoppingCart, Trash2, X } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { CoachMarkOverlay } from '../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../src/components/HelpButton';
import { EmptyState } from '../../src/components/EmptyState';
import { Loading } from '../../src/components/Loading';
import { MonthlyStats } from '../../src/components/MonthlyStats';
import { PressableScale } from '../../src/components/PressableScale';
import { Stars } from '../../src/components/Stars';
import { Colors } from '../../src/constants/theme';
import { useCoachMarks } from '../../src/hooks/useCoachMarks';
import { deleteCookingLog } from '../../src/services/cooking-log.service';
import { getWantToCookRecipes } from '../../src/services/recipe.service';
import { getTimeline } from '../../src/services/timeline.service';
import type { RecipeListItem, TimelineEntry } from '../../src/services/types';
import { formatProfileDisplayName } from '../../src/utils/profile';
import { computeMonthlyStats } from '../../src/utils/timelineStats';

type FilterTab = 'week' | 'month' | 'all';

const FILTER_LABELS: Record<FilterTab, string> = {
  week: '今週',
  month: '今月',
  all: 'すべて',
};

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return `${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
}

function getFilterDate(filter: FilterTab): Date | null {
  const now = new Date();
  if (filter === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return weekAgo;
  }
  if (filter === 'month') {
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    return monthAgo;
  }
  return null;
}

export default function HomeScreen() {
  const router = useRouter();
  const [allEntries, setAllEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 初回利用ガイド（コーチマーク）
  const cartRef = useRef<View>(null);
  const fabRef = useRef<View>(null);
  const coach = useCoachMarks(
    'home',
    [
      {
        key: 'fab',
        title: '記録もレシピもここから',
        text: '作った料理の記録や、レシピの追加（手入力・URL取り込み・写真からAI作成）は「＋」から始めます。',
        ref: fabRef,
      },
      {
        key: 'cart',
        title: '買い物リストと在庫',
        text: '買い物リスト・家の在庫・レシート読み取り・「この在庫で作れるレシピ」はこのカートから。',
        ref: cartRef,
      },
    ],
    !loading && !selectMode,
  );

  const [wantList, setWantList] = useState<RecipeListItem[]>([]);

  const loadTimeline = useCallback(async () => {
    const [entries, want] = await Promise.all([getTimeline(), getWantToCookRecipes()]);
    setAllEntries(entries);
    setWantList(want);
    setLoading(false);
  }, []);

  const entries = useMemo(() => {
    const filterDate = getFilterDate(filter);
    return filterDate ? allEntries.filter((l) => new Date(l.cookedAt) >= filterDate) : allEntries;
  }, [allEntries, filter]);

  const monthlyStats = useMemo(() => computeMonthlyStats(allEntries), [allEntries]);
  const monthLabel = `${new Date().getMonth() + 1}月`;

  useFocusEffect(
    useCallback(() => {
      void loadTimeline();
    }, [loadTimeline]),
  );

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(entries.map((entry) => entry.id)));
  }, [entries]);

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;

    Alert.alert(
      '調理ログを削除',
      `${count}件の調理ログを削除しますか？この操作は取り消せません。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            await Promise.all([...selectedIds].map((id) => deleteCookingLog(id)));
            exitSelectMode();
            await loadTimeline();
          },
        },
      ],
    );
  }, [selectedIds, exitSelectMode, loadTimeline]);

  const renderItem = ({ item, index }: { item: TimelineEntry; index: number }) => {
    const showDateHeader =
      index === 0 || formatDate(entries[index - 1].cookedAt) !== formatDate(item.cookedAt);
    const isSelected = selectedIds.has(item.id);
    const userName = formatProfileDisplayName(item.userName);

    return (
      <View>
        {showDateHeader && <Text style={styles.dateHeader}>{formatDate(item.cookedAt)}</Text>}
        <PressableScale
          style={[styles.card, isSelected && styles.cardSelected]}
          onPress={() => {
            if (selectMode) {
              toggleSelect(item.id);
            } else if (item.recipeId) {
              router.push(`/(tabs)/recipes/${item.recipeId}`);
            }
          }}
          onLongPress={() => {
            if (!selectMode) {
              setSelectMode(true);
              setSelectedIds(new Set([item.id]));
            }
          }}
        >
          {selectMode && (
            <View style={[styles.checkBadge, isSelected && styles.checkBadgeSelected]}>
              {isSelected && <Text style={styles.checkMark}>✓</Text>}
            </View>
          )}
          <View style={styles.cardRow}>
            {item.photos.length > 0 && (
              <Image
                source={{ uri: item.photos[0].cloudUrl ?? item.photos[0].localPath }}
                style={styles.thumbnail}
              />
            )}
            <View style={styles.cardContent}>
              <View style={styles.cardHeader}>
                <Text style={styles.recipeTitle} numberOfLines={1}>
                  {item.recipeTitle}
                </Text>
                {item.rating != null && <Stars rating={item.rating} size={12} />}
              </View>
              <View style={styles.cardUser}>
                <Avatar name={userName} size={22} />
                <Text style={styles.userName}>{userName}</Text>
              </View>
              {item.memo ? (
                <Text style={styles.memo} numberOfLines={1}>
                  &quot;{item.memo}&quot;
                </Text>
              ) : null}
            </View>
          </View>
        </PressableScale>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {selectMode ? (
        <View style={styles.selectHeader}>
          <Pressable style={styles.selectCancelBtn} onPress={exitSelectMode}>
            <X size={18} color={Colors.paper} />
          </Pressable>
          <Text style={styles.selectCount}>{selectedIds.size}件選択中</Text>
          <Pressable style={styles.selectAllBtn} onPress={handleSelectAll}>
            <Text style={styles.selectAllText}>すべて選択</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.filterBar}>
          <View style={styles.tabs}>
            {(Object.keys(FILTER_LABELS) as FilterTab[]).map((key) => (
              <Pressable key={key} onPress={() => setFilter(key)}>
                <Text style={[styles.tab, filter === key ? styles.tabActive : styles.tabInactive]}>
                  {FILTER_LABELS[key]}
                </Text>
                {filter === key && <View style={styles.tabIndicator} />}
              </Pressable>
            ))}
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/calendar')}
              hitSlop={10}
              accessibilityLabel="カレンダー"
            >
              <CalendarDays size={19} color={Colors.goldDim} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/gallery')}
              hitSlop={10}
              accessibilityLabel="ギャラリー"
            >
              <LayoutGrid size={19} color={Colors.goldDim} />
            </Pressable>
            <Pressable
              ref={cartRef}
              collapsable={false}
              onPress={() => router.push('/(tabs)/shopping')}
              hitSlop={10}
              accessibilityLabel="買い物リスト"
            >
              <ShoppingCart size={19} color={Colors.goldDim} />
            </Pressable>
            <HelpButton onPress={coach.show} size={19} />
          </View>
        </View>
      )}

      {loading ? (
        <Loading message="調理記録を読み込んでいます" />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            selectMode && styles.listWithActionBar,
            entries.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            !selectMode && (wantList.length > 0 || monthlyStats.count > 0) ? (
              <View>
                {wantList.length > 0 && (
                  <View style={styles.wantSection}>
                    <View style={styles.wantHeader}>
                      <Bookmark size={13} color={Colors.goldDim} fill={Colors.goldDim} />
                      <Text style={styles.wantTitle}>つくりたい</Text>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.wantRow}
                    >
                      {wantList.map((recipe) => (
                        <PressableScale
                          key={recipe.id}
                          style={styles.wantCard}
                          onPress={() => router.push(`/(tabs)/recipes/${recipe.id}`)}
                        >
                          {recipe.heroPhotoUri ? (
                            <Image source={{ uri: recipe.heroPhotoUri }} style={styles.wantThumb} />
                          ) : (
                            <View style={[styles.wantThumb, styles.wantThumbPlaceholder]}>
                              <Text style={styles.wantEmoji}>🍽️</Text>
                            </View>
                          )}
                          <Text style={styles.wantCardTitle} numberOfLines={2}>
                            {recipe.title}
                          </Text>
                        </PressableScale>
                      ))}
                    </ScrollView>
                  </View>
                )}
                {monthlyStats.count > 0 && (
                  <MonthlyStats stats={monthlyStats} monthLabel={monthLabel} />
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={filter === 'all' ? '🍳' : '🗓'}
              title={
                filter === 'all'
                  ? 'まだ調理記録がありません'
                  : `${FILTER_LABELS[filter]}の記録がありません`
              }
              message={
                filter === 'all'
                  ? '料理をつくったら「＋」から記録しましょう。家族の記録もここに並びます。'
                  : '別の期間を選ぶか、新しく記録を追加してみましょう。'
              }
              actionLabel={filter === 'all' ? '記録を追加' : undefined}
              onAction={filter === 'all' ? () => router.push('/(tabs)/add') : undefined}
            />
          }
        />
      )}

      {selectMode ? (
        <View style={styles.actionBar}>
          <Pressable
            style={[
              styles.actionBtn,
              styles.actionBtnDelete,
              selectedIds.size === 0 && styles.actionBtnDisabled,
            ]}
            onPress={handleBulkDelete}
            disabled={selectedIds.size === 0}
          >
            <Trash2 size={16} color={selectedIds.size === 0 ? Colors.muted : Colors.bg} />
            <Text
              style={[styles.actionBtnText, selectedIds.size === 0 && styles.actionBtnTextDisabled]}
            >
              削除
            </Text>
          </Pressable>
        </View>
      ) : (
        <View ref={fabRef} collapsable={false} style={styles.fabContainer}>
          <PressableScale
            style={styles.fab}
            scaleTo={0.9}
            onPress={() => router.push('/(tabs)/add')}
          >
            <Text style={styles.fabText}>＋</Text>
          </PressableScale>
        </View>
      )}

      <CoachMarkOverlay
        visible={coach.visible}
        step={coach.step}
        index={coach.index}
        total={coach.total}
        onNext={coach.next}
        onSkip={coach.skip}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    paddingBottom: 8,
    fontSize: 13, // sm: フィルタータブ
    fontWeight: '400',
  },
  tabActive: {
    color: Colors.gold,
  },
  tabInactive: {
    color: Colors.muted,
  },
  tabIndicator: {
    height: 2,
    backgroundColor: Colors.gold,
    marginTop: -1,
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 80,
  },
  listWithActionBar: {
    paddingBottom: 104,
  },
  listEmpty: {
    flexGrow: 1,
  },
  dateHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
    fontSize: 12, // xs: タイムスタンプ・日付ヘッダー
    color: Colors.paperDim,
    letterSpacing: 2,
  },
  wantSection: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  wantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  wantTitle: {
    fontSize: 12, // xs: セクション見出し
    color: Colors.goldDim,
    letterSpacing: 2,
  },
  wantRow: {
    paddingHorizontal: 16,
    gap: 10,
  },
  wantCard: {
    width: 108,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 8,
    gap: 6,
  },
  wantThumb: {
    width: '100%',
    height: 64,
    borderRadius: 6,
    backgroundColor: '#1A1108',
  },
  wantThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wantEmoji: {
    fontSize: 26,
  },
  wantCardTitle: {
    fontSize: 12, // xs: カードタイトル（コンパクト）
    fontWeight: '400',
    color: Colors.paper,
    lineHeight: 16,
  },
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 14,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardSelected: {
    borderColor: Colors.gold,
    borderWidth: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#1A1108',
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.muted,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadgeSelected: {
    borderColor: Colors.gold,
    backgroundColor: Colors.gold,
  },
  checkMark: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.bg,
    lineHeight: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recipeTitle: {
    color: Colors.paper,
    fontSize: 15, // base: カードタイトル
    fontWeight: '500',
  },
  cardUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  userName: {
    fontSize: 13, // sm: ユーザー名
    color: Colors.paperDim,
    fontWeight: '400',
  },
  memo: {
    fontSize: 13, // sm: メモ
    color: Colors.goldDim,
    fontStyle: 'italic',
    marginTop: 2,
  },
  selectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  selectCancelBtn: {
    padding: 4,
  },
  selectCount: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.paper,
  },
  selectAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 12,
    paddingBottom: 28,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionBtnDelete: {
    backgroundColor: '#7A1F1F',
  },
  actionBtnDisabled: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.bg,
  },
  actionBtnTextDisabled: {
    color: Colors.muted,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  fabText: {
    fontSize: 24,
    color: Colors.bg,
  },
});

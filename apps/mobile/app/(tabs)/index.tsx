/**
 * S01: Home / Timeline screen
 * Shows recent cooking logs with filter tabs
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Trash2, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { Stars } from '../../src/components/Stars';
import { Colors } from '../../src/constants/theme';
import { deleteCookingLog } from '../../src/services/cooking-log.service';
import { getTimeline } from '../../src/services/timeline.service';
import type { TimelineEntry } from '../../src/services/types';

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
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadTimeline = useCallback(async () => {
    const all = await getTimeline();
    const filterDate = getFilterDate(filter);
    const filtered = filterDate ? all.filter((l) => new Date(l.cookedAt) >= filterDate) : all;
    setEntries(filtered);
  }, [filter]);

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

    return (
      <View>
        {showDateHeader && <Text style={styles.dateHeader}>{formatDate(item.cookedAt)}</Text>}
        <Pressable
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
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <Text style={styles.recipeTitle}>{item.recipeTitle}</Text>
              {item.rating != null && <Stars rating={item.rating} size={12} />}
            </View>
            <View style={styles.cardUser}>
              <Avatar name={item.userName} size={22} />
              <Text style={styles.userName}>{item.userName}</Text>
            </View>
            {item.memo ? (
              <Text style={styles.memo} numberOfLines={1}>
                &quot;{item.memo}&quot;
              </Text>
            ) : null}
          </View>
        </Pressable>
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
          <Text style={styles.wordmark}>DAIDOKO</Text>
        </View>
      )}

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, selectMode && styles.listWithActionBar]}
        showsVerticalScrollIndicator={false}
      />

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
        <Pressable style={styles.fab} onPress={() => router.push('/(tabs)/add')}>
          <Text style={styles.fabText}>＋</Text>
        </Pressable>
      )}
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
  wordmark: {
    fontStyle: 'italic',
    fontSize: 9, // wordmark: 意図的な最小表示
    color: Colors.muted,
    letterSpacing: 4,
    paddingBottom: 8,
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 80,
  },
  listWithActionBar: {
    paddingBottom: 104,
  },
  dateHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
    fontSize: 12, // xs: タイムスタンプ・日付ヘッダー
    color: Colors.paperDim,
    letterSpacing: 2,
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
  cardContent: {
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
  fab: {
    position: 'absolute',
    bottom: 16,
    right: 16,
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

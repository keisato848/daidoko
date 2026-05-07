/**
 * S01: Home / Timeline screen
 * Shows recent cooking logs with filter tabs
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { Stars } from '../../src/components/Stars';
import { Colors } from '../../src/constants/theme';
import { isNativePlatform } from '../../src/db/client';
import { getMockTimeline } from '../../src/db/mock';

interface TimelineEntry {
  id: string;
  recipeId: string | null;
  recipeTitle: string;
  userName: string;
  cookedAt: string;
  rating: number | null;
  memo: string | null;
}

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

async function loadFromDb(): Promise<TimelineEntry[]> {
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../../src/db/client');
  const schema = await import('../../src/db/schema');
  const db = getDb();

  const logs = await db
    .select({
      id: schema.cookingLogs.id,
      recipeId: schema.cookingLogs.recipeId,
      recipeTitle: schema.recipes.title,
      userName: schema.users.displayName,
      cookedAt: schema.cookingLogs.cookedAt,
      rating: schema.cookingLogs.rating,
      memo: schema.cookingLogs.memo,
    })
    .from(schema.cookingLogs)
    .leftJoin(schema.recipes, eq(schema.cookingLogs.recipeId, schema.recipes.id))
    .leftJoin(schema.users, eq(schema.cookingLogs.cookedBy, schema.users.id))
    .orderBy(schema.cookingLogs.cookedAt);

  return logs
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt))
    .map((l) => ({
      id: l.id,
      recipeId: l.recipeId,
      recipeTitle: l.recipeTitle ?? 'フリー記録',
      userName: l.userName ?? '不明',
      cookedAt: l.cookedAt,
      rating: l.rating,
      memo: l.memo,
    }));
}

export default function HomeScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [filter, setFilter] = useState<FilterTab>('all');

  const loadTimeline = useCallback(async () => {
    let all: TimelineEntry[];

    if (isNativePlatform) {
      all = await loadFromDb();
    } else {
      all = getMockTimeline();
    }

    const filterDate = getFilterDate(filter);
    const filtered = filterDate ? all.filter((l) => new Date(l.cookedAt) >= filterDate) : all;

    setEntries(filtered);
  }, [filter]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  const renderItem = ({ item, index }: { item: TimelineEntry; index: number }) => {
    const showDateHeader =
      index === 0 || formatDate(entries[index - 1].cookedAt) !== formatDate(item.cookedAt);

    return (
      <View>
        {showDateHeader && <Text style={styles.dateHeader}>{formatDate(item.cookedAt)}</Text>}
        <Pressable
          style={styles.card}
          onPress={() => {
            if (item.recipeId) {
              router.push(`/(tabs)/recipes/${item.recipeId}`);
            }
          }}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <Text style={styles.recipeTitle}>{item.recipeTitle}</Text>
              {item.rating != null && <Stars rating={item.rating} size={10} />}
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
      {/* Filter tabs + DAIDOKO wordmark */}
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

      {/* Timeline list */}
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <Pressable style={styles.fab} onPress={() => router.push('/(tabs)/add')}>
        <Text style={styles.fabText}>＋</Text>
      </Pressable>
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
    fontSize: 12,
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
    fontSize: 9,
    color: Colors.muted,
    letterSpacing: 4,
    paddingBottom: 8,
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 80,
  },
  dateHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
    fontSize: 10,
    color: Colors.muted,
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
  cardContent: {
    gap: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recipeTitle: {
    color: Colors.paper,
    fontSize: 14,
    fontWeight: '500',
  },
  cardUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  userName: {
    fontSize: 11,
    color: Colors.muted,
  },
  memo: {
    fontSize: 11,
    color: Colors.goldDim,
    fontStyle: 'italic',
    marginTop: 2,
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

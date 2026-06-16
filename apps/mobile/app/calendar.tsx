/**
 * Cooking-log Calendar view (R12 / 利用フロー §5)
 * Monthly grid marking days that have cooking logs. Tap a day to see its logs.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../src/components/Avatar';
import { Loading } from '../src/components/Loading';
import { PressableScale } from '../src/components/PressableScale';
import { Stars } from '../src/components/Stars';
import { Colors, Typography } from '../src/constants/theme';
import { getTimeline } from '../src/services/timeline.service';
import type { TimelineEntry } from '../src/services/types';
import {
  buildMonthMatrix,
  groupEntriesByDay,
  localDayKey,
  WEEKDAY_LABELS,
} from '../src/utils/calendar';
import { formatProfileDisplayName } from '../src/utils/profile';

export default function CalendarScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState<string>(() => localDayKey(new Date()));

  const load = useCallback(async () => {
    setEntries(await getTimeline());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const byDay = useMemo(() => groupEntriesByDay(entries), [entries]);
  const weeks = useMemo(() => buildMonthMatrix(cursor.year, cursor.month), [cursor]);
  const selectedLogs = byDay.get(selectedKey) ?? [];

  const goMonth = (delta: number) => {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const monthLabel = `${cursor.year}年${cursor.month + 1}月`;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <X size={20} color={Colors.muted} />
          </Pressable>
          <Text style={styles.headerTitle}>カレンダー</Text>
          <View style={styles.headerSpacer} />
        </View>
        <Loading message="調理記録を読み込んでいます" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>カレンダー</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.monthBar}>
        <Pressable onPress={() => goMonth(-1)} hitSlop={12} accessibilityLabel="前の月">
          <ChevronLeft size={22} color={Colors.gold} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable onPress={() => goMonth(1)} hitSlop={12} accessibilityLabel="次の月">
          <ChevronRight size={22} color={Colors.gold} />
        </Pressable>
      </View>

      <View style={styles.weekHeader}>
        {WEEKDAY_LABELS.map((w) => (
          <Text key={w} style={styles.weekHeaderCell}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {weeks.map((week, wi) => (
          <View key={wi} style={styles.week}>
            {week.map((cell) => {
              const count = byDay.get(cell.key)?.length ?? 0;
              const isSelected = cell.key === selectedKey;
              return (
                <Pressable
                  key={cell.key}
                  style={styles.cell}
                  onPress={() => setSelectedKey(cell.key)}
                >
                  <View style={[styles.cellInner, isSelected && styles.cellSelected]}>
                    <Text
                      style={[
                        styles.cellDay,
                        !cell.inMonth && styles.cellDayMuted,
                        isSelected && styles.cellDaySelected,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                  {count > 0 && <View style={styles.dot} />}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.dayHeader}>
        <Text style={styles.dayHeaderText}>{selectedKey.replace(/-/g, '/')}</Text>
        <Text style={styles.dayHeaderCount}>{selectedLogs.length}件</Text>
      </View>

      <ScrollView contentContainerStyle={styles.logList}>
        {selectedLogs.length === 0 ? (
          <Text style={styles.emptyDay}>この日の調理記録はありません</Text>
        ) : (
          selectedLogs.map((log) => {
            const userName = formatProfileDisplayName(log.userName);
            return (
              <PressableScale
                key={log.id}
                style={styles.logCard}
                onPress={() => {
                  if (log.recipeId) router.push(`/(tabs)/recipes/${log.recipeId}`);
                }}
              >
                <View style={styles.logHeader}>
                  <Text style={styles.logTitle} numberOfLines={1}>
                    {log.recipeTitle}
                  </Text>
                  {log.rating != null && <Stars rating={log.rating} size={12} />}
                </View>
                <View style={styles.logUser}>
                  <Avatar name={userName} size={20} />
                  <Text style={styles.logUserName}>{userName}</Text>
                </View>
                {log.memo ? (
                  <Text style={styles.logMemo} numberOfLines={1}>
                    &quot;{log.memo}&quot;
                  </Text>
                ) : null}
              </PressableScale>
            );
          })
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
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.paper,
    letterSpacing: 0.5,
  },
  headerSpacer: { width: 20 },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  monthLabel: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.paper,
    letterSpacing: 1,
  },
  weekHeader: {
    flexDirection: 'row',
    paddingHorizontal: 8,
  },
  weekHeaderCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.size.xs,
    color: Colors.muted,
    paddingVertical: 4,
  },
  grid: {
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 8,
  },
  week: { flexDirection: 'row' },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    gap: 3,
  },
  cellInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: {
    backgroundColor: Colors.gold,
  },
  cellDay: {
    fontSize: Typography.size.sm,
    color: Colors.paper,
  },
  cellDayMuted: {
    color: Colors.muted,
  },
  cellDaySelected: {
    color: Colors.bg,
    fontWeight: Typography.weight.semibold,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.gold,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  dayHeaderText: {
    fontSize: Typography.size.sm,
    color: Colors.paperDim,
    letterSpacing: 1,
  },
  dayHeaderCount: {
    fontSize: Typography.size.xs,
    color: Colors.goldDim,
  },
  logList: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 8,
  },
  emptyDay: {
    fontSize: Typography.size.sm,
    color: Colors.muted,
    textAlign: 'center',
    paddingVertical: 28,
  },
  logCard: {
    padding: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logTitle: {
    flex: 1,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.paper,
  },
  logUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logUserName: {
    fontSize: Typography.size.sm,
    color: Colors.paperDim,
  },
  logMemo: {
    fontSize: Typography.size.sm,
    color: Colors.goldDim,
    fontStyle: 'italic',
  },
});

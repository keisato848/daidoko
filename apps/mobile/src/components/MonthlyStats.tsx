/**
 * Home screen "月の統計" summary strip (S03)
 * Compact this-month cooking summary shown above the timeline.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import type { MonthlyStats as MonthlyStatsData } from '../utils/timelineStats';

interface MonthlyStatsProps {
  stats: MonthlyStatsData;
  monthLabel: string;
}

export function MonthlyStats({ stats, monthLabel }: MonthlyStatsProps) {
  return (
    <View style={styles.container} testID="monthly-stats">
      <Text style={styles.month}>{monthLabel}</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.value}>{stats.count}</Text>
          <Text style={styles.unit}>回</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.metric}>
          <Text style={styles.value}>{stats.dishes}</Text>
          <Text style={styles.unit}>品</Text>
        </View>
        {stats.avgRating != null && (
          <>
            <View style={styles.divider} />
            <View style={styles.metric}>
              <Text style={styles.star}>★</Text>
              <Text style={styles.value}>{stats.avgRating.toFixed(1)}</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  month: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.regular,
    color: Colors.paperDim,
    letterSpacing: 2,
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  value: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.gold,
  },
  unit: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.regular,
    color: Colors.paperDim,
  },
  star: {
    fontSize: Typography.size.sm,
    color: Colors.gold,
  },
  divider: {
    width: 1,
    height: 16,
    backgroundColor: Colors.border,
  },
});

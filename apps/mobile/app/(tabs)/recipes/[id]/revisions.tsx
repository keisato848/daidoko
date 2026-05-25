/**
 * S13: Recipe Version History
 * Lists all RecipeRevisions for a recipe in reverse chronological order.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../../../../src/constants/theme';
import { getRecipeDetail, getRecipeRevisions } from '../../../../src/services/recipe.service';
import type { RecipeRevisionSummary } from '../../../../src/services/types';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export default function RevisionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [revisions, setRevisions] = useState<RecipeRevisionSummary[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);

  const loadRevisions = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [detail, nextRevisions] = await Promise.all([
      getRecipeDetail(id),
      getRecipeRevisions(id),
    ]);
    if (!detail) {
      setTitle('');
      setRevisions([]);
      setLoading(false);
      return;
    }
    setTitle(detail.title);
    setRevisions(nextRevisions);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void loadRevisions();
  }, [loadRevisions]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
          <Text style={styles.backText}>戻る</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title} — 版履歴
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <Text style={styles.mutedText}>読み込み中...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {revisions.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.mutedText}>版履歴がありません</Text>
            </View>
          ) : (
            revisions.map((rev) => (
              <View key={rev.id} style={styles.revisionCard}>
                <View style={styles.revisionHeader}>
                  <View style={styles.revisionBadge}>
                    <Text style={styles.revisionBadgeText}>
                      {rev.isMajor ? `v${rev.revisionNumber}` : `v${rev.revisionNumber} 修正`}
                    </Text>
                  </View>
                  {rev.isCurrent && (
                    <View style={styles.currentBadge}>
                      <Text style={styles.currentBadgeText}>現在</Text>
                    </View>
                  )}
                  <Text style={styles.revisionDate}>{formatDate(rev.createdAt)}</Text>
                </View>

                <View style={styles.revisionMeta}>
                  {rev.servings != null && (
                    <Text style={styles.revisionMetaItem}>👥 {rev.servings}人前</Text>
                  )}
                  {rev.cookTimeMin != null && (
                    <Text style={styles.revisionMetaItem}>⏱ {rev.cookTimeMin}分</Text>
                  )}
                  <Text style={styles.revisionMetaItem}>🥬 材料 {rev.ingredientCount}品</Text>
                  <Text style={styles.revisionMetaItem}>📋 手順 {rev.stepCount}ステップ</Text>
                </View>

                {rev.description && <Text style={styles.revisionBody}>{rev.description}</Text>}
                {rev.authorNote && <Text style={styles.revisionNote}>{rev.authorNote}</Text>}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  backText: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.goldDim,
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 0.3,
  },
  headerSpacer: { width: 40 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedText: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  scrollContent: {
    padding: 20,
    gap: 12,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  revisionCard: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  revisionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  revisionBadge: {
    backgroundColor: '#2A1E0E',
    borderWidth: 1,
    borderColor: Colors.goldDim,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  revisionBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  currentBadge: {
    backgroundColor: Colors.gold,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.bg,
  },
  revisionDate: {
    marginLeft: 'auto',
    fontSize: 12,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  revisionMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  revisionMetaItem: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  revisionBody: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paper,
    lineHeight: 20,
  },
  revisionNote: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.goldDim,
    lineHeight: 20,
  },
});

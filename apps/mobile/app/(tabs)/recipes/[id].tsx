/**
 * S05: Recipe Detail screen
 * Hero image, meta info, tabs (ingredients/steps/memo), cooking start CTA
 */
import { eq } from 'drizzle-orm';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Stars } from '../../../src/components/Stars';
import { TagChip } from '../../../src/components/TagChip';
import { Colors } from '../../../src/constants/theme';
import { db } from '../../../src/db/client';
import * as schema from '../../../src/db/schema';

interface RecipeDetail {
  id: string;
  title: string;
  servings: number | null;
  cookTimeMin: number | null;
  description: string | null;
  rating: number | null;
  tags: string[];
  ingredients: {
    id: string;
    groupLabel: string | null;
    name: string;
    amount: string | null;
    note: string | null;
    sortOrder: number;
  }[];
  steps: {
    id: string;
    body: string;
    timerSec: number | null;
    sortOrder: number;
  }[];
}

type TabKey = 'ingredients' | 'steps' | 'memo';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ingredients', label: '材料' },
  { key: 'steps', label: '手順' },
  { key: 'memo', label: 'メモ' },
];

function getEmoji(title: string): string {
  const map: Record<string, string> = {
    '肉じゃが': '🍲',
    '味噌汁': '🍜',
    '唐揚げ': '🍗',
    '炊き込みご飯': '🍚',
    '豚汁': '🫕',
    'ハンバーグ': '🍔',
  };
  return map[title] ?? '🍽️';
}

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [tab, setTab] = useState<TabKey>('ingredients');

  const loadRecipe = useCallback(async () => {
    if (!id) return;

    const rows = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, id))
      .limit(1);

    if (rows.length === 0) return;
    const r = rows[0];

    // Revision data
    let servings: number | null = null;
    let cookTimeMin: number | null = null;
    let description: string | null = null;

    if (r.currentRevId) {
      const revs = await db
        .select()
        .from(schema.recipeRevisions)
        .where(eq(schema.recipeRevisions.id, r.currentRevId))
        .limit(1);
      if (revs.length > 0) {
        servings = revs[0].servings;
        cookTimeMin = revs[0].cookTimeMin;
        description = revs[0].description;
      }
    }

    // Tags
    const tagRows = await db
      .select({ name: schema.tags.name })
      .from(schema.recipeTags)
      .leftJoin(schema.tags, eq(schema.recipeTags.tagId, schema.tags.id))
      .where(eq(schema.recipeTags.recipeId, id));

    // Average rating
    const ratingRows = await db
      .select({ rating: schema.cookingLogs.rating })
      .from(schema.cookingLogs)
      .where(eq(schema.cookingLogs.recipeId, id));
    const ratings = ratingRows.filter((x) => x.rating != null);
    const avgRating =
      ratings.length > 0
        ? Math.round(ratings.reduce((sum, x) => sum + (x.rating ?? 0), 0) / ratings.length)
        : null;

    // Ingredients
    let ingredientsList: RecipeDetail['ingredients'] = [];
    if (r.currentRevId) {
      ingredientsList = await db
        .select()
        .from(schema.ingredients)
        .where(eq(schema.ingredients.revisionId, r.currentRevId))
        .orderBy(schema.ingredients.sortOrder);
    }

    // Steps
    let stepsList: RecipeDetail['steps'] = [];
    if (r.currentRevId) {
      stepsList = await db
        .select()
        .from(schema.steps)
        .where(eq(schema.steps.revisionId, r.currentRevId))
        .orderBy(schema.steps.sortOrder);
    }

    setRecipe({
      id: r.id,
      title: r.title,
      servings,
      cookTimeMin,
      description,
      rating: avgRating,
      tags: tagRows.map((t) => t.name ?? '').filter(Boolean),
      ingredients: ingredientsList,
      steps: stepsList,
    });
  }, [id]);

  useEffect(() => {
    void loadRecipe();
  }, [loadRecipe]);

  if (!recipe) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroEmoji}>{getEmoji(recipe.title)}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={20} color={Colors.goldDim} />
          <Text style={styles.backText}>戻る</Text>
        </Pressable>
      </View>

      {/* Meta */}
      <View style={styles.meta}>
        <Text style={styles.title}>{recipe.title}</Text>
        <View style={styles.metaRow}>
          {recipe.rating != null && <Stars rating={recipe.rating} size={12} />}
          {recipe.servings != null && (
            <Text style={styles.metaText}>👥 {recipe.servings}人前</Text>
          )}
          {recipe.cookTimeMin != null && (
            <Text style={styles.metaText}>⏱ {recipe.cookTimeMin}分</Text>
          )}
        </View>
        {recipe.tags.length > 0 && (
          <View style={styles.tagRow}>
            {recipe.tags.map((t) => (
              <TagChip key={t} label={t} />
            ))}
          </View>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map(({ key, label }) => (
          <Pressable
            key={key}
            style={styles.tabItem}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {label}
            </Text>
            {tab === key && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      {/* Tab content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {tab === 'ingredients' && (
          <View>
            {recipe.ingredients.map((ing, i) => {
              const showGroup =
                ing.groupLabel &&
                (i === 0 || recipe.ingredients[i - 1].groupLabel !== ing.groupLabel);
              return (
                <View key={ing.id}>
                  {showGroup && (
                    <Text style={styles.groupLabel}>{ing.groupLabel}</Text>
                  )}
                  <View style={styles.ingredientRow}>
                    <Text style={styles.ingredientName}>{ing.name}</Text>
                    <Text style={styles.ingredientAmount}>{ing.amount}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {tab === 'steps' && (
          <View style={styles.stepList}>
            {recipe.steps.map((step) => (
              <View key={step.id} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{step.sortOrder}</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepBody}>{step.body}</Text>
                  {step.timerSec != null && (
                    <View style={styles.timerBadge}>
                      <Text style={styles.timerText}>
                        ⏱{' '}
                        {step.timerSec >= 60
                          ? `${Math.floor(step.timerSec / 60)}分`
                          : `${step.timerSec}秒`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === 'memo' && (
          <View style={styles.memoContainer}>
            <Text style={styles.memoPlaceholder}>メモはまだありません</Text>
          </View>
        )}
      </ScrollView>

      {/* CTA */}
      <View style={styles.ctaContainer}>
        <Pressable
          style={styles.ctaButton}
          onPress={() => router.push(`/(tabs)/recipes/${recipe.id}/cook`)}
        >
          <Text style={styles.ctaText}>調理開始</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  loadingText: {
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 100,
  },
  hero: {
    height: 140,
    backgroundColor: '#1A1108',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  heroEmoji: {
    fontSize: 56,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  backText: {
    fontSize: 13,
    color: Colors.goldDim,
  },
  meta: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 20,
    color: Colors.paper,
    marginBottom: 6,
    letterSpacing: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 11,
    color: Colors.muted,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabText: {
    fontSize: 12,
    color: Colors.muted,
  },
  tabTextActive: {
    color: Colors.gold,
  },
  tabUnderline: {
    height: 2,
    backgroundColor: Colors.gold,
    width: '100%',
    marginTop: 8,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 20,
    paddingBottom: 20,
  },
  groupLabel: {
    fontSize: 10,
    color: Colors.goldDim,
    marginTop: 12,
    marginBottom: 6,
    letterSpacing: 1,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  ingredientName: {
    fontSize: 13,
    color: Colors.paperDim,
  },
  ingredientAmount: {
    fontSize: 13,
    color: Colors.goldDim,
  },
  stepList: {
    gap: 14,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2A1E0E',
    borderWidth: 1,
    borderColor: Colors.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 11,
    color: Colors.gold,
  },
  stepContent: {
    flex: 1,
  },
  stepBody: {
    fontSize: 13,
    color: Colors.paperDim,
    lineHeight: 22,
  },
  timerBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#1E1509',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  timerText: {
    fontSize: 11,
    color: Colors.gold,
  },
  memoContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  memoPlaceholder: {
    color: Colors.muted,
    fontSize: 13,
  },
  ctaContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  ctaButton: {
    width: '100%',
    paddingVertical: 14,
    backgroundColor: Colors.gold,
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaText: {
    color: Colors.bg,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 2,
  },
});

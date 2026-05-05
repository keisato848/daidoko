/**
 * S04: Recipe List screen
 * Grid view with search (title, reading, tags, ingredient names) and filter tabs
 */
import { eq, sql } from 'drizzle-orm';
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Stars } from '../../../src/components/Stars';
import { Colors } from '../../../src/constants/theme';
import { db } from '../../../src/db/client';
import * as schema from '../../../src/db/schema';

interface RecipeListItem {
  id: string;
  title: string;
  cookTimeMin: number | null;
  rating: number | null;
  tags: string[];
  ingredientNames: string[];
}

const TAG_FILTERS = ['すべて', '肉', '魚', '野菜', '汁物', 'ご飯', '洋食'];

export default function RecipeListScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [query, setQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState('すべて');

  const loadRecipes = useCallback(async () => {
    // Get all active recipes with their current revision data
    const allRecipes = await db
      .select({
        id: schema.recipes.id,
        title: schema.recipes.title,
        currentRevId: schema.recipes.currentRevId,
      })
      .from(schema.recipes)
      .where(eq(schema.recipes.status, 'active'));

    const result: RecipeListItem[] = [];

    for (const recipe of allRecipes) {
      // Get revision data (cookTime, rating)
      let cookTimeMin: number | null = null;
      if (recipe.currentRevId) {
        const revs = await db
          .select({ cookTimeMin: schema.recipeRevisions.cookTimeMin })
          .from(schema.recipeRevisions)
          .where(eq(schema.recipeRevisions.id, recipe.currentRevId))
          .limit(1);
        if (revs.length > 0) {
          cookTimeMin = revs[0].cookTimeMin;
        }
      }

      // Get tags
      const tagRows = await db
        .select({ name: schema.tags.name })
        .from(schema.recipeTags)
        .leftJoin(schema.tags, eq(schema.recipeTags.tagId, schema.tags.id))
        .where(eq(schema.recipeTags.recipeId, recipe.id));

      // Get average rating from cooking logs
      const ratingRows = await db
        .select({ rating: schema.cookingLogs.rating })
        .from(schema.cookingLogs)
        .where(eq(schema.cookingLogs.recipeId, recipe.id));
      const ratings = ratingRows.filter((r) => r.rating != null);
      const avgRating =
        ratings.length > 0
          ? Math.round(ratings.reduce((sum, r) => sum + (r.rating ?? 0), 0) / ratings.length)
          : null;

      // Get ingredient names
      let ingredientNames: string[] = [];
      if (recipe.currentRevId) {
        const ings = await db
          .select({ name: schema.ingredients.name })
          .from(schema.ingredients)
          .where(eq(schema.ingredients.revisionId, recipe.currentRevId));
        ingredientNames = ings.map((i) => i.name);
      }

      result.push({
        id: recipe.id,
        title: recipe.title,
        cookTimeMin,
        rating: avgRating,
        tags: tagRows.map((t) => t.name ?? '').filter(Boolean),
        ingredientNames,
      });
    }

    setRecipes(result);
  }, []);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  // Filter recipes
  const filtered = useMemo(() => {
    let result = recipes;

    // Tag filter
    if (activeTagFilter !== 'すべて') {
      result = result.filter((r) => r.tags.includes(activeTagFilter));
    }

    // Search query
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.tags.some((t) => t.includes(q)) ||
          r.ingredientNames.some((name) => name.includes(q)),
      );
    }

    return result;
  }, [recipes, query, activeTagFilter]);

  // Get matched ingredients for a recipe (for highlight display)
  const getMatchedIngredients = (recipe: RecipeListItem): string[] => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return recipe.ingredientNames.filter((name) => name.includes(q));
  };

  const renderRecipeCard = ({ item }: { item: RecipeListItem }) => {
    const matchedIngs = getMatchedIngredients(item);
    const hasIngredientHit = matchedIngs.length > 0;

    return (
      <Pressable
        style={[styles.card, hasIngredientHit && styles.cardHighlight]}
        onPress={() => router.push(`/(tabs)/recipes/${item.id}`)}
      >
        <View style={styles.cardImage}>
          <Text style={styles.cardEmoji}>
            {item.title === '肉じゃが' ? '🍲' :
             item.title === '味噌汁' ? '🍜' :
             item.title === '唐揚げ' ? '🍗' :
             item.title === '炊き込みご飯' ? '🍚' :
             item.title === '豚汁' ? '🫕' :
             item.title === 'ハンバーグ' ? '🍔' : '🍽️'}
          </Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.rating != null && <Stars rating={item.rating} size={10} />}
          {item.cookTimeMin != null && (
            <Text style={styles.cardTime}>⏱ {item.cookTimeMin}分</Text>
          )}
          {hasIngredientHit && (
            <View style={styles.ingredientBadge}>
              <Text style={styles.ingredientBadgeText}>
                🥬 {matchedIngs.slice(0, 2).join('・')}{matchedIngs.length > 2 ? ' …' : ''}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={14} color={Colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="レシピを探す"
            placeholderTextColor={Colors.muted}
          />
        </View>
      </View>

      {/* Tag filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {TAG_FILTERS.map((tag) => (
          <Pressable
            key={tag}
            style={[styles.filterChip, activeTagFilter === tag && styles.filterChipActive]}
            onPress={() => setActiveTagFilter(tag)}
          >
            <Text
              style={[
                styles.filterChipText,
                activeTagFilter === tag && styles.filterChipTextActive,
              ]}
            >
              {tag}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Search hint */}
      {query.length > 0 && (
        <View style={styles.searchHint}>
          <Text style={styles.searchHintText}>
            {filtered.length} 件
            {filtered.some((r) => getMatchedIngredients(r).length > 0) && (
              <Text style={styles.searchHintHighlight}>（食材名でヒットあり）</Text>
            )}
          </Text>
        </View>
      )}

      {/* Recipe grid */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderRecipeCard}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    paddingTop: 54,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.bgInput,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: Colors.paper,
    fontSize: 13,
    padding: 0,
  },
  filterContainer: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    maxHeight: 50,
  },
  filterContent: {
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 16,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  filterChipText: {
    fontSize: 11,
    color: Colors.muted,
  },
  filterChipTextActive: {
    color: Colors.bg,
  },
  searchHint: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  searchHintText: {
    fontSize: 11,
    color: Colors.muted,
  },
  searchHintHighlight: {
    color: Colors.goldDim,
  },
  grid: {
    padding: 16,
  },
  row: {
    gap: 10,
  },
  card: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 10,
  },
  cardHighlight: {
    borderColor: Colors.goldDim,
  },
  cardImage: {
    height: 80,
    backgroundColor: '#1A1108',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cardEmoji: {
    fontSize: 28,
  },
  cardBody: {
    padding: 10,
  },
  cardTitle: {
    fontSize: 13,
    color: Colors.paper,
    marginBottom: 4,
  },
  cardTime: {
    fontSize: 10,
    color: Colors.muted,
    marginTop: 4,
  },
  ingredientBadge: {
    marginTop: 5,
    backgroundColor: '#1E1509',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ingredientBadgeText: {
    fontSize: 10,
    color: Colors.goldDim,
    lineHeight: 15,
  },
});

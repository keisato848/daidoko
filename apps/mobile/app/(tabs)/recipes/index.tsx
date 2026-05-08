/**
 * S04: Recipe List screen
 * Grid view with search (title, reading, tags, ingredient names) and filter tabs
 */
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Stars } from '../../../src/components/Stars';
import { Colors } from '../../../src/constants/theme';
import { getRecipeList } from '../../../src/services/recipe.service';
import type { RecipeListItem } from '../../../src/services/types';

const TAG_FILTERS = ['すべて', '肉', '魚', '野菜', '汁物', 'ご飯', '洋食'];

function getEmoji(title: string): string {
  const map: Record<string, string> = {
    肉じゃが: '🍲',
    味噌汁: '🍜',
    唐揚げ: '🍗',
    炊き込みご飯: '🍚',
    豚汁: '🫕',
    ハンバーグ: '🍔',
  };
  return map[title] ?? '🍽️';
}

export default function RecipeListScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [query, setQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState('すべて');

  const loadRecipes = useCallback(async () => {
    setRecipes(await getRecipeList());
  }, []);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  const filtered = useMemo(() => {
    let result = recipes;

    if (activeTagFilter !== 'すべて') {
      result = result.filter((r) => r.tags.includes(activeTagFilter));
    }

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
          <Text style={styles.cardEmoji}>{getEmoji(item.title)}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.rating != null && <Stars rating={item.rating} size={12} />}
          {item.cookTimeMin != null && <Text style={styles.cardTime}>⏱ {item.cookTimeMin}分</Text>}
          {hasIngredientHit && (
            <View style={styles.ingredientBadge}>
              <Text style={styles.ingredientBadgeText}>
                🥬 {matchedIngs.slice(0, 2).join('・')}
                {matchedIngs.length > 2 ? ' …' : ''}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={15} color={Colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="レシピを探す"
            placeholderTextColor={Colors.muted}
          />
        </View>
      </View>

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
  container: { flex: 1, backgroundColor: Colors.bg, paddingTop: 54 },
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
    fontSize: 15, // base: 検索入力テキスト
    fontWeight: '400',
    padding: 0,
  },
  filterContainer: { borderBottomWidth: 1, borderBottomColor: Colors.border, maxHeight: 50 },
  filterContent: { gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 16,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  filterChipText: {
    fontSize: 13, // sm: フィルタータグ
    fontWeight: '400',
    color: Colors.paperDim,
  },
  filterChipTextActive: { color: Colors.bg, fontWeight: '500' },
  searchHint: { paddingHorizontal: 16, paddingTop: 6 },
  searchHintText: {
    fontSize: 13, // sm: 検索ヒント
    fontWeight: '400',
    color: Colors.paperDim,
  },
  searchHintHighlight: { color: Colors.goldDim },
  grid: { padding: 16 },
  row: { gap: 10 },
  card: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 10,
  },
  cardHighlight: { borderColor: Colors.goldDim },
  cardImage: {
    height: 80,
    backgroundColor: '#1A1108',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cardEmoji: { fontSize: 28 },
  cardBody: { padding: 10 },
  cardTitle: {
    fontSize: 15, // base: レシピカードタイトル
    fontWeight: '500',
    color: Colors.paper,
    marginBottom: 4,
  },
  cardTime: {
    fontSize: 12, // xs: 調理時間メタ情報
    fontWeight: '400',
    color: Colors.paperDim,
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
    fontSize: 12, // xs: 食材ヒットバッジ
    fontWeight: '400',
    color: Colors.goldDim,
    lineHeight: 16,
  },
});

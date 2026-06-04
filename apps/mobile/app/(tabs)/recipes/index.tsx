/**
 * S04: Recipe List screen
 * Grid view with search (title, reading, tags, ingredient names) and filter tabs
 * Long-press enables multi-select mode with bulk delete action.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Search, Trash2, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
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
import { deleteRecipe, getRecipeList } from '../../../src/services/recipe.service';
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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadRecipes = useCallback(async () => {
    setRecipes(await getRecipeList());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadRecipes();
    }, [loadRecipes]),
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

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;
    Alert.alert('レシピを削除', `${count}件のレシピを削除しますか？この操作は取り消せません。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await Promise.all([...selectedIds].map((id) => deleteRecipe(id)));
          exitSelectMode();
          await loadRecipes();
        },
      },
    ]);
  }, [selectedIds, exitSelectMode, loadRecipes]);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map((r) => r.id)));
  }, [filtered]);

  const getMatchedIngredients = (recipe: RecipeListItem): string[] => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return recipe.ingredientNames.filter((name) => name.includes(q));
  };

  const renderRecipeCard = ({ item }: { item: RecipeListItem }) => {
    const matchedIngs = getMatchedIngredients(item);
    const hasIngredientHit = matchedIngs.length > 0;
    const isSelected = selectedIds.has(item.id);

    return (
      <Pressable
        style={[
          styles.card,
          hasIngredientHit && !selectMode && styles.cardHighlight,
          isSelected && styles.cardSelected,
        ]}
        onPress={() => {
          if (selectMode) {
            toggleSelect(item.id);
          } else {
            router.push(`/(tabs)/recipes/${item.id}`);
          }
        }}
        onLongPress={() => {
          if (!selectMode) {
            setSelectMode(true);
            setSelectedIds(new Set([item.id]));
          }
        }}
      >
        <View style={styles.cardImage}>
          <Text style={styles.cardEmoji}>{getEmoji(item.title)}</Text>
          {selectMode && (
            <View style={[styles.checkBadge, isSelected && styles.checkBadgeSelected]}>
              {isSelected && <Text style={styles.checkMark}>✓</Text>}
            </View>
          )}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.rating != null && <Stars rating={item.rating} size={12} />}
          {item.cookTimeMin != null && <Text style={styles.cardTime}>⏱ {item.cookTimeMin}分</Text>}
          {hasIngredientHit && !selectMode && (
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
      {selectMode ? (
        /* ── 選択モードヘッダー ── */
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
        /* ── 通常ヘッダー（検索 + フィルター） ── */
        <>
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
        </>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderRecipeCard}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.grid, selectMode && styles.gridWithActionBar]}
        showsVerticalScrollIndicator={false}
      />

      {/* ── 選択モード アクションバー ── */}
      {selectMode && (
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
      )}
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
  filterContainer: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterContent: {
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    borderRadius: 16,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  filterChipText: {
    fontSize: 13, // sm: フィルタータグ
    lineHeight: 18,
    fontWeight: '400',
    color: Colors.paperDim,
    includeFontPadding: false,
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
  // ── 選択モード ──
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
    fontSize: 15, // base
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
    fontSize: 13, // sm
    fontWeight: '400',
    color: Colors.paperDim,
  },
  cardSelected: {
    borderColor: Colors.gold,
    borderWidth: 2,
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
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
  gridWithActionBar: { padding: 16, paddingBottom: 80 },
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
    fontSize: 15, // base
    fontWeight: '500',
    color: Colors.bg,
  },
  actionBtnTextDisabled: {
    color: Colors.muted,
  },
});

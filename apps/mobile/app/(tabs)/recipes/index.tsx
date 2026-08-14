/**
 * S04: Recipe List screen
 * Grid view with search (title, reading, tags, ingredient names) and filter tabs
 * Long-press enables multi-select mode with bulk delete action.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowUpDown, BookOpen, Check, Plus, Search, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet } from '../../../src/components/BottomSheet';
import { AdBanner } from '../../../src/components/AdBanner';
import { CoachMarkOverlay } from '../../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../../src/components/HelpButton';
import { EmptyState } from '../../../src/components/EmptyState';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Stars } from '../../../src/components/Stars';
import { Colors } from '../../../src/constants/theme';
import { useCoachMarks } from '../../../src/hooks/useCoachMarks';
import { t, tCount } from '../../../src/i18n';
import { getAliasMap } from '../../../src/services/name-alias.service';
import { deleteRecipe, getRecipeList } from '../../../src/services/recipe.service';
import type { RecipeListItem } from '../../../src/services/types';
import {
  createRecipeBook,
  getRecipeBook,
  shareRecipeBook,
} from '../../../src/services/recipe-book.service';
import { getUrlImportedRecipeIds } from '../../../src/services/web-share.service';
import { recipeMatchesQuery } from '../../../src/utils/recipeSearch';
import { getRecipeEmoji } from '../../../src/utils/recipeEmoji';
import {
  DEFAULT_RECIPE_SORT,
  RECIPE_SORT_KEYS,
  recipeSortLabel,
  sortRecipes,
  type RecipeSortKey,
} from '../../../src/utils/recipeSort';

/**
 * タグの絞り込み。**固定の日本語リストにしない。**
 *
 * タグはレシピが実際に持っている値（DB のデータ）で、訳すと一致しなくなる。
 * 固定リストだと、載っていないタグでは絞り込めなかった。実データから作れば
 * 言語に依存せず、ユーザーが付けたタグでそのまま絞り込める。
 * `null` は「すべて」を表す。
 */
const MAX_TAG_FILTERS = 12;

export default function RecipeListScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<RecipeSortKey>(DEFAULT_RECIPE_SORT);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // AI 名寄せキャッシュ（卵⇄たまご級の表記ゆれを検索でも吸収。空でも劣化のみ）
  const [aliases, setAliases] = useState<Record<string, string>>({});

  const loadRecipes = useCallback(async () => {
    const [list, aliasMap] = await Promise.all([getRecipeList(), getAliasMap()]);
    setRecipes(list);
    setAliases(aliasMap);
    setLoading(false);
  }, []);

  // 初回利用ガイド（コーチマーク）
  const searchRef = useRef<View>(null);
  const coach = useCoachMarks(
    'recipes',
    [
      {
        key: 'search',
        title: t('recipe.list.coach.searchTitle'),
        text: t('recipe.list.coach.searchText'),
        ref: searchRef,
      },
      {
        key: 'add',
        title: t('recipe.list.coach.addTitle'),
        text: t('recipe.list.coach.addText'),
      },
    ],
    !loading && !selectMode,
  );

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

  // 実データにあるタグから絞り込みチップを作る（多い順）。
  // 固定リストだと載っていないタグで絞り込めず、言語も日本語に固定されていた
  const tagFilters = useMemo<(string | null)[]>(() => {
    const counts = new Map<string, number>();
    for (const item of recipes) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_TAG_FILTERS)
      .map(([tag]) => tag);
    return [null, ...ranked];
  }, [recipes]);

  // 絞り込み中のタグが消えたら「すべて」に戻す（選べない状態で残さない）
  useEffect(() => {
    if (activeTagFilter !== null && !tagFilters.includes(activeTagFilter)) {
      setActiveTagFilter(null);
    }
  }, [tagFilters, activeTagFilter]);

  const filtered = useMemo(() => {
    let result = recipes;

    if (activeTagFilter !== null) {
      result = result.filter((r) => r.tags.includes(activeTagFilter));
    }

    if (query.trim()) {
      result = result.filter((r) => recipeMatchesQuery(r, query, aliases));
    }

    return sortRecipes(result, sortKey);
  }, [recipes, query, activeTagFilter, sortKey, aliases]);

  // ── レシピ帖の Web 共有（docs/Web共有設計.md S2） ──
  const [bookSheetOpen, setBookSheetOpen] = useState(false);
  const [bookTitle, setBookTitle] = useState('');
  const [bookEligibleIds, setBookEligibleIds] = useState<string[]>([]);
  const [bookExcludedCount, setBookExcludedCount] = useState(0);
  const [bookPublishing, setBookPublishing] = useState(false);

  const handleOpenBookSheet = useCallback(async () => {
    if (selectedIds.size === 0) return;
    // 出所ゲート: URL 取り込み由来は帖に載せられない（転載をサーバーに置かない）
    const urlImported = await getUrlImportedRecipeIds();
    const eligible = [...selectedIds].filter((id) => !urlImported.has(id));
    if (eligible.length === 0) {
      Alert.alert(t('recipe.list.bookShare.title'), t('recipe.list.bookShare.allExcluded'));
      return;
    }
    setBookEligibleIds(eligible);
    setBookExcludedCount(selectedIds.size - eligible.length);
    setBookTitle(t('recipe.list.bookShare.defaultTitle'));
    setBookSheetOpen(true);
  }, [selectedIds]);

  /** 帖を作る（S4: 帖はローカルの実体）。選択順ではなく一覧の表示順で収録する */
  const createBookFromSelection = useCallback(async (): Promise<string> => {
    const order = new Map(recipes.map((r, i) => [r.id, i]));
    const ordered = [...selectedIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    return createRecipeBook(bookTitle.trim(), ordered);
  }, [bookTitle, recipes, selectedIds]);

  const handleCreateBookOnly = useCallback(async () => {
    if (bookPublishing || bookTitle.trim() === '') return;
    setBookPublishing(true);
    try {
      const id = await createBookFromSelection();
      setBookSheetOpen(false);
      exitSelectMode();
      router.push({ pathname: '/(tabs)/book-edit', params: { id } });
    } catch {
      Alert.alert(t('recipe.list.bookShare.title'), t('recipe.list.bookShare.failed'));
    } finally {
      setBookPublishing(false);
    }
  }, [bookPublishing, bookTitle, createBookFromSelection, exitSelectMode, router]);

  const handlePublishBook = useCallback(async () => {
    if (bookPublishing || bookTitle.trim() === '') return;
    setBookPublishing(true);
    try {
      const id = await createBookFromSelection();
      // 即共有はパスコード・期限なしの既定で出す（後から帖の管理で設定できる）
      await shareRecipeBook(id, { passcode: null, expiresInDays: null });
      const book = await getRecipeBook(id);
      setBookSheetOpen(false);
      exitSelectMode();
      try {
        if (book?.shareUrl) await Share.share({ message: `${book.title}\n${book.shareUrl}` });
      } catch {
        // 共有シートのキャンセルは無視（設定 → レシピ帖の管理 から再共有できる）
      }
    } catch {
      Alert.alert(t('recipe.list.bookShare.title'), t('recipe.list.bookShare.failed'));
    } finally {
      setBookPublishing(false);
    }
  }, [bookPublishing, bookTitle, createBookFromSelection, exitSelectMode]);

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;
    Alert.alert(t('recipe.list.deleteTitle'), tCount('recipe.list.deleteConfirm', count), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
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
      <PressableScale
        containerStyle={styles.cardOuter}
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
          {item.heroPhotoUri ? (
            <Image
              source={{ uri: item.heroPhotoUri }}
              style={styles.cardImagePhoto}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.cardEmoji}>{getRecipeEmoji(item.title)}</Text>
          )}
          {selectMode && (
            <View style={[styles.checkBadge, isSelected && styles.checkBadgeSelected]}>
              {isSelected && <Text style={styles.checkMark}>✓</Text>}
            </View>
          )}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.rating != null && <Stars rating={item.rating} size={12} />}
          {item.cookTimeMin != null && (
            <Text style={styles.cardTime}>
              ⏱ {tCount('recipe.detail.cookTimeValue', item.cookTimeMin)}
            </Text>
          )}
          {hasIngredientHit && !selectMode && (
            <View style={styles.ingredientBadge}>
              <Text style={styles.ingredientBadgeText}>
                🥬 {matchedIngs.slice(0, 2).join(t('common.listSeparator'))}
                {matchedIngs.length > 2 ? ' …' : ''}
              </Text>
            </View>
          )}
        </View>
      </PressableScale>
    );
  };

  return (
    <View style={styles.container}>
      {/* バナーの上に収めるラッパー。FAB・選択アクションバーは absolute で
          ここに anchor する — container 直下だとバナーと重なる（AQUOS 実測） */}
      <View style={styles.content}>
        {selectMode ? (
          /* ── 選択モードヘッダー ── */
          <View style={styles.selectHeader}>
            <Pressable style={styles.selectCancelBtn} onPress={exitSelectMode}>
              <X size={18} color={Colors.paper} />
            </Pressable>
            <Text style={styles.selectCount}>
              {tCount('recipe.list.selectCount', selectedIds.size)}
            </Text>
            <Pressable style={styles.selectAllBtn} onPress={handleSelectAll}>
              <Text style={styles.selectAllText}>{t('recipe.list.selectAll')}</Text>
            </Pressable>
          </View>
        ) : (
          /* ── 通常ヘッダー（検索 + フィルター） ── */
          <>
            <View style={styles.searchContainer}>
              <View ref={searchRef} collapsable={false} style={styles.searchBar}>
                <Search size={15} color={Colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('recipe.list.search')}
                  placeholderTextColor={Colors.muted}
                />
              </View>
              <Pressable
                style={styles.sortButton}
                onPress={() => setSortSheetOpen(true)}
                accessibilityLabel={t('recipe.list.sort')}
              >
                <ArrowUpDown size={14} color={Colors.gold} />
                <Text style={styles.sortButtonText}>{recipeSortLabel(sortKey)}</Text>
              </Pressable>
              <HelpButton onPress={coach.show} />
            </View>

            <View style={styles.filterContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterContent}
              >
                {tagFilters.map((tag) => (
                  <Pressable
                    key={tag ?? '__all__'}
                    style={[styles.filterChip, activeTagFilter === tag && styles.filterChipActive]}
                    onPress={() => setActiveTagFilter(tag)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        activeTagFilter === tag && styles.filterChipTextActive,
                      ]}
                    >
                      {tag ?? t('recipe.list.filterAll')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            {query.length > 0 && (
              <View style={styles.searchHint}>
                <Text style={styles.searchHintText}>
                  {tCount('recipe.list.countSuffix', filtered.length)}
                  {filtered.some((r) => getMatchedIngredients(r).length > 0) && (
                    <Text style={styles.searchHintHighlight}>
                      {t('recipe.list.ingredientHitNote')}
                    </Text>
                  )}
                </Text>
              </View>
            )}
          </>
        )}

        {loading ? (
          <Loading message={t('recipe.list.loading')} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={renderRecipeCard}
            numColumns={2}
            columnWrapperStyle={filtered.length > 0 ? styles.row : undefined}
            contentContainerStyle={[
              styles.grid,
              selectMode && styles.gridWithActionBar,
              filtered.length === 0 && styles.gridEmpty,
            ]}
            showsVerticalScrollIndicator={false}
            /* 検索中でもカードを 1 タップで開ける（既定の never だと
               1 タップ目がキーボードを閉じるだけで消費される） */
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              recipes.length === 0 ? (
                <EmptyState
                  icon="📖"
                  title={t('recipe.list.emptyTitle')}
                  message={t('recipe.list.emptyMessage')}
                  actionLabel={t('recipe.list.emptyAction')}
                  onAction={() => router.push('/(tabs)/add')}
                />
              ) : (
                <EmptyState
                  icon="🔍"
                  title={t('recipe.list.noMatchTitle')}
                  message={t('recipe.list.noMatchMessage')}
                />
              )
            }
          />
        )}

        {/* ── 選択モード アクションバー ── */}
        {selectMode && (
          <View style={styles.actionBar}>
            <Pressable
              style={[
                styles.actionBtn,
                styles.actionBtnShare,
                selectedIds.size === 0 && styles.actionBtnDisabled,
              ]}
              onPress={() => void handleOpenBookSheet()}
              disabled={selectedIds.size === 0}
            >
              <BookOpen size={16} color={selectedIds.size === 0 ? Colors.muted : Colors.bg} />
              <Text
                style={[
                  styles.actionBtnText,
                  selectedIds.size === 0 && styles.actionBtnTextDisabled,
                ]}
              >
                {t('recipe.list.bookShare.action')}
              </Text>
            </Pressable>
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
                style={[
                  styles.actionBtnText,
                  selectedIds.size === 0 && styles.actionBtnTextDisabled,
                ]}
              >
                {t('common.delete')}
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── レシピ帖の Web 共有シート ── */}
        <BottomSheet
          visible={bookSheetOpen}
          onClose={() => setBookSheetOpen(false)}
          title={t('recipe.list.bookShare.title')}
        >
          <Text style={styles.bookSheetNote}>
            {tCount('recipe.list.bookShare.countNote', bookEligibleIds.length)}
            {bookExcludedCount > 0 &&
              ` ${tCount('recipe.list.bookShare.excludedNote', bookExcludedCount)}`}
          </Text>
          <TextInput
            style={styles.bookTitleInput}
            value={bookTitle}
            onChangeText={setBookTitle}
            placeholder={t('recipe.list.bookShare.titlePlaceholder')}
            placeholderTextColor={Colors.muted}
            maxLength={100}
          />
          <Text style={styles.bookSheetAttest}>{t('recipe.list.bookShare.attestNote')}</Text>
          <Pressable
            style={[
              styles.bookPublishBtn,
              (bookPublishing || bookTitle.trim() === '') && styles.actionBtnDisabled,
            ]}
            onPress={() => void handlePublishBook()}
            disabled={bookPublishing || bookTitle.trim() === ''}
          >
            <Text style={styles.bookPublishBtnText}>
              {bookPublishing
                ? t('recipe.list.bookShare.publishing')
                : t('recipe.list.bookShare.publish')}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.bookCreateOnlyBtn,
              (bookPublishing || bookTitle.trim() === '') && styles.actionBtnDisabled,
            ]}
            onPress={() => void handleCreateBookOnly()}
            disabled={bookPublishing || bookTitle.trim() === ''}
          >
            <Text style={styles.bookCreateOnlyBtnText}>
              {t('recipe.list.bookShare.createOnly')}
            </Text>
          </Pressable>
        </BottomSheet>

        <BottomSheet
          visible={sortSheetOpen}
          onClose={() => setSortSheetOpen(false)}
          title={t('recipe.list.sort')}
        >
          {RECIPE_SORT_KEYS.map((option) => {
            const active = option === sortKey;
            return (
              <Pressable
                key={option}
                style={styles.sortOption}
                onPress={() => {
                  setSortKey(option);
                  setSortSheetOpen(false);
                }}
              >
                <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>
                  {recipeSortLabel(option)}
                </Text>
                {active && <Check size={18} color={Colors.gold} />}
              </Pressable>
            );
          })}
        </BottomSheet>

        {!selectMode && (
          <Pressable
            style={styles.addFab}
            onPress={() => router.push('/(tabs)/add')}
            accessibilityRole="button"
            accessibilityLabel={t('recipe.list.addLabel')}
          >
            <Plus size={24} color={Colors.bg} />
          </Pressable>
        )}
      </View>

      <AdBanner />
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
  container: { flex: 1, backgroundColor: Colors.bg, paddingTop: 54 },
  content: {
    flex: 1,
  },
  addFab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchBar: {
    flex: 1,
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
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  sortButtonText: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.gold,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sortOptionText: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  sortOptionTextActive: {
    color: Colors.gold,
    fontWeight: '500',
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
  gridEmpty: { flexGrow: 1, padding: 0 },
  row: { gap: 10 },
  cardOuter: {
    flex: 1,
    marginBottom: 10,
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
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
  cardImagePhoto: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
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
  actionBtnShare: {
    backgroundColor: Colors.gold,
  },
  bookSheetNote: {
    fontSize: 13,
    color: Colors.muted,
    marginBottom: 12,
  },
  bookTitleInput: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.paper,
    marginBottom: 12,
  },
  bookSheetAttest: {
    fontSize: 12,
    color: Colors.muted,
    lineHeight: 18,
    marginBottom: 16,
  },
  bookPublishBtn: {
    backgroundColor: Colors.gold,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  bookPublishBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
  },
  bookCreateOnlyBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  bookCreateOnlyBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.paper,
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

/**
 * S05: Recipe Detail screen
 * Hero image, meta info, tabs (ingredients/steps/memo), cooking start CTA
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, MoreVertical } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Stars } from '../../../src/components/Stars';
import { TagChip } from '../../../src/components/TagChip';
import { Colors } from '../../../src/constants/theme';
import { deleteRecipe, getRecipeDetail } from '../../../src/services/recipe.service';
import type { RecipeDetail } from '../../../src/services/types';

type TabKey = 'ingredients' | 'steps' | 'memo';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ingredients', label: '材料' },
  { key: 'steps', label: '手順' },
  { key: 'memo', label: 'メモ' },
];

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

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [tab, setTab] = useState<TabKey>('ingredients');
  const [showMenu, setShowMenu] = useState(false);

  const loadRecipe = useCallback(async () => {
    if (!id) return;
    setRecipe(await getRecipeDetail(id));
  }, [id]);

  useEffect(() => {
    void loadRecipe();
  }, [loadRecipe]);

  const handleDelete = () => {
    if (!id) return;
    Alert.alert('レシピを削除', 'このレシピを削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await deleteRecipe(id);
          router.back();
        },
      },
    ]);
  };

  if (!recipe) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.heroEmoji}>{getEmoji(recipe.title)}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={20} color={Colors.goldDim} />
          <Text style={styles.backText}>戻る</Text>
        </Pressable>
        <Pressable style={styles.menuButton} onPress={() => setShowMenu(!showMenu)}>
          <MoreVertical size={20} color={Colors.goldDim} />
        </Pressable>
        {showMenu && (
          <View style={styles.menuDropdown}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                router.push(`/recipes/${id}/edit`);
              }}
            >
              <Text style={styles.menuItemText}>編集</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                handleDelete();
              }}
            >
              <Text style={[styles.menuItemText, styles.menuItemDestructive]}>削除</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.meta}>
        <Text style={styles.title}>{recipe.title}</Text>
        <View style={styles.metaRow}>
          {recipe.rating != null && <Stars rating={recipe.rating} size={13} />}
          {recipe.servings != null && <Text style={styles.metaText}>👥 {recipe.servings}人前</Text>}
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

      <View style={styles.tabBar}>
        {TABS.map(({ key, label }) => (
          <Pressable key={key} style={styles.tabItem} onPress={() => setTab(key)}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            {tab === key && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {tab === 'ingredients' && (
          <View>
            {recipe.ingredients.map((ing, i) => {
              const showGroup =
                ing.groupLabel &&
                (i === 0 || recipe.ingredients[i - 1].groupLabel !== ing.groupLabel);
              return (
                <View key={ing.id}>
                  {showGroup && <Text style={styles.groupLabel}>{ing.groupLabel}</Text>}
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
  container: { flex: 1, backgroundColor: Colors.bg },
  loadingText: {
    fontSize: 15, // base
    fontWeight: '400',
    color: Colors.paperDim,
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
  heroEmoji: { fontSize: 56 },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  backText: {
    fontSize: 15, // base: ナビゲーションテキスト
    fontWeight: '400',
    color: Colors.goldDim,
  },
  menuButton: {
    position: 'absolute',
    top: 50,
    right: 16,
  },
  menuDropdown: {
    position: 'absolute',
    top: 76,
    right: 16,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 4,
    minWidth: 100,
    zIndex: 10,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  menuItemText: {
    fontSize: 15, // base: メニュー項目
    fontWeight: '400',
    color: Colors.paper,
  },
  menuItemDestructive: {
    color: '#FF6B6B',
  },
  meta: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 20, // lg: レシピタイトル
    fontWeight: '500',
    color: Colors.paper,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  metaText: {
    fontSize: 13, // sm: メタ情報（人数・調理時間）
    fontWeight: '400',
    color: Colors.paperDim,
  },
  tagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabText: {
    fontSize: 13, // sm: タブラベル
    fontWeight: '400',
    color: Colors.muted,
  },
  tabTextActive: {
    color: Colors.gold,
    fontWeight: '500',
  },
  tabUnderline: { height: 2, backgroundColor: Colors.gold, width: '100%', marginTop: 8 },
  content: { flex: 1 },
  contentInner: { padding: 20, paddingBottom: 20 },
  groupLabel: {
    fontSize: 12, // xs: グループラベル
    fontWeight: '500',
    color: Colors.goldDim,
    marginTop: 12,
    marginBottom: 6,
    letterSpacing: 1,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  ingredientName: {
    fontSize: 15, // base: 材料名
    fontWeight: '400',
    color: Colors.paper,
  },
  ingredientAmount: {
    fontSize: 15, // base: 分量
    fontWeight: '400',
    color: Colors.goldDim,
  },
  stepList: { gap: 14 },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2A1E0E',
    borderWidth: 1,
    borderColor: Colors.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 13, // sm: ステップ番号
    fontWeight: '500',
    color: Colors.gold,
  },
  stepContent: { flex: 1 },
  stepBody: {
    fontSize: 15, // base: 手順テキスト
    fontWeight: '400',
    color: Colors.paper,
    lineHeight: 24,
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
    fontSize: 13, // sm: タイマーバッジ
    fontWeight: '400',
    color: Colors.gold,
  },
  memoContainer: { alignItems: 'center', paddingVertical: 40 },
  memoPlaceholder: {
    fontSize: 15, // base
    fontWeight: '400',
    color: Colors.paperDim,
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
    fontSize: 17, // md: CTAボタン
    fontWeight: '600',
    letterSpacing: 2,
  },
});

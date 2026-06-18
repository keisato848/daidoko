/**
 * S-Shop: Shopping Mode (R07 / US-08)
 * Ingredient checklist with serving scaling and session-only check state.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../../../src/components/EmptyState';
import { Loading } from '../../../../src/components/Loading';
import { NumberStepper } from '../../../../src/components/NumberStepper';
import { Colors, Typography } from '../../../../src/constants/theme';
import { getRecipeDetail } from '../../../../src/services/recipe.service';
import type { RecipeDetail } from '../../../../src/services/types';
import { scaleAmount, servingRatio } from '../../../../src/utils/shoppingScale';

export default function ShoppingModeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [servings, setServings] = useState<number | undefined>(undefined);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    const detail = await getRecipeDetail(id);
    setRecipe(detail);
    setServings(detail?.servings ?? undefined);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const ratio = useMemo(
    () => servingRatio(recipe?.servings ?? null, servings ?? recipe?.servings ?? 1),
    [recipe?.servings, servings],
  );

  const toggle = (ingredientId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(ingredientId)) next.delete(ingredientId);
      else next.add(ingredientId);
      return next;
    });
  };

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <X size={20} color={Colors.muted} />
      </Pressable>
      <Text style={styles.headerTitle}>買い物モード</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <Loading message="材料を読み込んでいます" />
      </View>
    );
  }

  if (!recipe) {
    return (
      <View style={styles.container}>
        {header}
        <EmptyState
          icon="📖"
          title="レシピが見つかりません"
          message="削除されたか、参照できないレシピです。"
          actionLabel="戻る"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const checkedCount = recipe.ingredients.filter((ing) => checked.has(ing.id)).length;

  return (
    <View style={styles.container}>
      {header}

      <View style={styles.metaBar}>
        <Text style={styles.recipeTitle} numberOfLines={1}>
          {recipe.title}
        </Text>
        <Text style={styles.progress}>
          {checkedCount}/{recipe.ingredients.length}
        </Text>
      </View>

      <View style={styles.servingsRow}>
        <NumberStepper label="人数" value={servings} onChange={setServings} suffix="人前" min={1} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {recipe.ingredients.length === 0 ? (
          <Text style={styles.emptyText}>このレシピには材料が登録されていません</Text>
        ) : (
          recipe.ingredients.map((ing, i) => {
            const showGroup =
              ing.groupLabel &&
              (i === 0 || recipe.ingredients[i - 1].groupLabel !== ing.groupLabel);
            const isChecked = checked.has(ing.id);
            return (
              <View key={ing.id}>
                {showGroup && <Text style={styles.groupLabel}>{ing.groupLabel}</Text>}
                <Pressable
                  style={styles.row}
                  onPress={() => toggle(ing.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isChecked }}
                >
                  <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                    {isChecked && <Check size={14} color={Colors.bg} />}
                  </View>
                  <Text style={[styles.name, isChecked && styles.struck]}>{ing.name}</Text>
                  <Text style={[styles.amount, isChecked && styles.struck]}>
                    {scaleAmount(ing.amount, ratio)}
                  </Text>
                </Pressable>
              </View>
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
  metaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
    gap: 12,
  },
  recipeTitle: {
    flex: 1,
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.paper,
  },
  progress: {
    fontSize: Typography.size.sm,
    color: Colors.goldDim,
  },
  servingsRow: {
    paddingHorizontal: 20,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  list: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    paddingBottom: 32,
  },
  emptyText: {
    fontSize: Typography.size.sm,
    color: Colors.muted,
    textAlign: 'center',
    paddingVertical: 28,
  },
  groupLabel: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.medium,
    color: Colors.goldDim,
    marginTop: 12,
    marginBottom: 4,
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  name: {
    flex: 1,
    fontSize: Typography.size.base,
    color: Colors.paper,
  },
  amount: {
    fontSize: Typography.size.base,
    color: Colors.goldDim,
  },
  struck: {
    textDecorationLine: 'line-through',
    color: Colors.muted,
  },
});

/**
 * S12: Recipe Edit — pre-filled form, creates new revision on save
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { RecipeForm } from '../../../src/components/RecipeForm';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { getRecipeDetail, updateRecipe } from '../../../src/services/recipe.service';
import type { UpdateRecipeInput } from '../../../src/services/types';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [initialValues, setInitialValues] = useState<RecipeFormData | null>(null);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getRecipeDetail(id).then((detail) => {
      if (!detail) return;
      setInitialValues({
        title: detail.title,
        titleReading: '',
        description: detail.description ?? '',
        servings: detail.servings ?? undefined,
        cookTimeMin: detail.cookTimeMin ?? undefined,
        prepTimeMin: undefined,
        ingredients: detail.ingredients.map((ing) => ({
          name: ing.name,
          amount: ing.amount ?? '',
          groupLabel: ing.groupLabel ?? '',
          note: ing.note ?? '',
        })),
        steps: detail.steps.map((s) => ({
          body: s.body,
          timerSec: s.timerSec ?? undefined,
          photoPath: s.photoPath ?? undefined,
        })),
        tags: detail.tags,
        coverPhotoPath: detail.coverPhotoPath ?? undefined,
      });
    });
  }, [id]);

  const handleSubmit = useCallback(
    async (data: RecipeFormData) => {
      if (!id) return;

      const input: UpdateRecipeInput = {
        title: data.title,
        titleReading: data.titleReading || undefined,
        description: data.description || undefined,
        servings: data.servings,
        cookTimeMin: data.cookTimeMin,
        prepTimeMin: data.prepTimeMin,
        isMajor: true,
        ingredients: data.ingredients.map((ing) => ({
          name: ing.name,
          amount: ing.amount || undefined,
          groupLabel: ing.groupLabel || undefined,
          note: ing.note || undefined,
        })),
        steps: data.steps.map((s) => ({
          body: s.body,
          timerSec: s.timerSec,
          photoPath: s.photoPath || undefined,
        })),
        tags: data.tags,
        coverPhotoPath: data.coverPhotoPath || undefined,
      };

      await updateRecipe(id, input);
      setShowToast(true);
      setTimeout(() => router.back(), 1500);
    },
    [id, router],
  );

  if (!initialValues) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <RecipeForm
        initialValues={initialValues}
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
        submitLabel="更新"
        title="レシピ編集"
      />
      <Toast
        message="レシピを更新しました"
        visible={showToast}
        onDismiss={() => setShowToast(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  loading: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

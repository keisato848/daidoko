/**
 * S11: Manual recipe input — uses shared RecipeForm
 * Placed inside (tabs)/recipes/ so static route "new" wins over dynamic "[id]"
 */
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { RecipeForm } from '../../../src/components/RecipeForm';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { useRecipeDraft } from '../../../src/hooks/useRecipeDraft';
import { createRecipe } from '../../../src/services/recipe.service';
import type { SaveRecipeInput } from '../../../src/services/types';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

export default function NewRecipeScreen() {
  const router = useRouter();
  const { draft, saveDraft, clearDraft } = useRecipeDraft();
  const [showToast, setShowToast] = useState(false);

  const handleSubmit = useCallback(
    async (data: RecipeFormData) => {
      const input: SaveRecipeInput = {
        title: data.title,
        titleReading: data.titleReading || undefined,
        description: data.description || undefined,
        servings: data.servings,
        cookTimeMin: data.cookTimeMin,
        prepTimeMin: data.prepTimeMin,
        ingredients: data.ingredients.map((ing) => ({
          name: ing.name,
          amount: ing.amount || undefined,
          groupLabel: ing.groupLabel || undefined,
          note: ing.note || undefined,
        })),
        steps: data.steps.map((s) => ({
          body: s.body,
          timerSec: s.timerSec,
        })),
        tags: data.tags,
      };

      await createRecipe(input);
      clearDraft();
      setShowToast(true);
      setTimeout(() => router.replace('/(tabs)/recipes'), 1500);
    },
    [clearDraft, router],
  );

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <RecipeForm
        initialValues={draft as RecipeFormData | undefined}
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
        title="レシピ作成"
        onFormChange={saveDraft}
      />
      <Toast
        message="レシピを保存しました"
        visible={showToast}
        onDismiss={() => setShowToast(false)}
      />
    </View>
  );
}

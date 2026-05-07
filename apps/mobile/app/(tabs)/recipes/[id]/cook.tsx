/**
 * S06: Cooking Mode screen
 * Full-screen step display with swipe navigation, timer support, ingredients overlay
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../../../../src/constants/theme';
import { isNativePlatform } from '../../../../src/db/client';
import { getMockRecipeDetail } from '../../../../src/db/mock';

interface StepData {
  id: string;
  sortOrder: number;
  body: string;
  timerSec: number | null;
}

interface IngredientData {
  name: string;
  amount: string | null;
  groupLabel: string | null;
}

export default function CookingModeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recipeTitle, setRecipeTitle] = useState('');
  const [servings, setServings] = useState<number | null>(null);
  const [steps, setSteps] = useState<StepData[]>([]);
  const [ingredients, setIngredients] = useState<IngredientData[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;

    if (isNativePlatform) {
      const { eq } = await import('drizzle-orm');
      const { getDb } = await import('../../../../src/db/client');
      const schema = await import('../../../../src/db/schema');
      const db = getDb();

      const recipes = await db
        .select()
        .from(schema.recipes)
        .where(eq(schema.recipes.id, id))
        .limit(1);

      if (recipes.length === 0) return;
      const recipe = recipes[0];
      setRecipeTitle(recipe.title);

      if (!recipe.currentRevId) return;

      const revs = await db
        .select({ servings: schema.recipeRevisions.servings })
        .from(schema.recipeRevisions)
        .where(eq(schema.recipeRevisions.id, recipe.currentRevId))
        .limit(1);
      if (revs.length > 0) {
        setServings(revs[0].servings);
      }

      const stepRows = await db
        .select()
        .from(schema.steps)
        .where(eq(schema.steps.revisionId, recipe.currentRevId))
        .orderBy(schema.steps.sortOrder);
      setSteps(stepRows);

      const ingRows = await db
        .select({
          name: schema.ingredients.name,
          amount: schema.ingredients.amount,
          groupLabel: schema.ingredients.groupLabel,
        })
        .from(schema.ingredients)
        .where(eq(schema.ingredients.revisionId, recipe.currentRevId))
        .orderBy(schema.ingredients.sortOrder);
      setIngredients(ingRows);
    } else {
      const detail = getMockRecipeDetail(id);
      if (!detail) return;
      setRecipeTitle(detail.title);
      setServings(detail.servings);
      setSteps(detail.steps);
      setIngredients(detail.ingredients);
    }
  }, [id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (steps.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  const current = steps[currentStep];
  const progress = (currentStep + 1) / steps.length;
  const isLastStep = currentStep === steps.length - 1;

  function formatTimer(sec: number): string {
    if (sec >= 60) {
      return `${Math.floor(sec / 60)}分 タイマーを開始`;
    }
    return `${sec}秒 タイマーを開始`;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{recipeTitle}</Text>
        <Text style={styles.headerStep}>
          {currentStep + 1} / {steps.length}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      {/* Step content */}
      <Pressable style={styles.stepArea} onPress={() => setShowIngredients(true)}>
        <View style={styles.stepNumberCircle}>
          <Text style={styles.stepNumberText}>{current.sortOrder}</Text>
        </View>

        <Text style={styles.stepBody}>{current.body}</Text>

        {current.timerSec != null && (
          <Pressable style={styles.timerButton}>
            <Text style={styles.timerIcon}>⏱</Text>
            <Text style={styles.timerText}>{formatTimer(current.timerSec)}</Text>
          </Pressable>
        )}

        <Text style={styles.tapHint}>画面をタップで材料を表示</Text>
      </Pressable>

      {/* Navigation buttons */}
      <View style={styles.navBar}>
        <Pressable
          style={[styles.navPrev, currentStep === 0 && styles.navDisabled]}
          onPress={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
        >
          <Text style={[styles.navPrevText, currentStep === 0 && styles.navDisabledText]}>
            ← 前へ
          </Text>
        </Pressable>

        {isLastStep ? (
          <Pressable style={styles.navFinish} onPress={() => router.back()}>
            <Text style={styles.navFinishText}>✓ 完成！記録する</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.navNext} onPress={() => setCurrentStep(currentStep + 1)}>
            <Text style={styles.navNextText}>次へ →</Text>
          </Pressable>
        )}
      </View>

      {/* Ingredients overlay */}
      <Modal
        visible={showIngredients}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIngredients(false)}
      >
        <Pressable style={styles.overlayBackdrop} onPress={() => setShowIngredients(false)}>
          <Pressable style={styles.overlaySheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.overlayHandle} />
            <Text style={styles.overlayTitle}>
              材料{servings != null ? `（${servings}人前）` : ''}
            </Text>
            <ScrollView style={styles.overlayScroll}>
              {ingredients.map((ing, i) => (
                <View key={i} style={styles.overlayRow}>
                  <Text style={styles.overlayIngName}>{ing.name}</Text>
                  <Text style={styles.overlayIngAmount}>{ing.amount}</Text>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 14,
    color: Colors.paperDim,
    letterSpacing: 1,
  },
  headerStep: {
    fontSize: 12,
    color: Colors.muted,
  },
  progressBar: {
    height: 2,
    backgroundColor: Colors.border,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.gold,
  },
  stepArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  stepNumberCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2A1E0E',
    borderWidth: 2,
    borderColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  stepNumberText: {
    fontSize: 20,
    color: Colors.gold,
  },
  stepBody: {
    fontSize: 18,
    color: Colors.paper,
    textAlign: 'center',
    lineHeight: 32,
    letterSpacing: 0.5,
  },
  timerButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timerIcon: {
    fontSize: 18,
  },
  timerText: {
    color: Colors.gold,
    fontSize: 16,
  },
  tapHint: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 20,
  },
  navBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  navPrev: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.goldDim,
    alignItems: 'center',
  },
  navDisabled: {
    borderColor: Colors.border,
  },
  navPrevText: {
    fontSize: 14,
    color: Colors.goldDim,
  },
  navDisabledText: {
    color: Colors.muted,
  },
  navNext: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    alignItems: 'center',
  },
  navNextText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.bg,
  },
  navFinish: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2A6040',
    borderWidth: 1,
    borderColor: '#3D8A5A',
    alignItems: 'center',
  },
  navFinishText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7FFFAA',
  },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: Colors.bgOverlay,
    justifyContent: 'flex-end',
  },
  overlaySheet: {
    backgroundColor: '#150F08',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '60%',
  },
  overlayHandle: {
    width: 36,
    height: 3,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  overlayTitle: {
    fontSize: 12,
    color: Colors.goldDim,
    letterSpacing: 2,
    marginBottom: 12,
  },
  overlayScroll: {
    flexGrow: 0,
  },
  overlayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  overlayIngName: {
    fontSize: 13,
    color: Colors.paperDim,
  },
  overlayIngAmount: {
    fontSize: 13,
    color: Colors.goldDim,
  },
});

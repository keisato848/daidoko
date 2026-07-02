/**
 * S06: Cooking Mode screen
 * Full-screen step display with working timer, keep-awake, completion flow
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TimerWidget } from '../../../../src/components/TimerWidget';
import { Colors } from '../../../../src/constants/theme';
import { useKeepAwake } from '../../../../src/hooks/useKeepAwake';
import { getRecipeDetail } from '../../../../src/services/recipe.service';

interface StepData {
  id: string;
  sortOrder: number;
  body: string;
  timerSec: number | null;
  photoPath: string | null;
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
  const [showTimer, setShowTimer] = useState(false);

  // Keep screen awake during cooking
  useKeepAwake();

  const loadData = useCallback(async () => {
    if (!id) return;
    const detail = await getRecipeDetail(id);
    if (!detail) return;

    setRecipeTitle(detail.title);
    setServings(detail.servings);
    setSteps(detail.steps);
    setIngredients(detail.ingredients);
  }, [id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Reset timer view when step changes
  useEffect(() => {
    setShowTimer(false);
  }, [currentStep]);

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

  const handleComplete = () => {
    router.push(`/(tabs)/recipes/${id}/log`);
  };

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

        {current.photoPath && (
          <Image
            source={{ uri: current.photoPath }}
            style={styles.stepPhoto}
            resizeMode="cover"
          />
        )}

        {current.timerSec != null && !showTimer && (
          <Pressable style={styles.timerButton} onPress={() => setShowTimer(true)}>
            <Text style={styles.timerIcon}>⏱</Text>
            <Text style={styles.timerButtonText}>
              {current.timerSec >= 60
                ? `${Math.floor(current.timerSec / 60)}分 タイマーを開始`
                : `${current.timerSec}秒 タイマーを開始`}
            </Text>
          </Pressable>
        )}

        {current.timerSec != null && showTimer && <TimerWidget timerSec={current.timerSec} />}

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
          <Pressable style={styles.navFinish} onPress={handleComplete}>
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
    fontSize: 15, // base
    fontWeight: '400',
    color: Colors.paperDim,
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
    fontSize: 15, // base: レシピ名（コンパクト表示）
    fontWeight: '500',
    color: Colors.paperDim,
    letterSpacing: 0.5,
  },
  headerStep: {
    fontSize: 13, // sm: ステップカウンター
    fontWeight: '400',
    color: Colors.paperDim,
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
    fontSize: 20, // lg: ステップ番号
    fontWeight: '500',
    color: Colors.gold,
  },
  stepBody: {
    fontSize: 20, // lg: 手順テキスト（料理中は大きく読みやすく）
    fontWeight: '400',
    color: Colors.paper,
    textAlign: 'center',
    lineHeight: 34,
    letterSpacing: 0.3,
  },
  stepPhoto: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginTop: 20,
    backgroundColor: '#130E08',
  },
  timerButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timerIcon: {
    fontSize: 17, // md
  },
  timerButtonText: {
    color: Colors.gold,
    fontSize: 17, // md: タイマーボタン
    fontWeight: '500',
  },
  tapHint: {
    fontSize: 12, // xs: ヒントテキスト
    fontWeight: '400',
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
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.goldDim,
    alignItems: 'center',
  },
  navDisabled: {
    borderColor: Colors.border,
  },
  navPrevText: {
    fontSize: 15, // base: ナビゲーションボタン
    fontWeight: '400',
    color: Colors.goldDim,
  },
  navDisabledText: {
    color: Colors.muted,
  },
  navNext: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    alignItems: 'center',
  },
  navNextText: {
    fontSize: 15, // base
    fontWeight: '600',
    color: Colors.bg,
  },
  navFinish: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: '#2A6040',
    borderWidth: 1,
    borderColor: '#3D8A5A',
    alignItems: 'center',
  },
  navFinishText: {
    fontSize: 15, // base
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
    fontSize: 13, // sm: オーバーレイタイトル
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 1,
    marginBottom: 12,
  },
  overlayScroll: {
    flexGrow: 0,
  },
  overlayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  overlayIngName: {
    fontSize: 15, // base: 材料名（オーバーレイ）
    fontWeight: '400',
    color: Colors.paper,
  },
  overlayIngAmount: {
    fontSize: 15, // base: 分量（オーバーレイ）
    fontWeight: '400',
    color: Colors.goldDim,
  },
});

/**
 * S06: Cooking Mode screen
 * Full-screen step display with working timer, keep-awake, completion flow.
 * The timer lives in timer.store and survives step navigation — a chip under
 * the progress bar shows a timer running on another step and jumps back to it.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NumberStepper } from '../../../../src/components/NumberStepper';
import { TimerWidget } from '../../../../src/components/TimerWidget';
import { Colors } from '../../../../src/constants/theme';
import { useKeepAwake } from '../../../../src/hooks/useKeepAwake';
import { getRecipeDetail } from '../../../../src/services/recipe.service';
import { useTimerStore } from '../../../../src/stores/timer.store';
import { scaleAmount, servingRatio } from '../../../../src/utils/shoppingScale';
import { extractPrimaryStepTimer, formatStepTimerLabel } from '../../../../src/utils/stepTimer';

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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
  // 分量換算のターゲット人数（undefined = レシピの基準人数のまま）
  const [targetServings, setTargetServings] = useState<number | undefined>(undefined);
  const timer = useTimerStore();

  // Keep screen awake during cooking
  useKeepAwake();

  // 別レシピのタイマーが残っていたら破棄（同じレシピなら継続表示する）
  useEffect(() => {
    const t = useTimerStore.getState();
    if (t.context && t.context.recipeId !== id) t.clear();
  }, [id]);

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

  // このステップのタイマーがセット済みか（idle でも reset 直後は表示を維持する）
  const timerOnCurrentStep = timer.context?.stepId === current.id && timer.status !== 'idle';
  // 別ステップで動いているタイマー（チップ表示 → タップで戻る）
  const timerOnOtherStep =
    timer.context != null && timer.context.stepId !== current.id && timer.status !== 'idle'
      ? timer.context
      : null;

  // 手順にタイマー未設定でも、本文の時間表現（「10分煮る」）から検出して提案する。
  // ここからの開始は表示時のみで DB には保存しない（#77）。
  const detectedTimer = current.timerSec == null ? extractPrimaryStepTimer(current.body) : null;
  const effectiveTimerSec = current.timerSec ?? detectedTimer?.seconds ?? null;

  const startTimerForStep = (step: StepData, timerSec: number | null) => {
    if (timerSec == null) return;
    const begin = () => {
      const store = useTimerStore.getState();
      store.setup(timerSec, {
        recipeId: id ?? '',
        stepId: step.id,
        stepNumber: step.sortOrder,
      });
      store.start();
    };
    const t = useTimerStore.getState();
    if ((t.status === 'running' || t.status === 'paused') && t.context?.stepId !== step.id) {
      Alert.alert(
        'タイマーを切り替え',
        `手順${t.context?.stepNumber ?? '?'}のタイマーが動いています。停止してこの手順のタイマーを開始しますか？`,
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: '切り替える', onPress: begin },
        ],
      );
      return;
    }
    begin();
  };

  const jumpToTimerStep = () => {
    const stepId = useTimerStore.getState().context?.stepId;
    if (!stepId) return;
    const index = steps.findIndex((s) => s.id === stepId);
    if (index >= 0) setCurrentStep(index);
  };

  const handleComplete = () => {
    useTimerStore.getState().clear();
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

      {/* 別ステップで動いているタイマーのチップ（タップでそのステップへ戻る） */}
      {timerOnOtherStep && (
        <Pressable style={styles.timerChip} onPress={jumpToTimerStep} hitSlop={8}>
          <Text style={styles.timerChipText}>
            ⏱ 手順{timerOnOtherStep.stepNumber}{' '}
            {timer.status === 'finished'
              ? '完了！'
              : timer.status === 'paused'
                ? `${formatMmSs(timer.remainingSec)}（一時停止中）`
                : formatMmSs(timer.remainingSec)}
          </Text>
        </Pressable>
      )}

      {/* Step content */}
      <Pressable style={styles.stepArea} onPress={() => setShowIngredients(true)}>
        <View style={styles.stepNumberCircle}>
          <Text style={styles.stepNumberText}>{current.sortOrder}</Text>
        </View>

        <Text style={styles.stepBody}>{current.body}</Text>

        {current.photoPath && (
          <Image source={{ uri: current.photoPath }} style={styles.stepPhoto} resizeMode="cover" />
        )}

        {effectiveTimerSec != null && !timerOnCurrentStep && (
          <Pressable
            style={styles.timerButton}
            onPress={() => startTimerForStep(current, effectiveTimerSec)}
          >
            <Text style={styles.timerIcon}>⏱</Text>
            <Text style={styles.timerButtonText}>
              {formatStepTimerLabel(effectiveTimerSec)} タイマーを開始
              {detectedTimer != null ? '（本文から検出）' : ''}
            </Text>
          </Pressable>
        )}

        {timerOnCurrentStep && <TimerWidget />}

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
            <Text style={styles.overlayTitle}>材料</Text>
            {servings != null && (
              <View style={styles.overlayStepper}>
                <NumberStepper
                  label="人数"
                  value={targetServings ?? servings}
                  onChange={setTargetServings}
                  suffix="人前"
                  min={1}
                />
              </View>
            )}
            <ScrollView style={styles.overlayScroll}>
              {ingredients.map((ing, i) => (
                <View key={i} style={styles.overlayRow}>
                  <Text style={styles.overlayIngName}>{ing.name}</Text>
                  <Text style={styles.overlayIngAmount}>
                    {scaleAmount(
                      ing.amount,
                      servingRatio(servings, targetServings ?? servings ?? 1),
                    )}
                  </Text>
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
  timerChip: {
    position: 'absolute',
    top: 104,
    right: 16,
    zIndex: 5,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timerChipText: {
    fontSize: 13, // sm: タイマーチップ
    fontWeight: '500',
    color: Colors.gold,
    fontVariant: ['tabular-nums'],
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
  overlayStepper: {
    marginBottom: 10,
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

/**
 * S06: Cooking Mode screen
 * Full-screen step display with working timer, keep-awake, completion flow.
 * The timer lives in timer.store and survives step navigation — a chip under
 * the progress bar shows a timer running on another step and jumps back to it.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NumberStepper } from '../../../../src/components/NumberStepper';
import { PhotoPickerField } from '../../../../src/components/PhotoPickerField';
import { TimerWidget } from '../../../../src/components/TimerWidget';
import { Colors } from '../../../../src/constants/theme';
import { t, tCount } from '../../../../src/i18n';
import { useKeepAwake } from '../../../../src/hooks/useKeepAwake';
import { dialog } from '../../../../src/services/dialog.service';
import { isNativePlatform } from '../../../../src/db/client';
import { resolvePhotoUri } from '../../../../src/services/photo-path';
import { getRecipeDetail, setStepPhoto } from '../../../../src/services/recipe.service';
import { useCookingSessionStore } from '../../../../src/stores/cooking-session.store';
import { useTimerStore } from '../../../../src/stores/timer.store';
import { useUnitSystemStore } from '../../../../src/stores/unitSystem.store';
import { scaleAmount, servingRatio } from '../../../../src/utils/shoppingScale';
import { extractPrimaryStepTimer, formatStepTimerLabel } from '../../../../src/utils/stepTimer';
import {
  convertAmountForDisplay,
  convertTemperaturesForDisplay,
} from '../../../../src/utils/unitSystem';

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
  const unitSystem = useUnitSystemStore((state) => state.system);

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

    // 調理セッションを開始（同じレシピの再開なら保存済みの手順位置が返る —
    // ✕ で閉じても・アプリを再起動しても続きから。docs/画面設計.md S06 349行）
    const store = useCookingSessionStore.getState();
    store.begin({
      recipeId: id,
      recipeTitle: detail.title,
      totalSteps: detail.steps.length,
    });
    const resumed = useCookingSessionStore.getState().session;
    if (resumed && resumed.stepIndex > 0 && resumed.stepIndex < detail.steps.length) {
      setCurrentStep(resumed.stepIndex);
    }
  }, [id]);

  /** 手順移動はここを通す — セッションに位置を刻み、復帰導線が追従する */
  const goToStep = useCallback((index: number) => {
    setCurrentStep(index);
    useCookingSessionStore.getState().setStep(index);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (steps.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>{t('recipe.cook.loading')}</Text>
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

  const startTimerForStep = async (step: StepData, timerSec: number | null) => {
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
    const running = useTimerStore.getState();
    if (
      (running.status === 'running' || running.status === 'paused') &&
      running.context?.stepId !== step.id
    ) {
      const switched = await dialog.confirm({
        title: t('recipe.cook.switchTimerTitle'),
        message: t('recipe.cook.switchTimerBody', { step: running.context?.stepNumber ?? '?' }),
        confirmLabel: t('recipe.cook.switchTimerAction'),
      });
      if (switched) begin();
      return;
    }
    begin();
  };

  const jumpToTimerStep = () => {
    const stepId = useTimerStore.getState().context?.stepId;
    if (!stepId) return;
    const index = steps.findIndex((s) => s.id === stepId);
    if (index >= 0) goToStep(index);
  };

  const handleComplete = () => {
    useTimerStore.getState().clear();
    // 完成 = セッション終了。復帰カード・pill も消える。
    // ✕（router.back）では**終了しない** — それが「あとで続きから」の意味
    useCookingSessionStore.getState().end();
    router.push(`/(tabs)/recipes/${id}/log`);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        {/*
          長いレシピ名でステップ数に食い込まないよう、**名前だけを 1 行に切る**。
          「マッシュルームとベーコンの詰め物アヒージョ1 / 9」のように、名前と
          ステップ数が隙間なくつながって右端で見切れていた（#222）
        */}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {recipeTitle}
        </Text>
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
            {t('recipe.cook.chipStep', { step: timerOnOtherStep.stepNumber })}{' '}
            {timer.status === 'finished'
              ? t('recipe.cook.timerFinished')
              : timer.status === 'paused'
                ? t('recipe.cook.timerPaused', { time: formatMmSs(timer.remainingSec) })
                : formatMmSs(timer.remainingSec)}
          </Text>
        </Pressable>
      )}

      {/* Step content */}
      <Pressable style={styles.stepArea} onPress={() => setShowIngredients(true)}>
        <View style={styles.stepNumberCircle}>
          <Text style={styles.stepNumberText}>{current.sortOrder}</Text>
        </View>

        <Text style={styles.stepBody}>
          {convertTemperaturesForDisplay(current.body, unitSystem)}
        </Text>

        {current.photoPath && (
          <Image source={{ uri: current.photoPath }} style={styles.stepPhoto} resizeMode="cover" />
        )}

        {/* 手順写真をその場で記録する（2026-08-28・ユーザー要望）。
            調理は「写真を撮る一番の現場」なのに、これまでは編集フォームまで
            戻らないと付けられなかった。写真が無い手順にだけチップを出す —
            集中モードの雑味を最小にする（撮り直しは詳細・編集から） */}
        {isNativePlatform && !current.photoPath && (
          <View style={styles.stepPhotoCapture}>
            <PhotoPickerField
              variant="thumb"
              value={undefined}
              onChange={(path) => {
                if (!path) return;
                void setStepPhoto(current.id, path);
                // 画面の手順リストにも即反映（表示は絶対パスに解決してから）
                setSteps((prev) =>
                  prev.map((s) =>
                    s.id === current.id ? { ...s, photoPath: resolvePhotoUri(path) } : s,
                  ),
                );
              }}
            />
          </View>
        )}

        {effectiveTimerSec != null && !timerOnCurrentStep && (
          <Pressable
            style={styles.timerButton}
            onPress={() => void startTimerForStep(current, effectiveTimerSec)}
          >
            <Text style={styles.timerIcon}>⏱</Text>
            <Text style={styles.timerButtonText}>
              {formatStepTimerLabel(effectiveTimerSec)} {t('recipe.cook.startTimer')}
              {detectedTimer != null ? t('recipe.cook.detectedFromBody') : ''}
            </Text>
          </Pressable>
        )}

        {timerOnCurrentStep && <TimerWidget />}

        <Text style={styles.tapHint}>{t('recipe.cook.tapHint')}</Text>
      </Pressable>

      {/* Navigation buttons */}
      <View style={styles.navBar}>
        <Pressable
          style={[styles.navPrev, currentStep === 0 && styles.navDisabled]}
          onPress={() => goToStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
        >
          <Text style={[styles.navPrevText, currentStep === 0 && styles.navDisabledText]}>
            {t('recipe.cook.prev')}
          </Text>
        </Pressable>

        {isLastStep ? (
          <Pressable style={styles.navFinish} onPress={handleComplete}>
            <Text style={styles.navFinishText}>{t('recipe.cook.finish')}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.navNext} onPress={() => goToStep(currentStep + 1)}>
            <Text style={styles.navNextText}>{t('recipe.cook.next')}</Text>
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
            <Text style={styles.overlayTitle}>{t('common.ingredients')}</Text>
            {servings != null && (
              <View style={styles.overlayStepper}>
                <NumberStepper
                  label={t('common.servings')}
                  value={targetServings ?? servings}
                  onChange={setTargetServings}
                  suffix={tCount('recipe.detail.servingsUnit', targetServings ?? servings)}
                  min={1}
                />
              </View>
            )}
            <ScrollView style={styles.overlayScroll}>
              {ingredients.map((ing, i) => (
                <View key={i} style={styles.overlayRow}>
                  <Text style={styles.overlayIngName}>{ing.name}</Text>
                  <Text style={styles.overlayIngAmount}>
                    {convertAmountForDisplay(
                      scaleAmount(
                        ing.amount,
                        servingRatio(servings, targetServings ?? servings ?? 1),
                      ),
                      unitSystem,
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
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    // 名前だけを縮ませる。ステップ数は縮ませない（#222）
    flex: 1,
    textAlign: 'center',
    fontSize: 15, // base: レシピ名（コンパクト表示）
    fontWeight: '500',
    color: Colors.paperDim,
    letterSpacing: 0.5,
  },
  headerStep: {
    flexShrink: 0,
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
  stepPhotoCapture: {
    marginTop: 14,
    alignItems: 'center',
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
    // muted だと背景と同化して気づかれない（ペルソナレビュー 1.12.2 #5 —
    // 老眼では「見過ごし確実」）。ここに気づけないと材料を見る手段が無い
    color: Colors.paperDim,
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
    // レシピ詳細の材料行と同じ扱い（#222）。**ここは同じ getRecipeDetail の材料を
    // 同じ形で並べているので、詳細だけ直すと料理中の材料シートに重なりが残る**
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  overlayIngName: {
    flex: 1,
    flexShrink: 1,
    fontSize: 15, // base: 材料名（オーバーレイ）
    fontWeight: '400',
    color: Colors.paper,
  },
  overlayIngAmount: {
    flexShrink: 0,
    textAlign: 'right',
    fontSize: 15, // base: 分量（オーバーレイ）
    fontWeight: '400',
    color: Colors.goldDim,
  },
});

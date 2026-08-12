/**
 * R2: お店の味に近づける（Issue #113）
 *
 * 感想（＋任意の写真）で既存レシピを AI に直させ、**差分を見せてから**確定する。
 * AI が黙って書き換えないことがこの画面の要件なので、保存前に必ず差分を出す。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, ChevronLeft, Image as ImageIcon, Store, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { KeyboardAvoider } from '../../../../src/components/KeyboardAvoider';
import { Loading } from '../../../../src/components/Loading';
import { t } from '../../../../src/i18n';
import { Toast } from '../../../../src/components/Toast';
import { Colors } from '../../../../src/constants/theme';
import { getLogsForRecipe } from '../../../../src/services/cooking-log.service';
import { expoImagePickerPhotoCaptureAdapter } from '../../../../src/services/expo-photo-capture.adapter';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  type CapturedPhoto,
  type PhotoCaptureSource,
} from '../../../../src/services/photo-capture.service';
import {
  refineRecipe,
  type RefinePhoto,
  type RefineRecipeSnapshot,
} from '../../../../src/services/recipe-refine.provider';
import { getRecipeDetail, updateRecipe } from '../../../../src/services/recipe.service';
import type { RecipeDetail } from '../../../../src/services/types';
import { ensureInferenceCredit } from '../../../../src/services/inference-gate.service';
import { recordCloudInference } from '../../../../src/services/usage.service';
import { VisionInferenceError } from '../../../../src/services/vision-recipe.provider';
import {
  diffRecipes,
  onlyChanged,
  type DiffRow,
  type RecipeDiff,
} from '../../../../src/utils/recipeDiff';
import { mergeRefinedSteps } from '../../../../src/utils/refineSteps';
import type { RecipeFormData } from '../../../../src/validation/recipe.schema';

type Phase = 'input' | 'processing' | 'preview' | 'saving';

/** RecipeDetail → フォーム形。差分の「変更前」としても使う。 */
function toFormData(recipe: RecipeDetail): RecipeFormData {
  return {
    title: recipe.title,
    titleReading: '',
    description: recipe.description ?? '',
    ...(recipe.servings !== null && { servings: recipe.servings }),
    ...(recipe.cookTimeMin !== null && { cookTimeMin: recipe.cookTimeMin }),
    ingredients: recipe.ingredients.map((ing) => ({
      groupLabel: ing.groupLabel ?? '',
      name: ing.name,
      amount: ing.amount ?? '',
      note: ing.note ?? '',
    })),
    steps: recipe.steps.map((step) => ({ body: step.body })),
    tags: recipe.tags,
  };
}

function toSnapshot(form: RecipeFormData): RefineRecipeSnapshot {
  return {
    title: form.title,
    ...(form.servings !== undefined && { servings: form.servings }),
    ...(form.cookTimeMin !== undefined && { cookTimeMin: form.cookTimeMin }),
    ...(form.description ? { description: form.description } : {}),
    ingredients: form.ingredients.map((ing) => ({
      ...(ing.groupLabel ? { groupLabel: ing.groupLabel } : {}),
      name: ing.name,
      ...(ing.amount ? { amount: ing.amount } : {}),
      ...(ing.note ? { note: ing.note } : {}),
    })),
    steps: form.steps.map((step) => ({ body: step.body })),
    ...(form.tags.length > 0 && { tags: form.tags }),
  };
}

function DiffSection({ title, rows }: { title: string; rows: DiffRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.diffSection}>
      <Text style={styles.diffSectionTitle}>{title}</Text>
      {rows.map((row, index) => (
        <View key={`${row.label}-${index}`} style={styles.diffRow}>
          <View style={styles.diffLabelRow}>
            <Text style={[styles.diffBadge, styles[`badge_${row.kind}`]]}>
              {row.kind === 'added'
                ? t('recipe.refine.badge.added')
                : row.kind === 'removed'
                  ? t('recipe.refine.badge.removed')
                  : t('recipe.refine.badge.changed')}
            </Text>
            <Text style={styles.diffLabel}>{row.label}</Text>
          </View>
          {row.before !== undefined && (
            <Text style={styles.diffBefore} numberOfLines={4}>
              {row.before}
            </Text>
          )}
          {row.after !== undefined && (
            <Text style={styles.diffAfter} numberOfLines={6}>
              {row.after}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

export default function RefineRecipeScreen() {
  // feedback: 調理記録の直後に来たときは、そのとき書いたメモが入っている
  const { id, feedback: initialFeedback } = useLocalSearchParams<{
    id: string;
    feedback?: string;
  }>();
  const router = useRouter();

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('input');
  const [feedback, setFeedback] = useState(initialFeedback ?? '');
  const [cookedPhoto, setCookedPhoto] = useState<CapturedPhoto | null>(null);
  /** R1 の「お店で食べた」記録の写真。ユーザーには撮らせず自動で添える */
  const [targetPhotoUri, setTargetPhotoUri] = useState<string | null>(null);
  const [refined, setRefined] = useState<RecipeFormData | null>(null);
  const [changeSummary, setChangeSummary] = useState('');
  const [diff, setDiff] = useState<RecipeDiff | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!id) {
      setIsLoading(false);
      return;
    }
    void (async () => {
      const [detail, logs] = await Promise.all([getRecipeDetail(id), getLogsForRecipe(id)]);
      if (!mounted) return;
      setRecipe(detail);
      // 目標の写真 = 直近の「お店で食べた」記録の1枚目
      const eatenOut = logs.find((log) => log.kind === 'eaten_out' && log.photos.length > 0);
      setTargetPhotoUri(eatenOut?.photos[0]?.localPath ?? null);
      setIsLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  const handleAddPhoto = useCallback(async (source: PhotoCaptureSource) => {
    try {
      setCookedPhoto(await capturePhoto(source, expoImagePickerPhotoCaptureAdapter));
    } catch (error) {
      if (error instanceof PhotoCaptureCancelledError) return;
      Alert.alert(
        t('common.photoAddFailed'),
        error instanceof Error ? error.message : t('common.photoAddFailed'),
      );
    }
  }, []);

  const handleRefine = useCallback(async () => {
    if (!recipe || !feedback.trim()) return;
    setErrorMsg(null);

    // 枠切れなら、その場で広告視聴を持ちかけてそのまま続行する（2026-08-12）。
    // ペイウォールは広告を出せないとき（視聴上限・no-fill）の逃げ道
    const gate = await ensureInferenceCredit();
    if (gate === 'paywall') {
      router.push('/recipes/paywall');
      return;
    }
    if (gate !== 'ready') return;

    const before = toFormData(recipe);
    const photos: RefinePhoto[] = [];
    if (cookedPhoto) photos.push({ uri: cookedPhoto.localPath, role: 'cooked' });
    if (targetPhotoUri) photos.push({ uri: targetPhotoUri, role: 'target' });

    setPhase('processing');
    try {
      const result = await refineRecipe({
        recipe: toSnapshot(before),
        feedback: feedback.trim(),
        ...(photos.length > 0 && { photos }),
      });
      await recordCloudInference();
      setRefined(result.draft);
      setChangeSummary(result.changeSummary);
      setDiff(diffRecipes(before, result.draft));
      setPhase('preview');
    } catch (error) {
      setErrorMsg(
        error instanceof VisionInferenceError ? error.message : t('recipe.refine.genericFailed'),
      );
      setPhase('input');
    }
  }, [recipe, feedback, cookedPhoto, targetPhotoUri, router]);

  const handleSave = useCallback(async () => {
    if (!recipe || !refined) return;
    setPhase('saving');
    try {
      await updateRecipe(recipe.id, {
        title: refined.title,
        ...(refined.description ? { description: refined.description } : {}),
        ...(refined.servings !== undefined && { servings: refined.servings }),
        ...(refined.cookTimeMin !== undefined && { cookTimeMin: refined.cookTimeMin }),
        // 感想を版のメモとして残す。あとから「なぜこう変えたか」を辿れる
        authorNote: feedback.trim(),
        ingredients: refined.ingredients.map((ing) => ({
          ...(ing.groupLabel ? { groupLabel: ing.groupLabel } : {}),
          name: ing.name,
          ...(ing.amount ? { amount: ing.amount } : {}),
          ...(ing.note ? { note: ing.note } : {}),
        })),
        // タイマー・手順写真を引き継ぐ（丸ごと入れ替えると消えるため）
        steps: mergeRefinedSteps(recipe.steps, refined.steps),
        tags: refined.tags,
        coverPhotoPath: recipe.coverPhotoPath,
        // 味の微調整なので minor 版として積む
        isMajor: false,
      });
      setShowToast(true);
      setTimeout(() => router.replace(`/(tabs)/recipes/${recipe.id}`), 1200);
    } catch (error) {
      Alert.alert(
        t('recipe.refine.saveFailedTitle'),
        error instanceof Error ? error.message : t('recipe.refine.saveFailedBody'),
      );
      setPhase('preview');
    }
  }, [recipe, refined, feedback, router]);

  if (isLoading) return <Loading />;

  if (!recipe) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{t('recipe.refine.notFound')}</Text>
      </View>
    );
  }

  const changedIngredients = diff ? onlyChanged(diff.ingredients) : [];
  const changedSteps = diff ? onlyChanged(diff.steps) : [];

  return (
    <KeyboardAvoider style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={20} color={Colors.goldDim} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('recipe.refine.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.recipeTitle}>{recipe.title}</Text>

        {phase === 'preview' && diff ? (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{t('recipe.refine.summaryLabel')}</Text>
              <Text style={styles.summaryText}>{changeSummary}</Text>
            </View>

            {diff.hasChanges ? (
              <>
                <DiffSection title={t('recipe.refine.diffMeta')} rows={diff.meta} />
                <DiffSection title={t('common.ingredients')} rows={changedIngredients} />
                <DiffSection title={t('common.steps')} rows={changedSteps} />
                <Text style={styles.diffHint}>{t('recipe.refine.diffGuarantee')}</Text>
                {/* AI が材料を「増やす」ことがある経路なので、写真レシピより強く注意を出す。
                    アレルゲンの検出・警告は行わない方針（docs/privacy-policy.md §7） */}
                <View style={styles.cautionCard}>
                  <Text style={styles.cautionText}>{t('recipe.refine.caution')}</Text>
                </View>
              </>
            ) : (
              <View style={styles.noticeCard}>
                <Text style={styles.noticeText}>{t('recipe.refine.noticeNoChange')}</Text>
              </View>
            )}
          </>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('recipe.refine.feedbackLabel')}</Text>
              <TextInput
                style={styles.feedbackInput}
                value={feedback}
                onChangeText={setFeedback}
                placeholder={t('recipe.refine.feedbackPlaceholder')}
                placeholderTextColor={Colors.muted}
                multiline
                textAlignVertical="top"
                maxLength={1000}
                editable={phase === 'input'}
              />
              <Text style={styles.charCount}>{feedback.length} / 1000</Text>
              <Text style={styles.sectionHint}>{t('recipe.refine.feedbackHint')}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('recipe.refine.photoLabel')}</Text>
              <Text style={styles.sectionHint}>{t('recipe.refine.photoHint')}</Text>
              {cookedPhoto ? (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: cookedPhoto.localPath }} style={styles.photoPreview} />
                  <Pressable
                    style={styles.photoRemoveButton}
                    onPress={() => setCookedPhoto(null)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.deletePhoto')}
                  >
                    <Trash2 size={13} color={Colors.bg} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.photoActions}>
                  <Pressable
                    style={styles.photoAddButton}
                    onPress={() => handleAddPhoto('camera')}
                    disabled={phase !== 'input'}
                  >
                    <Camera color={Colors.gold} size={18} />
                    <Text style={styles.photoAddText}>{t('common.takePhoto')}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.photoAddButton}
                    onPress={() => handleAddPhoto('gallery')}
                    disabled={phase !== 'input'}
                  >
                    <ImageIcon color={Colors.gold} size={18} />
                    <Text style={styles.photoAddText}>{t('common.pickFromGallery')}</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {targetPhotoUri && (
              <View style={styles.targetCard}>
                <Image source={{ uri: targetPhotoUri }} style={styles.targetThumb} />
                <View style={styles.targetTextWrap}>
                  <View style={styles.targetLabelRow}>
                    <Store size={13} color={Colors.gold} />
                    <Text style={styles.targetLabel}>{t('recipe.refine.targetLabel')}</Text>
                  </View>
                  <Text style={styles.targetHint}>{t('recipe.refine.targetHint')}</Text>
                </View>
              </View>
            )}

            {errorMsg && (
              <View style={styles.errorCard}>
                <Text style={styles.errorCardText}>{errorMsg}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {phase === 'preview' ? (
          <View style={styles.footerRow}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setPhase('input');
                setDiff(null);
                setRefined(null);
              }}
            >
              <Text style={styles.secondaryButtonText}>{t('recipe.refine.retry')}</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, !diff?.hasChanges && styles.primaryButtonDisabled]}
              onPress={handleSave}
              disabled={!diff?.hasChanges}
            >
              <Text style={styles.primaryButtonText}>{t('recipe.refine.saveThis')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[
              styles.primaryButton,
              (phase !== 'input' || !feedback.trim()) && styles.primaryButtonDisabled,
            ]}
            onPress={handleRefine}
            disabled={phase !== 'input' || !feedback.trim()}
          >
            <Text style={styles.primaryButtonText}>
              {phase === 'processing' ? t('recipe.refine.processing') : t('recipe.refine.start')}
            </Text>
          </Pressable>
        )}
      </View>

      <Toast
        message={t('recipe.refine.updated')}
        visible={showToast}
        onDismiss={() => setShowToast(false)}
      />
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: { flexDirection: 'row', alignItems: 'center', width: 72 },
  backText: { fontSize: 13, fontWeight: '400', color: Colors.goldDim },
  headerTitle: { fontSize: 16, fontWeight: '500', color: Colors.paper, letterSpacing: 0.5 },
  headerSpacer: { width: 72 },
  scrollContent: { paddingBottom: 120 },
  recipeTitle: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paperDim,
    paddingHorizontal: 24,
    paddingTop: 18,
  },
  section: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionHint: { fontSize: 12, fontWeight: '400', color: Colors.muted, lineHeight: 18 },
  feedbackInput: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
    minHeight: 110,
    lineHeight: 22,
  },
  charCount: { fontSize: 12, fontWeight: '400', color: Colors.muted, textAlign: 'right' },
  photoActions: { flexDirection: 'row', gap: 10 },
  photoAddButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    backgroundColor: Colors.bgCard,
  },
  photoAddText: { fontSize: 14, fontWeight: '500', color: Colors.paper },
  photoPreviewWrap: {
    width: 120,
    height: 120,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  photoPreview: { width: '100%', height: '100%' },
  photoRemoveButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.bgCard,
  },
  targetThumb: { width: 52, height: 52, borderRadius: 6 },
  targetTextWrap: { flex: 1, gap: 4 },
  targetLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  targetLabel: { fontSize: 13, fontWeight: '500', color: Colors.paper },
  targetHint: { fontSize: 12, fontWeight: '400', color: Colors.muted },
  summaryCard: {
    marginHorizontal: 24,
    marginTop: 18,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.gold,
    backgroundColor: Colors.bgCard,
    gap: 6,
  },
  summaryLabel: { fontSize: 12, fontWeight: '500', color: Colors.goldDim, letterSpacing: 1 },
  summaryText: { fontSize: 14, fontWeight: '400', color: Colors.paper, lineHeight: 21 },
  diffSection: { paddingHorizontal: 24, paddingTop: 20, gap: 10 },
  diffSectionTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  diffRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 6,
    backgroundColor: Colors.bgCard,
  },
  diffLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diffLabel: { fontSize: 14, fontWeight: '500', color: Colors.paper, flex: 1 },
  diffBadge: {
    fontSize: 11,
    fontWeight: '500',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  badge_changed: { color: Colors.bg, backgroundColor: Colors.gold },
  badge_added: { color: Colors.bg, backgroundColor: '#7FB77E' },
  badge_removed: { color: Colors.bg, backgroundColor: '#C97F7F' },
  badge_unchanged: { color: Colors.muted, backgroundColor: Colors.border },
  diffBefore: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.muted,
    textDecorationLine: 'line-through',
    lineHeight: 20,
  },
  diffAfter: { fontSize: 14, fontWeight: '400', color: Colors.paper, lineHeight: 21 },
  diffHint: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.muted,
    paddingHorizontal: 24,
    paddingTop: 18,
    lineHeight: 18,
  },
  cautionCard: {
    marginHorizontal: 24,
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.goldDim,
    backgroundColor: Colors.bgCard,
  },
  cautionText: { fontSize: 12, fontWeight: '400', color: Colors.paperDim, lineHeight: 19 },
  noticeCard: {
    marginHorizontal: 24,
    marginTop: 18,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  noticeText: { fontSize: 13, fontWeight: '400', color: Colors.paperDim, lineHeight: 20 },
  errorCard: {
    marginHorizontal: 24,
    marginTop: 18,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C97F7F',
    backgroundColor: Colors.bgCard,
  },
  errorCardText: { fontSize: 13, fontWeight: '400', color: Colors.paper, lineHeight: 20 },
  errorText: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.paperDim,
    textAlign: 'center',
    marginTop: 80,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerRow: { flexDirection: 'row', gap: 10 },
  primaryButton: {
    flex: 1,
    backgroundColor: Colors.gold,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontSize: 15, fontWeight: '600', color: Colors.bg, letterSpacing: 1 },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '500', color: Colors.paper, letterSpacing: 1 },
});

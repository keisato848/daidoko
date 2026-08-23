/**
 * S10: 紙面からレシピを読み取る画面。
 *
 * **中身は端末内 OCR から AI に置き換わった**（`docs/レシピ推論の評価設計.md` §10）。
 * ML Kit は版面が少しでも複雑だと 1 文を断片に割ってしまい、実際のレシピ本や
 * 食品パッケージでは成立しなかった。ルート名（`import-ocr`）は 8 ファイルが
 * 参照しているのでそのまま。利用者に見える名前（「文字入り画像から作成」）も変わらない。
 *
 * 端末内 OCR との違い:
 * - **写真がサーバーへ出る** → 開示を必ず出す（`recipeImport.page.disclosure`）
 * - **無料枠を消費する** → `ensureInferenceCredit()` を通す
 * - **オフラインでは使えない**
 * - **iOS でも使える**（ML Kit は Android 限定だった）
 * - **複数枚を 1 つのレシピにまとめられる**（表に料理名・裏に材料と作り方）
 */
import { useRouter } from 'expo-router';
import { Camera, Image as ImageIcon, PenLine, Plus, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { RecipeForm } from '../../../src/components/RecipeForm';
import { SourceBanner } from '../../../src/components/SourceBanner';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { t, tCount } from '../../../src/i18n';
import { ensureInferenceCredit } from '../../../src/services/inference-gate.service';
import { expoImagePickerPhotoCaptureAdapter } from '../../../src/services/expo-photo-capture.adapter';
import {
  capturePhoto,
  capturePhotosFromGallery,
  PhotoCaptureCancelledError,
  UserFacingError,
  type CapturedPhoto,
} from '../../../src/services/photo-capture.service';
import {
  MAX_RECIPE_PAGE_IMAGES,
  readRecipeFromPages,
  RecipePageError,
  type RecipePageResult,
} from '../../../src/services/recipe-page.provider';
import { createRecipe } from '../../../src/services/recipe.service';
import { createOcrSource } from '../../../src/services/source.service';
import { recordCloudInference } from '../../../src/services/usage.service';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'select' | 'processing' | 'preview';

function accuracyLabel(confidence: RecipePageResult['confidence']): string {
  if (confidence === 'high') return t('recipeImport.ocr.accuracy.high');
  if (confidence === 'medium') return t('recipeImport.ocr.accuracy.medium');
  return t('recipeImport.ocr.accuracy.low');
}

export default function ImportRecipePageScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [pages, setPages] = useState<CapturedPhoto[]>([]);
  const [result, setResult] = useState<RecipePageResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleManual = () => router.replace('/recipes/new');

  const addFromCamera = useCallback(async () => {
    setErrorMsg(null);
    try {
      const photo = await capturePhoto('camera', expoImagePickerPhotoCaptureAdapter);
      setPages((current) => [...current, photo].slice(0, MAX_RECIPE_PAGE_IMAGES));
    } catch (error) {
      if (error instanceof PhotoCaptureCancelledError) return;
      setErrorMsg(error instanceof UserFacingError ? error.message : t('common.photoAddFailed'));
    }
  }, []);

  const addFromGallery = useCallback(async () => {
    setErrorMsg(null);
    try {
      const remaining = MAX_RECIPE_PAGE_IMAGES - pages.length;
      const picked = await capturePhotosFromGallery(expoImagePickerPhotoCaptureAdapter, remaining);
      if (picked.length === 0) return;
      setPages((current) => [...current, ...picked].slice(0, MAX_RECIPE_PAGE_IMAGES));
    } catch (error) {
      setErrorMsg(error instanceof UserFacingError ? error.message : t('common.photoAddFailed'));
    }
  }, [pages.length]);

  const removePage = useCallback((index: number) => {
    setPages((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleRead = useCallback(async () => {
    if (pages.length === 0) return;
    setErrorMsg(null);

    // 枠切れなら、その場で広告視聴を持ちかけて続行する（端末内 OCR のときは無料だった）
    const gate = await ensureInferenceCredit();
    if (gate === 'paywall') {
      router.push('/recipes/paywall');
      return;
    }
    if (gate !== 'ready') return;

    setPhase('processing');
    try {
      const read = await readRecipeFromPages({ imageUris: pages.map((page) => page.localPath) });
      void recordCloudInference().catch(() => undefined);
      setResult(read);
      setPhase('preview');
    } catch (error) {
      setErrorMsg(error instanceof RecipePageError ? error.message : t('recipeImport.page.failed'));
      setPhase('select');
    }
  }, [pages, router]);

  const handleSave = useCallback(
    async (data: RecipeFormData) => {
      const sourceId = await createOcrSource({
        rawText: '',
        capturedAt: pages[0]?.takenAt,
      });
      await createRecipe({ ...data, sourceId });
      setToastMessage(t('recipeImport.saved'));
      setTimeout(() => router.replace('/(tabs)/recipes'), 1500);
    },
    [pages, router],
  );

  if (phase === 'preview' && result) {
    return (
      <View style={styles.container}>
        <SourceBanner
          icon={<Camera size={12} color={Colors.goldDim} />}
          text={accuracyLabel(result.confidence)}
        />
        <RecipeForm
          initialValues={result.draft}
          onSubmit={handleSave}
          onCancel={() => setPhase('select')}
          title={t('recipeImport.page.formTitle')}
          submitLabel={t('common.save')}
          topInset={false}
        />
        <Toast
          message={toastMessage ?? ''}
          visible={toastMessage != null}
          onDismiss={() => setToastMessage(null)}
        />
      </View>
    );
  }

  const canAddMore = pages.length < MAX_RECIPE_PAGE_IMAGES;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('recipeImport.page.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {pages.length === 0 && (
          <View style={styles.iconWrapper}>
            <Camera size={48} color={Colors.gold} />
          </View>
        )}

        <Text style={styles.title}>{t('recipeImport.page.heading')}</Text>
        <Text style={styles.description}>{t('recipeImport.page.lead')}</Text>
        <Text style={styles.hintText}>
          {t('recipeImport.page.multiHint', { max: MAX_RECIPE_PAGE_IMAGES })}
        </Text>

        {pages.length > 0 && (
          <>
            <Text style={styles.countText}>
              {tCount('recipeImport.page.pageCount', pages.length)}
            </Text>
            <View style={styles.pageRow}>
              {pages.map((page, index) => (
                <View key={`${page.localPath}-${index}`} style={styles.pageThumbWrapper}>
                  <Image source={{ uri: page.localPath }} style={styles.pageThumb} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('recipeImport.page.removePage')}
                    style={styles.pageRemove}
                    onPress={() => removePage(index)}
                    hitSlop={8}
                  >
                    <X size={13} color={Colors.paper} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}

        {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

        {phase === 'processing' ? (
          <View style={styles.processingBox}>
            <ActivityIndicator size="large" color={Colors.gold} />
            <Text style={styles.processingText}>{t('recipeImport.page.reading')}</Text>
          </View>
        ) : (
          <View style={styles.actionGrid}>
            {pages.length > 0 && (
              <Pressable
                accessibilityRole="button"
                style={styles.primaryButton}
                onPress={() => void handleRead()}
              >
                <Camera size={18} color={Colors.bg} />
                <Text style={styles.primaryButtonText}>{t('recipeImport.page.formTitle')}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.takePhoto')}
              style={[
                pages.length > 0 ? styles.secondaryButton : styles.primaryButton,
                !canAddMore && styles.buttonDisabled,
              ]}
              onPress={() => void addFromCamera()}
              disabled={!canAddMore}
            >
              {pages.length > 0 ? (
                <Plus size={18} color={Colors.gold} />
              ) : (
                <Camera size={18} color={Colors.bg} />
              )}
              <Text
                style={pages.length > 0 ? styles.secondaryButtonText : styles.primaryButtonText}
              >
                {pages.length > 0 ? t('recipeImport.page.addPage') : t('common.takePhoto')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.pickFromGallery')}
              style={[styles.secondaryButton, !canAddMore && styles.buttonDisabled]}
              onPress={() => void addFromGallery()}
              disabled={!canAddMore}
            >
              <ImageIcon size={18} color={Colors.gold} />
              <Text style={styles.secondaryButtonText}>{t('common.pickFromGallery')}</Text>
            </Pressable>
          </View>
        )}

        {/* 送信先の開示。**撮る前に見えている**必要があるので、ボタンの直下に置く */}
        <Text style={styles.disclosureText}>{t('recipeImport.page.disclosure')}</Text>

        <View style={styles.divider} />

        <Text style={styles.altLabel}>{t('recipeImport.ocr.manualLabel')}</Text>
        <Pressable style={styles.manualButton} onPress={handleManual}>
          <PenLine size={18} color={Colors.bg} />
          <Text style={styles.manualButtonText}>{t('recipeImport.ocr.manualAction')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
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
    fontSize: 15,
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 0.5,
  },
  headerSpacer: { width: 20 },
  body: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 36,
    gap: 14,
  },
  iconWrapper: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.paper,
    textAlign: 'center',
  },
  description: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
    textAlign: 'center',
    lineHeight: 22,
  },
  hintText: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  countText: {
    fontSize: 12,
    color: Colors.goldDim,
  },
  pageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  pageThumbWrapper: {
    width: 92,
    height: 122,
  },
  pageThumb: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#130E08',
  },
  pageRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 13,
    color: '#F2A07B',
    textAlign: 'center',
    lineHeight: 20,
  },
  processingBox: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  processingText: {
    fontSize: 13,
    color: Colors.paperDim,
  },
  actionGrid: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.gold,
    paddingVertical: 13,
    borderRadius: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: '#130E08',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.gold,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  disclosureText: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 17,
  },
  divider: {
    width: '60%',
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 8,
  },
  altLabel: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.gold,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 8,
  },
  manualButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
  },
});

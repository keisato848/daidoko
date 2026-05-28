/**
 * S11: Food photo import screen
 * On native: camera capture → image labels → editable recipe draft
 */
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { Camera, Image as ImageIcon, PenLine, RotateCcw, Sparkles, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  runRecipePhotoAgent,
  type RecipePhotoAgentOutput,
} from '../../../src/agents/recipe-photo.agent';
import { RecipeForm } from '../../../src/components/RecipeForm';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import {
  createClientImageLabeler,
  isClientImageLabelingAvailable,
} from '../../../src/services/client-image-label.provider';
import { createClientOcrRecognizer } from '../../../src/services/client-ocr.provider';
import { expoImageManipulatorPreprocessAdapter } from '../../../src/services/expo-image-preprocess.adapter';
import { expoImagePickerPhotoCaptureAdapter } from '../../../src/services/expo-photo-capture.adapter';
import { PHOTO_RECIPE_BATCH_FIXTURES } from '../../../src/e2e/photo-recipe-batch-fixtures';
import { preprocessImageForOcr } from '../../../src/services/image-preprocess.service';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  type CapturedPhoto,
  type PhotoCaptureSource,
} from '../../../src/services/photo-capture.service';
import { createRecipe } from '../../../src/services/recipe.service';
import { createPhotoSource } from '../../../src/services/source.service';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';
import photoRecipeE2eFixtureImage from '../../../assets/e2e/food-photo-ja.png';

type Phase = 'select' | 'processing' | 'preview';

interface BatchValidationSummary {
  total: number;
  pass: number;
  fail: number;
  withText: number;
  withLabels: number;
  exactTitleMatches: number;
  failures: string[];
}

const isAndroid = Platform.OS === 'android';
const isPhotoRecipeE2eEnabled =
  process.env.EXPO_PUBLIC_ENABLE_PHOTO_RECIPE_E2E === '1' ||
  process.env.EXPO_PUBLIC_ENABLE_OCR_E2E === '1';

const CONFIDENCE_LABEL: Record<RecipePhotoAgentOutput['confidence'], string> = {
  high: '推測信頼度: 高',
  medium: '推測信頼度: 中',
  low: '推測信頼度: 低',
};

async function loadPhotoRecipeE2eFixturePhoto(): Promise<CapturedPhoto> {
  const asset = Asset.fromModule(photoRecipeE2eFixtureImage);
  await asset.downloadAsync();
  const localPath = asset.localUri ?? asset.uri;
  if (!localPath) throw new Error('料理写真 E2E テスト画像を読み込めませんでした');

  return {
    localPath,
    source: 'gallery',
    width: asset.width || undefined,
    height: asset.height || undefined,
    mimeType: 'image/png',
    takenAt: new Date().toISOString(),
    temporary: false,
  };
}

async function loadPhotoRecipeBatchFixturePhoto(
  fixture: (typeof PHOTO_RECIPE_BATCH_FIXTURES)[number],
): Promise<CapturedPhoto> {
  const asset = Asset.fromModule(fixture.image);
  await asset.downloadAsync();
  const localPath = asset.localUri ?? asset.uri;
  if (!localPath) throw new Error(`${fixture.id} を読み込めませんでした`);

  return {
    localPath,
    source: 'gallery',
    width: asset.width || undefined,
    height: asset.height || undefined,
    mimeType: 'image/png',
    takenAt: new Date().toISOString(),
    temporary: false,
  };
}

function normalizeForComparison(value: string): string {
  return value.replace(/[\s\u3000・、。.,，．:：\-ー]/g, '').toLowerCase();
}

function hasSaveReadyDraft(data: RecipePhotoAgentOutput): boolean {
  return (
    data.draft.title.trim().length > 0 &&
    data.draft.ingredients.some((item) => item.name.trim().length > 0) &&
    data.draft.steps.some((item) => item.body.trim().length > 0) &&
    Boolean((data.rawText && data.rawText.trim()) || data.labelSummary.trim())
  );
}

export default function ImportPhotoScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [providerReady, setProviderReady] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [photoResult, setPhotoResult] = useState<RecipePhotoAgentOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchValidationSummary | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!isAndroid) {
      setProviderReady(false);
      return () => {
        mounted = false;
      };
    }

    isClientImageLabelingAvailable()
      .then((available) => {
        if (mounted) setProviderReady(available);
      })
      .catch(() => {
        if (mounted) setProviderReady(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleManual = () => {
    router.replace('/recipes/new');
  };

  const preprocessForAgent = useCallback(async (imageUri: string) => {
    const processed = await preprocessImageForOcr(imageUri, expoImageManipulatorPreprocessAdapter);
    return {
      imageUri: processed.imageUri,
      warnings: processed.warnings.map((warning) => warning.message),
    };
  }, []);

  const inferPhoto = useCallback(
    async (photo: CapturedPhoto, options: { preprocessImage?: boolean } = {}) => {
      setCapturedPhoto(photo);
      const shouldPreprocess = options.preprocessImage ?? true;

      const result = await runRecipePhotoAgent(
        { imageUri: photo.localPath },
        {
          preprocessImage: shouldPreprocess ? preprocessForAgent : undefined,
          labelImage: createClientImageLabeler(),
          recognizeText: createClientOcrRecognizer(),
        },
      );

      if (!result.ok || !result.data) {
        setErrorMsg(result.error?.message ?? '料理写真の推測に失敗しました');
        setPhase('select');
        return;
      }

      setPhotoResult(result.data);
      setPhase('preview');
    },
    [preprocessForAgent],
  );

  const handleRead = useCallback(
    async (source: PhotoCaptureSource) => {
      setErrorMsg(null);
      setPhase('processing');
      setPhotoResult(null);

      try {
        const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
        await inferPhoto(photo);
      } catch (error) {
        if (error instanceof PhotoCaptureCancelledError) {
          setPhase('select');
          return;
        }
        setErrorMsg(error instanceof Error ? error.message : '料理写真の推測に失敗しました');
        setPhase('select');
      }
    },
    [inferPhoto],
  );

  const handleReadE2eFixture = useCallback(async () => {
    setErrorMsg(null);
    setPhase('processing');
    setPhotoResult(null);

    try {
      const photo = await loadPhotoRecipeE2eFixturePhoto();
      await inferPhoto(photo, { preprocessImage: false });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '料理写真の推測に失敗しました');
      setPhase('select');
    }
  }, [inferPhoto]);

  const handleRunBatchValidation = useCallback(async () => {
    setErrorMsg(null);
    setPhotoResult(null);
    setCapturedPhoto(null);
    setBatchSummary(null);
    setPhase('processing');

    const total = PHOTO_RECIPE_BATCH_FIXTURES.length;
    const failures: string[] = [];
    let pass = 0;
    let withText = 0;
    let withLabels = 0;
    let exactTitleMatches = 0;

    try {
      const labelImage = createClientImageLabeler();
      const recognizeText = createClientOcrRecognizer();

      for (const [index, fixture] of PHOTO_RECIPE_BATCH_FIXTURES.entries()) {
        setBatchProgress({ done: index, total });
        const photo = await loadPhotoRecipeBatchFixturePhoto(fixture);
        const result = await runRecipePhotoAgent(
          { imageUri: photo.localPath },
          { labelImage, recognizeText },
        );

        if (!result.ok || !result.data || !hasSaveReadyDraft(result.data)) {
          failures.push(`${fixture.id}: 入力可能な下書きを作成できませんでした`);
          continue;
        }

        pass += 1;
        if (result.data.rawText?.trim()) withText += 1;
        if (result.data.labelSummary.trim()) withLabels += 1;

        const actualTitle = normalizeForComparison(result.data.draft.title);
        const expectedTitle = normalizeForComparison(fixture.title);
        if (actualTitle.includes(expectedTitle) || expectedTitle.includes(actualTitle)) {
          exactTitleMatches += 1;
        }
      }

      setBatchSummary({
        total,
        pass,
        fail: total - pass,
        withText,
        withLabels,
        exactTitleMatches,
        failures: failures.slice(0, 5),
      });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '100画像検証に失敗しました');
    } finally {
      setBatchProgress(null);
      setPhase('select');
    }
  }, []);

  const handleSave = useCallback(
    async (data: RecipeFormData) => {
      if (!photoResult) return;
      const sourceId = await createPhotoSource({
        labelSummary: photoResult.evidenceSummary ?? photoResult.labelSummary,
        capturedAt: capturedPhoto?.takenAt,
      });
      await createRecipe({ ...data, sourceId });
      setToastMessage('レシピを保存しました');
      setTimeout(() => router.replace('/(tabs)/recipes'), 1500);
    },
    [capturedPhoto?.takenAt, photoResult, router],
  );

  if (phase === 'preview') {
    return (
      <View style={styles.container}>
        {photoResult && (
          <View style={styles.sourceBanner}>
            <Sparkles size={12} color={Colors.goldDim} />
            <Text style={styles.sourceName}>
              {[CONFIDENCE_LABEL[photoResult.confidence], ...photoResult.warnings]
                .filter(Boolean)
                .join(' / ')}
            </Text>
          </View>
        )}
        <RecipeForm
          initialValues={photoResult?.draft}
          onSubmit={handleSave}
          onCancel={() => setPhase('select')}
          title="推測結果を確認・編集"
          submitLabel="保存"
        />
        <Toast
          message={toastMessage ?? ''}
          visible={toastMessage != null}
          onDismiss={() => setToastMessage(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>料理写真から推測</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.iconWrapper}>
          <Sparkles size={46} color={isAndroid ? Colors.gold : Colors.muted} />
        </View>

        {isAndroid ? (
          <>
            <Text style={styles.title}>写真から下書き</Text>
            <Text style={styles.description}>
              写っている料理・食材から、確認前提のレシピ案を作成します。
            </Text>

            {capturedPhoto && (
              <Image source={{ uri: capturedPhoto.localPath }} style={styles.previewImage} />
            )}

            {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}
            {!providerReady && (
              <Text style={styles.noticeText}>
                このビルドでは Android 画像推測 provider を初期化できませんでした
              </Text>
            )}

            {phase === 'processing' ? (
              <View style={styles.processingBox}>
                <ActivityIndicator size="large" color={Colors.gold} />
                <Text style={styles.processingText}>端末内で推測しています...</Text>
                {batchProgress && (
                  <Text style={styles.processingSubText}>
                    100枚検証中 {batchProgress.done}/{batchProgress.total}
                  </Text>
                )}
              </View>
            ) : (
              <View style={styles.actionGrid}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="カメラで撮影"
                  style={[styles.primaryButton, !providerReady && styles.buttonDisabled]}
                  onPress={() => handleRead('camera')}
                  disabled={!providerReady}
                >
                  <Camera size={18} color={Colors.bg} />
                  <Text style={styles.primaryButtonText}>カメラで撮影</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ギャラリーから選ぶ"
                  style={[styles.secondaryButton, !providerReady && styles.buttonDisabled]}
                  onPress={() => handleRead('gallery')}
                  disabled={!providerReady}
                >
                  <ImageIcon size={18} color={Colors.gold} />
                  <Text style={styles.secondaryButtonText}>ギャラリーから選ぶ</Text>
                </Pressable>
                {isPhotoRecipeE2eEnabled && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="E2E料理写真で推測"
                    style={[styles.secondaryButton, !providerReady && styles.buttonDisabled]}
                    onPress={handleReadE2eFixture}
                    disabled={!providerReady}
                  >
                    <ImageIcon size={18} color={Colors.gold} />
                    <Text style={styles.secondaryButtonText}>E2E料理写真で推測</Text>
                  </Pressable>
                )}
                {isPhotoRecipeE2eEnabled && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="E2E100画像を検証"
                    style={[styles.secondaryButton, !providerReady && styles.buttonDisabled]}
                    onPress={handleRunBatchValidation}
                    disabled={!providerReady}
                  >
                    <Sparkles size={18} color={Colors.gold} />
                    <Text style={styles.secondaryButtonText}>E2E100画像を検証</Text>
                  </Pressable>
                )}
              </View>
            )}

            {batchSummary && (
              <View style={styles.batchResultBox}>
                <Text style={styles.batchResultTitle}>
                  画像検証 {batchSummary.fail === 0 ? 'PASS' : 'FAIL'} {batchSummary.pass}/
                  {batchSummary.total}
                </Text>
                <Text style={styles.batchResultText}>
                  OCRあり {batchSummary.withText}/{batchSummary.total} / ラベルあり{' '}
                  {batchSummary.withLabels}/{batchSummary.total} / タイトル一致{' '}
                  {batchSummary.exactTitleMatches}/{batchSummary.total}
                </Text>
                {batchSummary.failures.map((failure) => (
                  <Text key={failure} style={styles.batchFailureText}>
                    {failure}
                  </Text>
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>料理写真の推測はネイティブアプリ専用です</Text>
            <Text style={styles.description}>
              写真からの下書き作成は Android アプリで先行対応中です。
              {'\n\n'}
              Web ブラウザからお使いの場合は、手動入力をご利用ください。
            </Text>
          </>
        )}

        <View style={styles.divider} />

        <Text style={styles.altLabel}>代わりに手動入力する</Text>
        <Pressable style={styles.manualButton} onPress={handleManual}>
          <PenLine size={18} color={Colors.bg} />
          <Text style={styles.manualButtonText}>手動で入力する</Text>
        </Pressable>
        {capturedPhoto && phase !== 'processing' && (
          <Pressable style={styles.retryButton} onPress={() => setCapturedPhoto(null)}>
            <RotateCcw size={14} color={Colors.muted} />
            <Text style={styles.retryButtonText}>画像をクリア</Text>
          </Pressable>
        )}
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
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 36,
    minHeight: '90%',
    gap: 16,
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
  previewImage: {
    width: '100%',
    maxWidth: 360,
    aspectRatio: 4 / 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#130E08',
  },
  errorText: {
    fontSize: 13,
    color: '#F2A07B',
    textAlign: 'center',
    lineHeight: 20,
  },
  noticeText: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 18,
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
  processingSubText: {
    fontSize: 12,
    color: Colors.muted,
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
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  retryButtonText: {
    fontSize: 12,
    color: Colors.muted,
  },
  batchResultBox: {
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#130E08',
    gap: 6,
  },
  batchResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gold,
  },
  batchResultText: {
    fontSize: 12,
    color: Colors.paperDim,
    lineHeight: 18,
  },
  batchFailureText: {
    fontSize: 11,
    color: '#F2A07B',
    lineHeight: 16,
  },
  sourceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#130E08',
  },
  sourceName: {
    flex: 1,
    fontSize: 12,
    color: Colors.goldDim,
  },
});

/**
 * S11: Food photo import screen
 * On native: camera capture → image labels → editable recipe draft
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Camera, Image as ImageIcon, PenLine, RotateCcw, Sparkles, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { inferRecipeFromVision } from '../../../src/services/vision-recipe.provider';
import { expoImageManipulatorPreprocessAdapter } from '../../../src/services/expo-image-preprocess.adapter';
import { expoImagePickerPhotoCaptureAdapter } from '../../../src/services/expo-photo-capture.adapter';
import { preprocessImageForOcr } from '../../../src/services/image-preprocess.service';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  type CapturedPhoto,
  type PhotoCaptureSource,
} from '../../../src/services/photo-capture.service';
import { createRecipe, createRecipeMemo } from '../../../src/services/recipe.service';
import {
  getFreemiumStatus,
  recordCloudInference,
  type FreemiumStatus,
} from '../../../src/services/usage.service';
import { createCookingLog } from '../../../src/services/cooking-log.service';
import { persistCookingLogPhotos } from '../../../src/services/photo-storage.service';
import { createPhotoSource } from '../../../src/services/source.service';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'select' | 'processing' | 'preview';

// AI 写真レシピはサーバー/BYOK 経由（Gemini）なのでネイティブ両 OS で動く。
// 端末内ラベリング（ML Kit）は Android のみだが iOS では自動的に無効化され
// サーバー推論にフォールバックする。web だけは手動入力へ誘導する。
const isNative = Platform.OS !== 'web';

const CONFIDENCE_LABEL: Record<RecipePhotoAgentOutput['confidence'], string> = {
  high: 'バッチリ読み取れました',
  medium: 'だいたい読み取れました',
  low: 'ざっくり読み取りました',
};

export default function ImportPhotoScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [providerReady, setProviderReady] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [photoResult, setPhotoResult] = useState<RecipePhotoAgentOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState<CapturedPhoto | null>(null);
  const [freemium, setFreemium] = useState<FreemiumStatus | null>(null);

  // Refresh the freemium quota on focus (e.g. after returning from the paywall).
  const refreshFreemium = useCallback(() => {
    if (!isNative) return;
    getFreemiumStatus()
      .then(setFreemium)
      .catch(() => setFreemium(null));
  }, []);
  useFocusEffect(refreshFreemium);

  useEffect(() => {
    let mounted = true;
    if (!isNative) {
      setProviderReady(false);
      return () => {
        mounted = false;
      };
    }

    // On-device labeling は Android のみ利用可。iOS では false になり、
    // サーバー推論だけで写真レシピが動作する。
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
    async (
      photo: CapturedPhoto,
      options: { preprocessImage?: boolean; allowCloudInference?: boolean } = {},
    ) => {
      setCapturedPhoto(photo);
      const shouldPreprocess = options.preprocessImage ?? true;

      const result = await runRecipePhotoAgent(
        {
          imageUri: photo.localPath,
          ...(notes.trim() && { context: notes.trim() }),
          ...(options.allowCloudInference && { allowCloudInference: true }),
        },
        {
          preprocessImage: shouldPreprocess ? preprocessForAgent : undefined,
          labelImage: createClientImageLabeler(),
          recognizeText: createClientOcrRecognizer(),
          inferRecipeFromVision,
        },
      );

      if (!result.ok || !result.data) {
        setErrorMsg(result.error?.message ?? '写真からレシピをつくれませんでした');
        setPhase('select');
        return;
      }

      setPhotoResult(result.data);
      setPhase('preview');
      // Count only successful cloud (paid) inferences against the free quota.
      if (result.data.source === 'cloud') {
        recordCloudInference()
          .then(refreshFreemium)
          .catch(() => undefined);
      }
      // Surface confidence + caveats as a dismissible toast rather than a
      // cramped header banner over the form.
      const toast = [CONFIDENCE_LABEL[result.data.confidence], ...result.data.warnings]
        .filter(Boolean)
        .join(' / ');
      setToastMessage(toast);
    },
    [notes, preprocessForAgent, refreshFreemium],
  );

  const handleRead = useCallback(
    async (source: PhotoCaptureSource) => {
      setErrorMsg(null);

      // Freemium gate: free users past the daily limit go to the paywall.
      const status = freemium ?? (await getFreemiumStatus().catch(() => null));
      if (status && !status.canInfer) {
        router.push('/recipes/paywall');
        return;
      }

      try {
        const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
        // After picking the photo, ask for a short comment in a popup before
        // running inference (the comment is optional but improves the result).
        setNotes('');
        setPendingPhoto(photo);
      } catch (error) {
        if (error instanceof PhotoCaptureCancelledError) return;
        setErrorMsg(error instanceof Error ? error.message : '写真からレシピをつくれませんでした');
      }
    },
    [freemium, router],
  );

  // Confirm the popup comment and start inference on the pending photo.
  const handleConfirmComment = useCallback(async () => {
    const photo = pendingPhoto;
    if (!photo) return;
    setPendingPhoto(null);
    setPhase('processing');
    setPhotoResult(null);
    try {
      await inferPhoto(photo, { allowCloudInference: true });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '写真からレシピをつくれませんでした');
      setPhase('select');
    }
  }, [pendingPhoto, inferPhoto]);

  const handleCancelComment = useCallback(() => {
    setPendingPhoto(null);
    setNotes('');
  }, []);

  const handleSave = useCallback(
    async (data: RecipeFormData) => {
      if (!photoResult) return;
      const sourceId = await createPhotoSource({
        labelSummary: photoResult.evidenceSummary ?? photoResult.labelSummary,
        capturedAt: capturedPhoto?.takenAt,
      });
      const recipeId = await createRecipe({ ...data, sourceId });

      // Preserve the user's impression as a recipe memo (best-effort).
      if (notes.trim()) {
        try {
          await createRecipeMemo(recipeId, notes.trim());
        } catch {
          // non-fatal — the recipe itself is already saved
        }
      }

      // Persist the dish photo and attach it as a cooking record so it appears
      // on the home timeline and as the recipe's hero image (best-effort).
      if (capturedPhoto) {
        try {
          const persisted = await persistCookingLogPhotos([capturedPhoto]);
          await createCookingLog({
            recipeId,
            cookedAt: new Date().toISOString(),
            photos: persisted,
          });
        } catch {
          // non-fatal — recipe is saved even if the photo could not be stored
        }
      }

      setToastMessage('レシピを保存しました');
      setTimeout(() => router.replace('/(tabs)/recipes'), 1500);
    },
    [capturedPhoto, notes, photoResult, router],
  );

  if (phase === 'preview') {
    return (
      <View style={styles.container}>
        <RecipeForm
          initialValues={photoResult?.draft}
          onSubmit={handleSave}
          onCancel={() => setPhase('select')}
          title="できたレシピを確認・編集"
          submitLabel="保存"
        />
        <Toast
          message={toastMessage ?? ''}
          visible={toastMessage != null}
          duration={4000}
          onDismiss={() => setToastMessage(null)}
        />
      </View>
    );
  }

  const unlimitedLabel = freemium?.isByok ? '自分のAIキー・使い放題' : 'プレミアム・使い放題';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>写真からレシピ</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.iconWrapper}>
          <Sparkles size={46} color={isNative ? Colors.gold : Colors.muted} />
        </View>

        {isNative ? (
          <>
            <Text style={styles.title}>写真からレシピをつくろう</Text>
            <Text style={styles.description}>
              料理の写真をえらぶだけで、材料・分量・手順をAIが考えてレシピの下書きをつくります。
              お店の名前や味の感想をひとこと添えると、より近い仕上がりになります。
            </Text>

            {freemium &&
              (freemium.isPremium || freemium.isByok ? (
                <Text style={styles.quotaPremium}>{unlimitedLabel}</Text>
              ) : (
                <Pressable onPress={() => router.push('/recipes/paywall')} hitSlop={8}>
                  <Text style={styles.quotaText}>
                    今日の無料作成：あと {freemium.remaining} 回 ・ 使い放題にする
                  </Text>
                </Pressable>
              ))}

            {capturedPhoto && (
              <Image source={{ uri: capturedPhoto.localPath }} style={styles.previewImage} />
            )}

            {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}
            <Text style={styles.disclosureText}>
              写真は解析のためサーバー（AI 提供元）に送信されます。保存はされません。
            </Text>
            {!providerReady && (
              <Text style={styles.noticeText}>
                インターネットにつながっていると、写真からレシピをつくれます
              </Text>
            )}

            {phase === 'processing' ? (
              <View style={styles.processingBox}>
                <ActivityIndicator size="large" color={Colors.gold} />
                <Text style={styles.processingText}>写真からレシピをつくっています...</Text>
              </View>
            ) : (
              <View style={styles.actionGrid}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="カメラで撮影"
                  style={styles.primaryButton}
                  onPress={() => handleRead('camera')}
                >
                  <Camera size={18} color={Colors.bg} />
                  <Text style={styles.primaryButtonText}>カメラで撮影</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ギャラリーから選ぶ"
                  style={styles.secondaryButton}
                  onPress={() => handleRead('gallery')}
                >
                  <ImageIcon size={18} color={Colors.gold} />
                  <Text style={styles.secondaryButtonText}>ギャラリーから選ぶ</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>写真からのレシピづくりはアプリでつかえます</Text>
            <Text style={styles.description}>
              写真からの下書き作成はスマホアプリ（iOS / Android）でお使いいただけます。
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

      <Modal
        visible={pendingPhoto != null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelComment}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {pendingPhoto && (
              <Image source={{ uri: pendingPhoto.localPath }} style={styles.modalImage} />
            )}
            <Text style={styles.modalTitle}>ひとことコメント（任意）</Text>
            <Text style={styles.modalHint}>
              お店の名前や味の感想を書くと、より近いレシピになります。
            </Text>
            <TextInput
              style={styles.modalInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="例: ○○屋の麻婆豆腐。しびれ強め"
              placeholderTextColor={Colors.muted}
              maxLength={1000}
              multiline
              autoFocus
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancelButton} onPress={handleCancelComment}>
                <Text style={styles.modalCancelText}>やめる</Text>
              </Pressable>
              <Pressable style={styles.modalConfirmButton} onPress={handleConfirmComment}>
                <Text style={styles.modalConfirmText}>レシピをつくる</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 20,
  },
  modalImage: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.paper,
    marginBottom: 4,
  },
  modalHint: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
    lineHeight: 18,
    marginBottom: 12,
  },
  modalInput: {
    width: '100%',
    minHeight: 64,
    maxHeight: 160,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.paper,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.paperDim,
  },
  modalConfirmButton: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    alignItems: 'center',
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
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
  disclosureText: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 16,
  },
  quotaText: {
    fontSize: 12,
    color: Colors.gold,
    textAlign: 'center',
    lineHeight: 18,
  },
  quotaPremium: {
    fontSize: 12,
    color: Colors.gold,
    textAlign: 'center',
    fontWeight: '600',
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
});

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
import { KeyboardAvoider } from '../../../src/components/KeyboardAvoider';
import { RecipeForm } from '../../../src/components/RecipeForm';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { t, tCount } from '../../../src/i18n';
import { ensureInferenceCredit } from '../../../src/services/inference-gate.service';
import {
  createClientImageLabeler,
  isClientImageLabelingAvailable,
} from '../../../src/services/client-image-label.provider';
import { createClientOcrRecognizer } from '../../../src/services/client-ocr.provider';
import {
  inferRecipeFromVision,
  VisionInferenceError,
} from '../../../src/services/vision-recipe.provider';
import { expoImageManipulatorPreprocessAdapter } from '../../../src/services/expo-image-preprocess.adapter';
import { expoImagePickerPhotoCaptureAdapter } from '../../../src/services/expo-photo-capture.adapter';
import { preprocessImageForOcr } from '../../../src/services/image-preprocess.service';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  UserFacingError,
  type CapturedPhoto,
  type PhotoCaptureSource,
} from '../../../src/services/photo-capture.service';
import {
  createRecipe,
  createRecipeMemo,
  setRecipePinned,
} from '../../../src/services/recipe.service';
import {
  getFreemiumStatus,
  recordCloudInference,
  type FreemiumStatus,
} from '../../../src/services/usage.service';
import { createCookingLog } from '../../../src/services/cooking-log.service';
import type { CookingLogKind } from '../../../src/services/types';
import { persistCookingLogPhotos } from '../../../src/services/photo-storage.service';
import { createPhotoSource } from '../../../src/services/source.service';
import { applyAutoStepTimers } from '../../../src/utils/stepTimer';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'select' | 'processing' | 'preview';

// AI 写真レシピはサーバー/BYOK 経由（Gemini）なのでネイティブ両 OS で動く。
// 端末内ラベリング（ML Kit）は Android のみだが iOS では自動的に無効化され
// サーバー推論にフォールバックする。web だけは手動入力へ誘導する。
const isNative = Platform.OS !== 'web';

function confidenceLabel(confidence: RecipePhotoAgentOutput['confidence']): string {
  if (confidence === 'high') return t('recipe.photo.confidence.high');
  if (confidence === 'medium') return t('recipe.photo.confidence.medium');
  return t('recipe.photo.confidence.low');
}

/**
 * 画面に出してよい文言だけを返す。
 *
 * ネイティブモジュール（expo-image-picker 等）が投げた例外は英語の Java 文言そのままで、
 * 素通しすると利用者に意味不明な文字列が出る（2026-08-19 に実際に出た。再実行では成功した
 * ので、プロセス回収などの一時的な失敗と見ている）。翻訳済みのエラーだけ `message` を使い、
 * それ以外は「少し時間をおいて」に寄せる。原因が分かっていないので具体的な理由は騙らない。
 */
function readableError(error: unknown): string {
  if (error instanceof VisionInferenceError || error instanceof UserFacingError) {
    return error.message;
  }
  // 切り分けのために中身は残す（画面には出さない）
  console.warn('[import-photo] unexpected error', error);
  return t('error.photoRecipeUnexpected');
}

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
  // R1: 店で食べた / 家で作った。主役は「店の味の再現」なので既定は eaten_out
  const [logKind, setLogKind] = useState<CookingLogKind>('eaten_out');

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
        setErrorMsg(result.error?.message ?? t('error.photoRecipeFailed'));
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
      const toast = [confidenceLabel(result.data.confidence), ...result.data.warnings]
        .filter(Boolean)
        .join(' / ');
      setToastMessage(toast);
    },
    [notes, preprocessForAgent, refreshFreemium],
  );

  const handleRead = useCallback(
    async (source: PhotoCaptureSource) => {
      setErrorMsg(null);

      // 枠切れなら、その場で広告視聴を持ちかけてそのまま続行する（2026-08-12）。
      // ペイウォールは広告を出せないとき（視聴上限・no-fill）の逃げ道
      const gate = await ensureInferenceCredit();
      if (gate === 'paywall') {
        router.push('/recipes/paywall');
        return;
      }
      if (gate !== 'ready') return;

      try {
        const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
        // After picking the photo, ask for a short comment in a popup before
        // running inference (the comment is optional but improves the result).
        setNotes('');
        setPendingPhoto(photo);
      } catch (error) {
        if (error instanceof PhotoCaptureCancelledError) return;
        setErrorMsg(readableError(error));
      }
    },
    [router],
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
      setErrorMsg(readableError(error));
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
      // 店名の入力欄は RecipeForm 側に一本化した（同じ画面に 2 つ出さない）。
      // レシピが正で、記録には「その日どこで食べたか」として同じ値を控える。
      const place = data.placeName?.trim() ?? '';
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
            kind: logKind,
            // 記録側は「その日どこで食べたか」の履歴。表示はレシピ側を使う（schema.ts 参照）
            ...(logKind === 'eaten_out' && place ? { placeName: place } : {}),
          });
        } catch {
          // non-fatal — recipe is saved even if the photo could not be stored
        }
      }

      // 店で食べたものは「次に家で作る」のが自然な流れなので、再現したい棚へ入れる
      if (logKind === 'eaten_out') {
        try {
          await setRecipePinned(recipeId, true);
        } catch {
          // non-fatal
        }
      }

      setToastMessage(
        logKind === 'eaten_out' ? t('recipe.photo.savedAndPinned') : t('recipe.photo.saved'),
      );
      // 一覧ではなく、いま作ったレシピへ着地する（探させない）
      setTimeout(() => router.replace(`/(tabs)/recipes/${recipeId}`), 1500);
    },
    [capturedPhoto, logKind, notes, photoResult, router],
  );

  if (phase === 'preview') {
    return (
      <View style={styles.container}>
        <RecipeForm
          initialValues={
            photoResult?.draft
              ? // 「10分煮る」等の時間表現からタイマーを自動セット（フォームで修正可能）
                { ...photoResult.draft, steps: applyAutoStepTimers(photoResult.draft.steps) }
              : undefined
          }
          onSubmit={handleSave}
          onCancel={() => setPhase('select')}
          title={t('recipe.photo.formTitle')}
          submitLabel={t('common.save')}
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

  const unlimitedLabel = freemium?.isByok
    ? t('recipe.photo.unlimitedByok')
    : t('recipe.photo.unlimitedPremium');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('recipe.photo.tabLabel')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.iconWrapper}>
          <Sparkles size={46} color={isNative ? Colors.gold : Colors.muted} />
        </View>

        {isNative ? (
          <>
            <Text style={styles.title}>{t('recipe.photo.title')}</Text>
            <Text style={styles.description}>{t('recipe.photo.description')}</Text>

            {freemium &&
              (freemium.isPremium || freemium.isByok ? (
                <Text style={styles.quotaPremium}>{unlimitedLabel}</Text>
              ) : (
                <Pressable onPress={() => router.push('/recipes/paywall')} hitSlop={8}>
                  <Text style={styles.quotaText}>
                    {tCount('recipe.photo.quotaRemaining', freemium.remaining)}
                  </Text>
                  {/* 残数の下に「使い切ったらどうなるか」を予告する。旧リンク
                      「使い放題にする」は中身が読めず全ペルソナがためらった
                      （docs/reviews/persona/1.12.2.md #1） */}
                  <Text style={styles.quotaHint}>{t('recipe.photo.quotaHint')}</Text>
                </Pressable>
              ))}

            {capturedPhoto && (
              <Image source={{ uri: capturedPhoto.localPath }} style={styles.previewImage} />
            )}

            {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}
            <Text style={styles.disclosureText}>{t('recipe.photo.disclosure')}</Text>
            {!providerReady && (
              <Text style={styles.noticeText}>{t('recipe.photo.offlineNotice')}</Text>
            )}

            {phase === 'processing' ? (
              <View style={styles.processingBox}>
                <ActivityIndicator size="large" color={Colors.gold} />
                <Text style={styles.processingText}>{t('recipe.photo.processing')}</Text>
              </View>
            ) : (
              <View style={styles.actionGrid}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.takePhoto')}
                  style={styles.primaryButton}
                  onPress={() => handleRead('camera')}
                >
                  <Camera size={18} color={Colors.bg} />
                  <Text style={styles.primaryButtonText}>{t('common.takePhoto')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common.pickFromGallery')}
                  style={styles.secondaryButton}
                  onPress={() => handleRead('gallery')}
                >
                  <ImageIcon size={18} color={Colors.gold} />
                  <Text style={styles.secondaryButtonText}>{t('common.pickFromGallery')}</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={styles.title}>{t('recipe.photo.webTitle')}</Text>
            <Text style={styles.description}>{t('recipe.photo.webDescription')}</Text>
          </>
        )}

        <View style={styles.divider} />

        {/* 「代わりに手動入力する」の見出しは削除した — 直下のボタンと同じ意味の文が
            2 つ並び、違いを探して固まる（ペルソナレビュー 1.12.2 #7）。区切り線＋ボタンで足りる */}
        <Pressable style={styles.manualButton} onPress={handleManual}>
          <PenLine size={18} color={Colors.bg} />
          <Text style={styles.manualButtonText}>{t('recipe.photo.manualAction')}</Text>
        </Pressable>
        {capturedPhoto && phase !== 'processing' && (
          <Pressable style={styles.retryButton} onPress={() => setCapturedPhoto(null)}>
            <RotateCcw size={14} color={Colors.muted} />
            <Text style={styles.retryButtonText}>{t('recipe.photo.clearImage')}</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal
        visible={pendingPhoto != null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelComment}
      >
        {/*
          `Modal` の中身は画面本体とは別のツリーなので、画面を KeyboardAvoider で
          包んでもここには効かない。**モーダルの内側にも要る**。
          さらに autoFocus でキーボードが即座に立ち上がるため、包み忘れると
          「これで作る」が必ずキーボードの下に隠れる（#172 の報告そのもの）。
        */}
        <KeyboardAvoider style={styles.modalOverlay}>
          <ScrollView
            contentContainerStyle={styles.modalScrollBody}
            /* キーボードを出したままボタンを押せるように（既定の never だと
               1 タップ目がキーボードを閉じるだけで消費される） */
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.modalCard}>
              {pendingPhoto && (
                <Image source={{ uri: pendingPhoto.localPath }} style={styles.modalImage} />
              )}
              <Text style={styles.modalTitle}>{t('recipe.photo.commentTitle')}</Text>
              <Text style={styles.modalHint}>{t('recipe.photo.commentHint')}</Text>
              {/* この写真が何なのかを**最初に決める場所**（R1）。
                  以前はプレビューの最上部にあったが、感想を書くこの画面の方が、
                  「どこで食べたか」を思い出しているタイミングと合う。
                  既定はお店（この機能の主役の流れ）。あとからレシピの編集でも直せる */}
              <View style={styles.placeToggle}>
                {(
                  [
                    ['eaten_out', t('log.kind.eatenOut')],
                    ['cooked', t('log.kind.cooked')],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: logKind === value }}
                    style={[styles.placeChip, logKind === value && styles.placeChipActive]}
                    onPress={() => setLogKind(value)}
                  >
                    <Text
                      style={[
                        styles.placeChipText,
                        logKind === value && styles.placeChipTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.modalInput}
                value={notes}
                onChangeText={setNotes}
                placeholder={t('recipe.photo.commentPlaceholder')}
                placeholderTextColor={Colors.muted}
                maxLength={1000}
                multiline
                autoFocus
              />
              <View style={styles.modalButtons}>
                <Pressable style={styles.modalCancelButton} onPress={handleCancelComment}>
                  <Text style={styles.modalCancelText}>{t('recipe.photo.commentCancel')}</Text>
                </Pressable>
                <Pressable style={styles.modalConfirmButton} onPress={handleConfirmComment}>
                  <Text style={styles.modalConfirmText}>{t('recipe.photo.commentConfirm')}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoider>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  placeToggle: {
    flexDirection: 'row',
    gap: 8,
  },
  placeChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  placeChipActive: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  placeChipText: {
    fontSize: 13,
    color: Colors.paperDim,
  },
  placeChipTextActive: {
    color: Colors.bg,
    fontWeight: '600',
  },
  placeInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: Colors.paper,
    backgroundColor: Colors.bgCard,
  },
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
  },
  // 余白があれば中央、キーボードで足りなくなったらスクロール（小さい端末で切れない）
  modalScrollBody: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
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
    // 「サーバーに送信・保存されない」は写真を渡す前の判断材料そのもの。
    // muted(#5A4A34) だと背景と同化して読めない（ペルソナレビュー #2 — 63歳は
    // 「読めなかった」と明言）。開示は読めて初めて開示になる
    fontSize: 12,
    color: Colors.paperDim,
    textAlign: 'center',
    lineHeight: 17,
  },
  quotaText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.gold,
    textAlign: 'center',
    lineHeight: 19,
  },
  quotaHint: {
    fontSize: 12,
    color: Colors.gold,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 2,
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

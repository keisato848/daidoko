/**
 * S11: Food photo import screen
 * On native: camera capture → image labels → editable recipe draft
 */
import { useRouter } from 'expo-router';
import { Camera, Image as ImageIcon, PenLine, RotateCcw, Sparkles, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import {
  hasCloudInferenceConsent,
  setCloudInferenceConsent,
} from '../../../src/services/app-meta.service';
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
import { createRecipe } from '../../../src/services/recipe.service';
import { createPhotoSource } from '../../../src/services/source.service';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'select' | 'processing' | 'preview';

const isAndroid = Platform.OS === 'android';

const CONFIDENCE_LABEL: Record<RecipePhotoAgentOutput['confidence'], string> = {
  high: '推測信頼度: 高',
  medium: '推測信頼度: 中',
  low: '推測信頼度: 低',
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
  const [cloudConsent, setCloudConsent] = useState(false);

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

    hasCloudInferenceConsent()
      .then((granted) => {
        if (mounted) setCloudConsent(granted);
      })
      .catch(() => {
        if (mounted) setCloudConsent(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleManual = () => {
    router.replace('/recipes/new');
  };

  // Returns whether cloud Vision inference is permitted, prompting for opt-in
  // consent the first time (the photo is sent to the analysis server + AI).
  const ensureCloudConsent = useCallback(async (): Promise<boolean> => {
    if (cloudConsent) return true;
    const granted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'AIで写真からレシピを推論',
        'この機能は、選んだ料理写真と入力した感想を解析サーバー（および AI 提供元）に送信してレシピを推論します。写真は推論のためだけに使われ、サーバーには保存されません。\n\n送信に同意しますか？',
        [
          { text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
          { text: '同意して続ける', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (granted) {
      setCloudConsent(true);
      await setCloudInferenceConsent(true).catch(() => undefined);
    }
    return granted;
  }, [cloudConsent]);

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
        setErrorMsg(result.error?.message ?? '料理写真の推測に失敗しました');
        setPhase('select');
        return;
      }

      setPhotoResult(result.data);
      setPhase('preview');
      // Surface confidence + caveats as a dismissible toast rather than a
      // cramped header banner over the form.
      const toast = [CONFIDENCE_LABEL[result.data.confidence], ...result.data.warnings]
        .filter(Boolean)
        .join(' / ');
      setToastMessage(toast);
    },
    [notes, preprocessForAgent],
  );

  const handleRead = useCallback(
    async (source: PhotoCaptureSource) => {
      setErrorMsg(null);

      // Cloud Vision inference is the primary path; require opt-in consent first.
      const allowCloud = await ensureCloudConsent();
      if (!allowCloud) return; // user declined — stay on the select screen

      setPhase('processing');
      setPhotoResult(null);

      try {
        const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
        await inferPhoto(photo, { allowCloudInference: true });
      } catch (error) {
        if (error instanceof PhotoCaptureCancelledError) {
          setPhase('select');
          return;
        }
        setErrorMsg(error instanceof Error ? error.message : '料理写真の推測に失敗しました');
        setPhase('select');
      }
    },
    [ensureCloudConsent, inferPhoto],
  );

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
          duration={4000}
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
            <Text style={styles.title}>写真からレシピを推論</Text>
            <Text style={styles.description}>
              料理の写真から、AI が材料・分量・手順を推論してレシピ下書きを作成します。
              お店で食べた料理の感想やお店の名前を添えると、より近い再現になります。
            </Text>

            {capturedPhoto && (
              <Image source={{ uri: capturedPhoto.localPath }} style={styles.previewImage} />
            )}

            {phase !== 'processing' && (
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="感想・お店の名前など（任意）例: ○○屋の麻婆豆腐。痺れ強め"
                placeholderTextColor={Colors.muted}
                multiline
                maxLength={1000}
              />
            )}

            {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}
            {!providerReady && (
              <Text style={styles.noticeText}>
                オフライン時の端末内推測は利用できません（AI 推論にはインターネット接続が必要です）
              </Text>
            )}

            {phase === 'processing' ? (
              <View style={styles.processingBox}>
                <ActivityIndicator size="large" color={Colors.gold} />
                <Text style={styles.processingText}>AI が写真からレシピを推論しています...</Text>
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
  notesInput: {
    width: '100%',
    minHeight: 64,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: Colors.paper,
    textAlignVertical: 'top',
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

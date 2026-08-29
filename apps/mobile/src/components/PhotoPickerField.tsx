/**
 * Photo picker field for the recipe form — cover photo (large) and per-step
 * photos (thumb). Captures via camera or gallery, persists into the app's
 * recipe-photos directory, and reports the stored path via onChange.
 * Replaced/removed photos keep their files (older revisions may reference them).
 *
 * cover variant だけ、第 3 アクション「AI でイメージをつくる」を持つ
 * （docs/レシピ表紙AI生成設計.md §2）。手入力/URL 取り込み/相談 confirm/編集の
 * 全フローが `RecipeForm` 経由でこのコンポーネントを共有しているため、
 * ここ 1 箇所に実装すれば全入口をカバーする。
 */
import { useRouter } from 'expo-router';
import { Camera, ImageIcon, Sparkles, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { isAiGeneratedPhoto } from '../utils/aiGeneratedPhoto';
import { ensureCoverImageCredit, recordCoverImageUse } from '../services/cover-image-gate.service';
import { generateCoverImage, type CoverImageResult } from '../services/cover-image.provider';
import { expoImagePickerPhotoCaptureAdapter } from '../services/expo-photo-capture.adapter';
import { capturePhoto, type PhotoCaptureSource } from '../services/photo-capture.service';
import { resolvePhotoUri } from '../services/photo-path';
import { persistGeneratedCoverImage, persistRecipePhoto } from '../services/photo-storage.service';
import { t } from '../i18n';
import { CoverImagePreviewSheet } from './CoverImagePreviewSheet';
import { Toast } from './Toast';

interface PhotoPickerFieldProps {
  /** Stored photo path (undefined = none) */
  value: string | undefined;
  onChange: (path: string | undefined) => void;
  /** 'cover' = full-width preview, 'thumb' = compact row */
  variant: 'cover' | 'thumb';
  /**
   * AI イメージ生成のプロンプト材料（cover のみ使う）。タイトルが空なら
   * 「AI でイメージをつくる」を disabled にする。
   */
  title?: string;
  ingredientNames?: string[];
  tags?: string[];
}

export function PhotoPickerField({
  value,
  onChange,
  variant,
  title,
  ingredientNames,
  tags,
}: PhotoPickerFieldProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<CoverImageResult | null>(null);
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handlePick = useCallback(
    async (source: PhotoCaptureSource) => {
      setBusy(true);
      try {
        const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
        onChange(await persistRecipePhoto(photo));
      } catch {
        // キャンセル・保存失敗とも現状維持（フォームは壊さない）
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const runGenerate = useCallback(async () => {
    const dishTitle = title?.trim();
    if (!dishTitle) return;
    const gate = await ensureCoverImageCredit();
    if (gate.result === 'cancelled') return;
    if (gate.result === 'paywall') {
      router.push('/recipes/paywall');
      return;
    }
    setGenerating(true);
    try {
      const result = await generateCoverImage({
        title: dishTitle,
        ingredientNames: ingredientNames ?? [],
        tags: tags ?? [],
      });
      // 「無料: 月3枚・成功時のみ加算」— 生成が成功した時点で数える。
      // 広告経由（consumedAd）は貯めない・減らさない別枠なので数えない
      if (!gate.consumedAd) {
        await recordCoverImageUse();
      }
      setPreview(result);
    } catch {
      setToastMessage(t('coverImage.error.failed'));
    } finally {
      setGenerating(false);
    }
  }, [title, ingredientNames, tags, router]);

  const handleAdopt = useCallback(async () => {
    if (!preview) return;
    setAdoptBusy(true);
    try {
      const path = await persistGeneratedCoverImage(preview);
      onChange(path);
      setPreview(null);
    } catch {
      setToastMessage(t('coverImage.error.failed'));
    } finally {
      setAdoptBusy(false);
    }
  }, [preview, onChange]);

  const handleReport = useCallback(() => {
    setPreview(null);
    router.push({ pathname: '/recipes/report', params: { source: 'cover-image' } });
  }, [router]);

  const isCover = variant === 'cover';
  const canGenerate = isCover && (title?.trim().length ?? 0) > 0;
  const isAiGenerated = isCover && isAiGeneratedPhoto(value);

  return (
    <View style={isCover ? styles.coverContainer : styles.thumbContainer}>
      {value ? (
        <View style={isCover ? styles.coverPreviewWrap : styles.thumbPreviewWrap}>
          {/*
            **相対パスのまま <Image> に渡さない。** `persistRecipePhoto` が返すのは
            `recipe-photos/xxx.jpg` という DB 保存用の相対パスで、これを渡すと
            `<Image>` は**エラーも出さずに何も描かない**（`services/photo-path.ts` 冒頭）。
            読み出し側（`recipe.service`）は `resolvePhotoUri` を通すので、
            既存レシピを編集で開いたときは絶対パスが来て出る。壊れるのは
            「いま選んだ写真」だけで、選んだ直後のプレビューが真っ黒になっていた（#221）。
          */}
          <Image
            source={{ uri: resolvePhotoUri(value) }}
            style={isCover ? styles.coverPreview : styles.thumbPreview}
            resizeMode="cover"
          />
          {isAiGenerated && (
            <View style={styles.aiBadge}>
              <Text style={styles.aiBadgeText}>{t('coverImage.badge')}</Text>
            </View>
          )}
          <Pressable
            style={styles.removeBadge}
            onPress={() => onChange(undefined)}
            hitSlop={8}
            accessibilityLabel={t('common.deletePhoto')}
          >
            <X size={14} color={Colors.paper} />
          </Pressable>
        </View>
      ) : null}
      {isAiGenerated && <Text style={styles.aiNote}>{t('coverImage.detailNote')}</Text>}
      {isCover && generating ? (
        <View style={styles.generatingRow}>
          <ActivityIndicator color={Colors.gold} size="small" />
          <Text style={styles.generatingText}>{t('coverImage.generating')}</Text>
        </View>
      ) : (
        <View style={styles.buttonRow}>
          {busy ? (
            <ActivityIndicator color={Colors.gold} size="small" />
          ) : (
            <>
              <Pressable
                style={styles.pickButton}
                onPress={() => handlePick('camera')}
                accessibilityLabel={t('ui.photo.captureLabel')}
              >
                <Camera size={15} color={Colors.goldDim} />
                <Text style={styles.pickButtonText}>
                  {value ? t('ui.photo.retake') : t('ui.photo.capture')}
                </Text>
              </Pressable>
              <Pressable
                style={styles.pickButton}
                onPress={() => handlePick('gallery')}
                accessibilityLabel={t('common.pickFromGallery')}
              >
                <ImageIcon size={15} color={Colors.goldDim} />
                <Text style={styles.pickButtonText}>{t('ui.photo.gallery')}</Text>
              </Pressable>
              {isCover && (
                <Pressable
                  style={[styles.pickButton, !canGenerate && styles.pickButtonDisabled]}
                  onPress={() => void runGenerate()}
                  disabled={!canGenerate}
                  accessibilityLabel={t('coverImage.action')}
                >
                  <Sparkles size={15} color={canGenerate ? Colors.goldDim : Colors.muted} />
                  <Text
                    style={[styles.pickButtonText, !canGenerate && styles.pickButtonTextDisabled]}
                  >
                    {t('coverImage.action')}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}
      {isCover && !canGenerate && !generating && (
        <Text style={styles.aiHint}>{t('coverImage.actionDisabledHint')}</Text>
      )}

      {isCover && (
        <CoverImagePreviewSheet
          visible={preview !== null}
          imageUri={preview ? `data:${preview.mimeType};base64,${preview.dataBase64}` : null}
          busy={adoptBusy || generating}
          onAdopt={() => void handleAdopt()}
          onRetry={() => void runGenerate()}
          onCancel={() => setPreview(null)}
          onReport={handleReport}
        />
      )}

      <Toast
        message={toastMessage ?? ''}
        visible={toastMessage !== null}
        onDismiss={() => setToastMessage(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  coverContainer: { gap: 8 },
  thumbContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  coverPreviewWrap: { position: 'relative' },
  coverPreview: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    backgroundColor: Colors.bgInput,
  },
  thumbPreviewWrap: { position: 'relative' },
  thumbPreview: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: Colors.bgInput,
  },
  removeBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(10, 8, 5, 0.75)',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(10, 8, 5, 0.75)',
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  aiBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.gold, letterSpacing: 0.5 },
  aiNote: { fontSize: 11, color: Colors.muted },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  generatingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  generatingText: { fontSize: 13, color: Colors.paperDim },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgInput,
  },
  pickButtonDisabled: { opacity: 0.5 },
  pickButtonText: { fontSize: 13, color: Colors.goldDim },
  pickButtonTextDisabled: { color: Colors.muted },
  aiHint: { fontSize: 11, color: Colors.muted },
});

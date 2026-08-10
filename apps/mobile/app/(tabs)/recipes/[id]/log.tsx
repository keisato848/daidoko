/**
 * S07: Cooking Log Registration
 * Records photos + rating + memo after cooking session completes
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, Image as ImageIcon, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Toast } from '../../../../src/components/Toast';
import { Colors } from '../../../../src/constants/theme';
import { t, tCount } from '../../../../src/i18n';
import { createCookingLog } from '../../../../src/services/cooking-log.service';
import { expoImagePickerPhotoCaptureAdapter } from '../../../../src/services/expo-photo-capture.adapter';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  type CapturedPhoto,
  type PhotoCaptureSource,
} from '../../../../src/services/photo-capture.service';
import {
  cleanupStoredCookingPhotos,
  MAX_COOKING_LOG_PHOTOS,
  persistCookingLogPhotos,
} from '../../../../src/services/photo-storage.service';
import { maybeRequestStoreReview } from '../../../../src/services/review-request.service';
import type { SaveCookingPhotoInput } from '../../../../src/services/types';

function StarRow({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={starStyles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={8}>
          <Text style={[starStyles.star, n <= value && starStyles.starFilled]}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  star: { fontSize: 32, color: Colors.border },
  starFilled: { color: Colors.gold },
});

/** 星の数に対する言葉。0（未評価）のときは何も出さない。 */
function ratingLabel(rating: number): string {
  if (rating === 1) return t('log.form.rating.star1');
  if (rating === 2) return t('log.form.rating.star2');
  if (rating === 3) return t('log.form.rating.star3');
  if (rating === 4) return t('log.form.rating.star4');
  if (rating === 5) return t('log.form.rating.star5');
  return '';
}

export default function CookingLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [memo, setMemo] = useState('');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const handleAddPhoto = useCallback(
    async (source: PhotoCaptureSource) => {
      if (photos.length >= MAX_COOKING_LOG_PHOTOS) {
        Alert.alert(
          t('log.form.photoLimitTitle'),
          tCount('log.form.photoLimit', MAX_COOKING_LOG_PHOTOS),
        );
        return;
      }

      try {
        const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
        setPhotos((current) => [...current, photo].slice(0, MAX_COOKING_LOG_PHOTOS));
      } catch (error) {
        if (error instanceof PhotoCaptureCancelledError) return;
        const message = error instanceof Error ? error.message : t('common.photoAddFailed');
        Alert.alert(t('common.photoAddFailed'), message);
      }
    },
    [photos.length],
  );

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    let persistedPhotos: SaveCookingPhotoInput[] = [];
    try {
      persistedPhotos = await persistCookingLogPhotos(photos);
      await createCookingLog({
        recipeId: id,
        rating: rating > 0 ? rating : undefined,
        memo: memo.trim() || undefined,
        cookedAt: new Date().toISOString(),
        photos: persistedPhotos,
      });
      setShowToast(true);
      // 保存成功＝ポジティブな瞬間にストア評価を打診（条件・頻度はサービス側で管理）
      void maybeRequestStoreReview();

      // 感想を書いた直後は「レシピに反映する」の最良のタイミング（R2 / Issue #113）。
      // メモが無いときは何も聞かない（材料がないので AI も直しようがない）
      const trimmedMemo = memo.trim();
      if (id && trimmedMemo) {
        setTimeout(() => {
          Alert.alert(t('log.form.refinePromptTitle'), t('log.form.refinePromptBody'), [
            {
              text: t('log.form.refineLater'),
              style: 'cancel',
              onPress: () => router.push('/(tabs)'),
            },
            {
              text: t('log.form.refineNow'),
              onPress: () =>
                router.replace({
                  pathname: '/(tabs)/recipes/[id]/refine',
                  params: { id, feedback: trimmedMemo },
                }),
            },
          ]);
        }, 1200);
        return;
      }
      setTimeout(() => router.push('/(tabs)'), 1500);
    } catch (error) {
      await cleanupStoredCookingPhotos(persistedPhotos);
      const message = error instanceof Error ? error.message : t('log.form.saveFailedBody');
      Alert.alert(t('log.form.saveFailedTitle'), message);
    } finally {
      setSaving(false);
    }
  }, [id, rating, memo, photos, router]);

  const handleSkip = () => router.push('/(tabs)');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('log.form.title')}</Text>
        <Pressable onPress={handleSkip} hitSlop={12}>
          <Text style={styles.skipText}>{t('log.form.skip')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Completion message */}
        <View style={styles.completionBanner}>
          <Text style={styles.completionEmoji}>🎉</Text>
          <Text style={styles.completionText}>{t('log.form.congrats')}</Text>
          <Text style={styles.completionSub}>{t('log.form.congratsSub')}</Text>
        </View>

        {/* Photos */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('log.form.photoSection')}</Text>
          {photos.length > 0 && (
            <View style={styles.photoGrid}>
              {photos.map((photo, index) => (
                <View key={`${photo.localPath}-${index}`} style={styles.photoPreviewWrap}>
                  <Image source={{ uri: photo.localPath }} style={styles.photoPreview} />
                  <Pressable
                    style={styles.photoRemoveButton}
                    onPress={() => handleRemovePhoto(index)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.deletePhoto')}
                  >
                    <Trash2 size={13} color={Colors.bg} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <View style={styles.photoActions}>
            <Pressable
              style={[styles.photoAddButton, saving && styles.photoAddButtonDisabled]}
              onPress={() => handleAddPhoto('camera')}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t('log.form.addFromCamera')}
            >
              <Camera color={Colors.gold} size={18} />
              <Text style={styles.photoAddText}>{t('common.takePhoto')}</Text>
            </Pressable>
            <Pressable
              style={[styles.photoAddButton, saving && styles.photoAddButtonDisabled]}
              onPress={() => handleAddPhoto('gallery')}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={t('log.form.addFromGallery')}
            >
              <ImageIcon color={Colors.gold} size={18} />
              <Text style={styles.photoAddText}>{t('common.pickFromGallery')}</Text>
            </Pressable>
          </View>
          <Text style={styles.photoHint}>
            {t('log.form.photoCount', { current: photos.length, max: MAX_COOKING_LOG_PHOTOS })}
          </Text>
        </View>

        {/* Rating */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('log.form.ratingSection')}</Text>
          <StarRow value={rating} onChange={setRating} />
          {rating > 0 && <Text style={styles.ratingHint}>{ratingLabel(rating)}</Text>}
        </View>

        {/* Memo */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('log.form.memoSection')}</Text>
          <TextInput
            style={styles.memoInput}
            value={memo}
            onChangeText={setMemo}
            placeholder={t('log.form.memoPlaceholder')}
            placeholderTextColor={Colors.muted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={styles.charCount}>{memo.length} / 500</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? t('common.saving') : t('log.form.submit')}
          </Text>
        </Pressable>
      </View>

      <Toast
        message={t('log.form.saved')}
        visible={showToast}
        onDismiss={() => setShowToast(false)}
      />
    </KeyboardAvoidingView>
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
    paddingTop: 60,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 0.5,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.muted,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  completionBanner: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  completionEmoji: {
    fontSize: 48,
  },
  completionText: {
    fontSize: 20,
    fontWeight: '500',
    color: Colors.paper,
  },
  completionSub: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  section: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  ratingHint: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoPreviewWrap: {
    width: 92,
    height: 92,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
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
  photoActions: {
    flexDirection: 'row',
    gap: 10,
  },
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
  photoAddButtonDisabled: {
    opacity: 0.5,
  },
  photoAddText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.paper,
  },
  photoHint: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.muted,
    textAlign: 'right',
  },
  memoInput: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
    minHeight: 100,
    lineHeight: 22,
  },
  charCount: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.muted,
    textAlign: 'right',
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
  saveButton: {
    backgroundColor: Colors.gold,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
    letterSpacing: 1,
  },
});

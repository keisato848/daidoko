/**
 * S07: Cooking Log Registration
 * Records photos + rating + memo after cooking session completes
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import {
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
import { createCookingLog } from '../../../../src/services/cooking-log.service';
import type { SaveCookingPhotoInput } from '../../../../src/services/types';

function getPhotoFilename(localPath: string): string {
  return localPath.split('/').pop() ?? localPath;
}

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

export default function CookingLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [memo, setMemo] = useState('');
  const [photos, setPhotos] = useState<SaveCookingPhotoInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const dummyPhotoSequence = useRef(1);

  const handleAddPhoto = useCallback(() => {
    const sequence = dummyPhotoSequence.current;
    dummyPhotoSequence.current += 1;
    const filename = `dummy-cooking-photo-${String(sequence).padStart(2, '0')}.jpg`;
    setPhotos((current) => [
      ...current,
      {
        localPath: `file:///daidoko/dummy/${filename}`,
        takenAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const handleRemovePhoto = useCallback((localPath: string) => {
    setPhotos((current) => current.filter((photo) => photo.localPath !== localPath));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // ダミーパス（カメラ未実装のプレースホルダー）は DB に保存しない
      const realPhotos = photos.filter((p) => !p.localPath.startsWith('file:///daidoko/dummy/'));
      await createCookingLog({
        recipeId: id,
        rating: rating > 0 ? rating : undefined,
        memo: memo.trim() || undefined,
        cookedAt: new Date().toISOString(),
        photos: realPhotos.length > 0 ? realPhotos : undefined,
      });
      setShowToast(true);
      setTimeout(() => router.push('/(tabs)'), 1500);
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
        <Text style={styles.headerTitle}>調理を記録する</Text>
        <Pressable onPress={handleSkip} hitSlop={12}>
          <Text style={styles.skipText}>スキップ</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Completion message */}
        <View style={styles.completionBanner}>
          <Text style={styles.completionEmoji}>🎉</Text>
          <Text style={styles.completionText}>お疲れさまでした！</Text>
          <Text style={styles.completionSub}>今日の料理を記録しておきましょう</Text>
        </View>

        {/* Photos */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>写真</Text>
          <Pressable style={styles.photoAddButton} onPress={handleAddPhoto}>
            <Camera color={Colors.gold} size={18} />
            <Text style={styles.photoAddText}>写真を追加</Text>
          </Pressable>
          {photos.length > 0 && (
            <View style={styles.photoList}>
              {photos.map((photo, index) => (
                <View key={photo.localPath} style={styles.photoRow}>
                  <View style={styles.photoThumb}>
                    <Text style={styles.photoThumbText}>{index + 1}</Text>
                  </View>
                  <View style={styles.photoMeta}>
                    <Text style={styles.photoName} numberOfLines={1}>
                      {getPhotoFilename(photo.localPath)}
                    </Text>
                    <Text style={styles.photoState}>登録待ち</Text>
                  </View>
                  <Pressable onPress={() => handleRemovePhoto(photo.localPath)} hitSlop={8}>
                    <X color={Colors.muted} size={18} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Rating */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>評価</Text>
          <StarRow value={rating} onChange={setRating} />
          {rating > 0 && (
            <Text style={styles.ratingHint}>
              {['', '改善の余地あり', 'まあまあ', '良かった', 'とても良かった', '最高！'][rating]}
            </Text>
          )}
        </View>

        {/* Memo */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>メモ（任意）</Text>
          <TextInput
            style={styles.memoInput}
            value={memo}
            onChangeText={setMemo}
            placeholder="アレンジ・気づき・次回への覚書..."
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
          <Text style={styles.saveButtonText}>{saving ? '保存中...' : '記録する'}</Text>
        </Pressable>
      </View>

      <Toast message="記録しました！" visible={showToast} onDismiss={() => setShowToast(false)} />
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
  photoAddButton: {
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
  photoAddText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.gold,
  },
  photoList: {
    gap: 8,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#120E08',
  },
  photoThumb: {
    width: 42,
    height: 42,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#261B0D',
  },
  photoThumbText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.gold,
  },
  photoMeta: {
    flex: 1,
    minWidth: 0,
  },
  photoName: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.paper,
  },
  photoState: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '400',
    color: Colors.paperDim,
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

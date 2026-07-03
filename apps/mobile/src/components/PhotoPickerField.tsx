/**
 * Photo picker field for the recipe form — cover photo (large) and per-step
 * photos (thumb). Captures via camera or gallery, persists into the app's
 * recipe-photos directory, and reports the stored path via onChange.
 * Replaced/removed photos keep their files (older revisions may reference them).
 */
import { Camera, ImageIcon, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { expoImagePickerPhotoCaptureAdapter } from '../services/expo-photo-capture.adapter';
import { capturePhoto, type PhotoCaptureSource } from '../services/photo-capture.service';
import { persistRecipePhoto } from '../services/photo-storage.service';

interface PhotoPickerFieldProps {
  /** Stored photo path (undefined = none) */
  value: string | undefined;
  onChange: (path: string | undefined) => void;
  /** 'cover' = full-width preview, 'thumb' = compact row */
  variant: 'cover' | 'thumb';
}

export function PhotoPickerField({ value, onChange, variant }: PhotoPickerFieldProps) {
  const [busy, setBusy] = useState(false);

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

  const isCover = variant === 'cover';

  return (
    <View style={isCover ? styles.coverContainer : styles.thumbContainer}>
      {value ? (
        <View style={isCover ? styles.coverPreviewWrap : styles.thumbPreviewWrap}>
          <Image
            source={{ uri: value }}
            style={isCover ? styles.coverPreview : styles.thumbPreview}
            resizeMode="cover"
          />
          <Pressable
            style={styles.removeBadge}
            onPress={() => onChange(undefined)}
            hitSlop={8}
            accessibilityLabel="写真を削除"
          >
            <X size={14} color={Colors.paper} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.buttonRow}>
        {busy ? (
          <ActivityIndicator color={Colors.gold} size="small" />
        ) : (
          <>
            <Pressable
              style={styles.pickButton}
              onPress={() => handlePick('camera')}
              accessibilityLabel="写真を撮影"
            >
              <Camera size={15} color={Colors.goldDim} />
              <Text style={styles.pickButtonText}>{value ? '撮り直す' : '撮影'}</Text>
            </Pressable>
            <Pressable
              style={styles.pickButton}
              onPress={() => handlePick('gallery')}
              accessibilityLabel="ギャラリーから選ぶ"
            >
              <ImageIcon size={15} color={Colors.goldDim} />
              <Text style={styles.pickButtonText}>ギャラリー</Text>
            </Pressable>
          </>
        )}
      </View>
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
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  pickButtonText: { fontSize: 13, color: Colors.goldDim },
});

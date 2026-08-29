/**
 * AI で作ったイメージのプレビューシート（docs/レシピ表紙AI生成設計.md §2）。
 *
 * **採用は常に人間。** 生成できたからといって自動で表紙に設定しない —
 * ここで［このイメージにする］を押して初めて `onAdopt` が呼ばれる。
 * ［作り直す〕は 1 回ぶん消費することを文言で明示する（`coverImage.retry`）。
 */
import { Image, Pressable, StyleSheet, Text } from 'react-native';

import { BottomSheet } from './BottomSheet';
import { Colors } from '../constants/theme';
import { t } from '../i18n';

interface CoverImagePreviewSheetProps {
  visible: boolean;
  /** data: URI（`data:${mimeType};base64,${dataBase64}`）。null の間は何も描かない。 */
  imageUri: string | null;
  busy: boolean;
  onAdopt: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onReport: () => void;
}

export function CoverImagePreviewSheet({
  visible,
  imageUri,
  busy,
  onAdopt,
  onRetry,
  onCancel,
  onReport,
}: CoverImagePreviewSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onCancel}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
      ) : null}
      <Text style={styles.notice}>{t('coverImage.previewNotice')}</Text>

      <Pressable
        style={[styles.primaryButton, busy && styles.disabled]}
        onPress={onAdopt}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{t('coverImage.useThis')}</Text>
      </Pressable>
      <Pressable
        style={[styles.secondaryButton, busy && styles.disabled]}
        onPress={onRetry}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>{t('coverImage.retry')}</Text>
      </Pressable>
      <Pressable style={styles.plainButton} onPress={onCancel} accessibilityRole="button">
        <Text style={styles.plainText}>{t('coverImage.cancel')}</Text>
      </Pressable>
      <Pressable style={styles.reportButton} onPress={onReport} accessibilityRole="button">
        <Text style={styles.reportText}>{t('coverImage.report')}</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: 220,
    borderRadius: 8,
    backgroundColor: Colors.bgInput,
    marginBottom: 10,
  },
  notice: {
    fontSize: 12,
    color: Colors.paperDim,
    marginBottom: 16,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: Colors.gold,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryText: { fontSize: 15, fontWeight: '600', color: Colors.bg },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryText: { fontSize: 14, color: Colors.paper },
  plainButton: { paddingVertical: 10, alignItems: 'center' },
  plainText: { fontSize: 13, color: Colors.paperDim },
  reportButton: { paddingVertical: 8, alignItems: 'center' },
  reportText: { fontSize: 12, color: Colors.muted, textDecorationLine: 'underline' },
  disabled: { opacity: 0.5 },
});

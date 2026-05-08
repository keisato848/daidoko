/**
 * S10: OCR Import screen
 * On native: camera capture → A2 OCRAgent → RecipeForm preview
 * On web / Expo Go: shows requirements and manual fallback
 */
import { useRouter } from 'expo-router';
import { Camera, PenLine, X } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../../../src/constants/theme';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

export default function ImportOcrScreen() {
  const router = useRouter();

  const handleManual = () => {
    router.replace('/recipes/new');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>写真から読み取り</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrapper}>
          <Camera size={48} color={isNative ? Colors.gold : Colors.muted} />
        </View>

        {isNative ? (
          /* Native placeholder — vision-camera not bundled yet */
          <>
            <Text style={styles.title}>カメラ OCR（v1.5 対応予定）</Text>
            <Text style={styles.description}>
              レシピ本・手書きメモ・切り抜きを撮影するだけで、材料・手順を自動で読み取ります。
              {'\n\n'}
              現在の開発ビルドには含まれていません。v1.5 リリースまでお待ちください。
            </Text>
          </>
        ) : (
          /* Web — OCR requires native APIs */
          <>
            <Text style={styles.title}>OCR はネイティブアプリ専用です</Text>
            <Text style={styles.description}>
              カメラ文字認識（ML Kit）は iOS / Android アプリでのみ動作します。
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
      </View>
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
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

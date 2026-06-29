/**
 * レシート登録（P5）— 在庫画面の「レシート」から開く。
 * レシート写真 → 端末内OCR(無料) → 品目パース → 確認(編集/取捨) → 在庫へ一括追加。
 * docs/買い物リスト・在庫設計.md §5.6
 */
import { useRouter } from 'expo-router';
import { Camera, Check, ImageIcon, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Loading } from '../../src/components/Loading';
import { Colors } from '../../src/constants/theme';
import { createClientOcrRecognizer } from '../../src/services/client-ocr.provider';
import { expoImageManipulatorPreprocessAdapter } from '../../src/services/expo-image-preprocess.adapter';
import { expoImagePickerPhotoCaptureAdapter } from '../../src/services/expo-photo-capture.adapter';
import { preprocessImageForOcr } from '../../src/services/image-preprocess.service';
import { addPantryItem } from '../../src/services/pantry.service';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  type PhotoCaptureSource,
} from '../../src/services/photo-capture.service';
import { parseReceipt } from '../../src/utils/receiptParser';

type Phase = 'select' | 'processing' | 'review' | 'error';

interface ReviewItem {
  id: string;
  name: string;
  include: boolean;
}

export default function ReceiptScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handlePick = useCallback(async (source: PhotoCaptureSource) => {
    setErrorMsg(null);
    setPhase('processing');
    try {
      const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
      const recognize = createClientOcrRecognizer();
      if (!recognize) {
        setErrorMsg('この端末では OCR を利用できません。');
        setPhase('error');
        return;
      }
      let imageUri = photo.localPath;
      try {
        const pre = await preprocessImageForOcr(
          photo.localPath,
          expoImageManipulatorPreprocessAdapter,
        );
        imageUri = pre.imageUri;
      } catch {
        // fall back to the original image
      }
      const result = await recognize(imageUri);
      const parsed = parseReceipt(result.rawText);
      if (parsed.length === 0) {
        setErrorMsg('レシートから品目を読み取れませんでした。明るく正面から撮り直してください。');
        setPhase('error');
        return;
      }
      setItems(parsed.map((p, i) => ({ id: String(i), name: p.name, include: true })));
      setPhase('review');
    } catch (error) {
      if (error instanceof PhotoCaptureCancelledError) {
        setPhase('select');
        return;
      }
      setErrorMsg(error instanceof Error ? error.message : '読み取りに失敗しました');
      setPhase('error');
    }
  }, []);

  const handleAdd = useCallback(async () => {
    const chosen = items.filter((it) => it.include && it.name.trim());
    for (const it of chosen) {
      await addPantryItem(it.name.trim(), { quantity: 1 }).catch(() => undefined);
    }
    router.back();
  }, [items, router]);

  const chosenCount = items.filter((it) => it.include && it.name.trim()).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>レシートから在庫に追加</Text>
        <View style={styles.headerSpacer} />
      </View>

      {phase === 'processing' && <Loading message="レシートを読み取っています" />}

      {(phase === 'select' || phase === 'error') && (
        <View style={styles.selectArea}>
          {phase === 'error' && errorMsg ? (
            <Text style={styles.errorText}>{errorMsg}</Text>
          ) : (
            <Text style={styles.hint}>
              レシートを撮影／選択すると、品目を読み取って在庫に一括追加できます。
            </Text>
          )}
          <Pressable style={styles.bigButton} onPress={() => handlePick('camera')}>
            <Camera size={20} color={Colors.bg} />
            <Text style={styles.bigButtonText}>レシートを撮影</Text>
          </Pressable>
          <Pressable style={styles.bigButtonOutline} onPress={() => handlePick('gallery')}>
            <ImageIcon size={20} color={Colors.gold} />
            <Text style={styles.bigButtonOutlineText}>ギャラリーから選ぶ</Text>
          </Pressable>
        </View>
      )}

      {phase === 'review' && (
        <>
          <Text style={styles.reviewHint}>
            読み取った品目です。不要な行のチェックを外し、名前を直して追加してください。
          </Text>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable
                  onPress={() =>
                    setItems((prev) =>
                      prev.map((it) => (it.id === item.id ? { ...it, include: !it.include } : it)),
                    )
                  }
                  hitSlop={6}
                  accessibilityLabel={item.include ? '除外' : '含める'}
                >
                  <View style={[styles.checkbox, item.include && styles.checkboxOn]}>
                    {item.include && <Check size={14} color={Colors.bg} />}
                  </View>
                </Pressable>
                <TextInput
                  style={[styles.nameInput, !item.include && styles.nameInputOff]}
                  value={item.name}
                  onChangeText={(text) =>
                    setItems((prev) =>
                      prev.map((it) => (it.id === item.id ? { ...it, name: text } : it)),
                    )
                  }
                  editable={item.include}
                  maxLength={50}
                />
              </View>
            )}
          />
          <View style={styles.footer}>
            <Pressable style={styles.linkButton} onPress={() => setPhase('select')}>
              <Text style={styles.linkText}>やり直す</Text>
            </Pressable>
            <Pressable
              style={[styles.addButton, chosenCount === 0 && styles.addButtonDisabled]}
              onPress={handleAdd}
              disabled={chosenCount === 0}
            >
              <Text style={styles.addButtonText}>在庫に追加（{chosenCount}）</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
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
  headerTitle: { fontSize: 15, fontWeight: '500', color: Colors.paper, letterSpacing: 0.5 },
  headerSpacer: { width: 20 },
  selectArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  hint: { color: Colors.muted, textAlign: 'center', lineHeight: 22, fontSize: 14, marginBottom: 8 },
  errorText: {
    color: '#C97A4A',
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 14,
    marginBottom: 8,
  },
  bigButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    backgroundColor: Colors.gold,
    paddingVertical: 14,
    borderRadius: 10,
  },
  bigButtonText: { color: Colors.bg, fontSize: 15, fontWeight: '600' },
  bigButtonOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.gold,
    paddingVertical: 14,
    borderRadius: 10,
  },
  bigButtonOutlineText: { color: Colors.gold, fontSize: 15, fontWeight: '600' },
  reviewHint: {
    color: Colors.muted,
    fontSize: 13,
    paddingHorizontal: 20,
    paddingVertical: 12,
    lineHeight: 19,
  },
  listContent: { paddingHorizontal: 20, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  nameInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.paper,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#130E08',
  },
  nameInputOff: { color: Colors.muted, opacity: 0.5 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  linkButton: { paddingVertical: 12, paddingHorizontal: 12 },
  linkText: { color: Colors.muted, fontSize: 14 },
  addButton: {
    flex: 1,
    backgroundColor: Colors.gold,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  addButtonDisabled: { opacity: 0.45 },
  addButtonText: { color: Colors.bg, fontSize: 15, fontWeight: '600' },
});

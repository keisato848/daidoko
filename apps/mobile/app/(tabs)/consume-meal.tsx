/**
 * 食事写真→消費推定（P6・実験的）— 在庫画面の「食べた」から開く。
 * 食事写真 → AI(Vision) で使った食材を推定 → 在庫と照合 → 確認して在庫を減らす。
 * Vision コストのためプレミアム/BYOK/無料枠(写真レシピと共有)＋広告でゲート。
 * docs/買い物リスト・在庫設計.md §5.7
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Camera, Check, ImageIcon, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Loading } from '../../src/components/Loading';
import { Colors } from '../../src/constants/theme';
import { expoImagePickerPhotoCaptureAdapter } from '../../src/services/expo-photo-capture.adapter';
import { applyConsumption, inferMealConsumption } from '../../src/services/meal-consume.service';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  type PhotoCaptureSource,
} from '../../src/services/photo-capture.service';
import {
  getFreemiumStatus,
  recordCloudInference,
  type FreemiumStatus,
} from '../../src/services/usage.service';

type Phase = 'select' | 'processing' | 'review' | 'error';

interface ReviewMatch {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  selected: boolean;
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default function ConsumeMealScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [dish, setDish] = useState<string | null>(null);
  const [matches, setMatches] = useState<ReviewMatch[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [freemium, setFreemium] = useState<FreemiumStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      getFreemiumStatus()
        .then(setFreemium)
        .catch(() => setFreemium(null));
    }, []),
  );

  const handlePick = useCallback(
    async (source: PhotoCaptureSource) => {
      const status = freemium ?? (await getFreemiumStatus().catch(() => null));
      if (status && !status.canInfer) {
        router.push('/recipes/paywall');
        return;
      }
      setErrorMsg(null);
      setPhase('processing');
      try {
        const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
        const mimeType = ALLOWED_MIME.has(photo.mimeType ?? '')
          ? (photo.mimeType as string)
          : 'image/jpeg';
        const result = await inferMealConsumption({ localPath: photo.localPath, mimeType });
        recordCloudInference().catch(() => undefined);
        if (result.matches.length === 0) {
          setErrorMsg(
            result.dish
              ? `「${result.dish}」と推定しましたが、在庫に該当する食材がありませんでした。`
              : '料理を認識できませんでした。明るく正面から撮り直してください。',
          );
          setPhase('error');
          return;
        }
        setDish(result.dish);
        setMatches(
          result.matches.map((m) => ({
            id: m.pantryItemId,
            name: m.pantryName,
            quantity: m.quantity,
            unit: m.unit,
            selected: true,
          })),
        );
        setPhase('review');
      } catch (error) {
        if (error instanceof PhotoCaptureCancelledError) {
          setPhase('select');
          return;
        }
        setErrorMsg(error instanceof Error ? error.message : '解析に失敗しました');
        setPhase('error');
      }
    },
    [freemium, router],
  );

  const handleApply = useCallback(async () => {
    const ids = matches.filter((m) => m.selected).map((m) => m.id);
    await applyConsumption(ids).catch(() => undefined);
    router.back();
  }, [matches, router]);

  const selectedCount = matches.filter((m) => m.selected).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>食べた分を在庫から</Text>
        <View style={styles.headerSpacer} />
      </View>

      {phase === 'processing' && <Loading message="食事を解析しています" />}

      {(phase === 'select' || phase === 'error') && (
        <View style={styles.selectArea}>
          {phase === 'error' && errorMsg ? (
            <Text style={styles.errorText}>{errorMsg}</Text>
          ) : (
            <Text style={styles.hint}>
              食事の写真を撮ると、使った食材を推定して在庫を減らせます（実験的）。
            </Text>
          )}
          <Pressable style={styles.bigButton} onPress={() => handlePick('camera')}>
            <Camera size={20} color={Colors.bg} />
            <Text style={styles.bigButtonText}>食事を撮影</Text>
          </Pressable>
          <Pressable style={styles.bigButtonOutline} onPress={() => handlePick('gallery')}>
            <ImageIcon size={20} color={Colors.gold} />
            <Text style={styles.bigButtonOutlineText}>ギャラリーから選ぶ</Text>
          </Pressable>
          {freemium && !freemium.isPremium && !freemium.isByok && (
            <Text style={styles.quota}>今日の無料解析: 残り {freemium.remaining} 回</Text>
          )}
        </View>
      )}

      {phase === 'review' && (
        <>
          <Text style={styles.reviewHint}>
            {dish ? `「${dish}」` : 'この食事'}で使った食材のうち、在庫にあるものです。
            {'\n'}減らすものを選んで確定してください。
          </Text>
          <FlatList
            data={matches}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() =>
                  setMatches((prev) =>
                    prev.map((m) => (m.id === item.id ? { ...m, selected: !m.selected } : m)),
                  )
                }
              >
                <View style={[styles.checkbox, item.selected && styles.checkboxOn]}>
                  {item.selected && <Check size={14} color={Colors.bg} />}
                </View>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemQty}>
                  {item.quantity ?? '—'}
                  {item.unit ? ` ${item.unit}` : ''} →{' '}
                  {Math.max(0, (item.quantity ?? 1) - 1) || '0'}
                </Text>
              </Pressable>
            )}
          />
          <View style={styles.footer}>
            <Pressable style={styles.linkButton} onPress={() => setPhase('select')}>
              <Text style={styles.linkText}>やり直す</Text>
            </Pressable>
            <Pressable
              style={[styles.applyButton, selectedCount === 0 && styles.applyDisabled]}
              onPress={handleApply}
              disabled={selectedCount === 0}
            >
              <Text style={styles.applyText}>在庫を減らす（{selectedCount}）</Text>
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
  quota: { color: Colors.muted, fontSize: 12, marginTop: 4 },
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
    paddingVertical: 12,
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
  itemName: { flex: 1, fontSize: 15, color: Colors.paper },
  itemQty: { fontSize: 13, color: Colors.paperDim },
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
  applyButton: {
    flex: 1,
    backgroundColor: Colors.gold,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyDisabled: { opacity: 0.45 },
  applyText: { color: Colors.bg, fontSize: 15, fontWeight: '600' },
});

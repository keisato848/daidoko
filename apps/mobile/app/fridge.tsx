/**
 * 冷蔵庫の写真から在庫へ追加（`docs/冷蔵庫写真設計.md`）。
 * 追加タブ「写真から」の「冷蔵庫からレシピ」から開く。
 *
 * 冷蔵庫写真 → AI が食材の**品名だけ**読み取り → 確認シート（修正・取捨） →
 * 在庫へ「追加のみ」マージ → 「この材料で作れるレシピ」へ誘導 — の 1 フロー。
 *
 * 守っていること（ペルソナ確定要件）:
 * - 確認シートは必須・自動確定はしない。品名は**修正できる**（外せるだけにしない）
 * - 数量は読ませない・登録しない（quantity=null = 数量未管理）
 * - 既存在庫と同名（名寄せ済み比較）は「すでに在庫にあります」表示＋既定オフ。
 *   上書き・合算はしない。写っていない品目は絶対に消さない
 * - 開示は撮影・選択の**前**（select 画面に常時表示）
 * - 読み取り 1 回 = 無料枠 1 消費（ensureInferenceCredit / recordCloudInference・BYOK は無制限）
 */
import { MAX_FRIDGE_IMAGES } from '@daidoko/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { Camera, Check, ChefHat, ImageIcon, MessagesSquare, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { KeyboardAvoider } from '../src/components/KeyboardAvoider';
import { Loading } from '../src/components/Loading';
import { Colors } from '../src/constants/theme';
import { t, tCount } from '../src/i18n';
import { expoImagePickerPhotoCaptureAdapter } from '../src/services/expo-photo-capture.adapter';
import { FridgeInferError, inferFridgeItems } from '../src/services/fridge-vision.provider';
import { ensureInferenceCredit } from '../src/services/inference-gate.service';
import { getAliasMap } from '../src/services/name-alias.service';
import { addPantryItem, defaultGroupFor, getPantryItems } from '../src/services/pantry.service';
import {
  capturePhotoSeries,
  confirmContinueCapture,
  type PhotoCaptureSource,
} from '../src/services/photo-capture.service';
import {
  getFreemiumStatus,
  recordCloudInference,
  type FreemiumStatus,
} from '../src/services/usage.service';
import {
  buildFridgeReviewItems,
  parseFridgeQuantityText,
  type FridgeReviewItem,
} from '../src/utils/fridgeReview';

function mimeTypeFor(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

type Phase = 'select' | 'processing' | 'review' | 'done' | 'error';

export default function FridgeScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [items, setItems] = useState<FridgeReviewItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [freemium, setFreemium] = useState<FreemiumStatus | null>(null);

  // 残数表示（ペイウォールから戻ったときに更新される）。読めなくても機能は止めない
  const refreshFreemium = useCallback(() => {
    getFreemiumStatus()
      .then(setFreemium)
      .catch(() => setFreemium(null));
  }, []);
  useFocusEffect(refreshFreemium);

  const handlePick = useCallback(
    async (source: PhotoCaptureSource) => {
      setErrorMsg(null);

      // 枠切れなら、その場で広告視聴を持ちかけてそのまま続行する（写真レシピと同じ倒し方）。
      // ペイウォールは広告を出せないとき（no-fill・広告無効ビルド）の逃げ道
      const gate = await ensureInferenceCredit();
      if (gate === 'paywall') {
        router.push('/recipes/paywall');
        return;
      }
      if (gate !== 'ready') return;

      try {
        // 連続撮影: 冷蔵室＋野菜室のように 2 枚まで。読み取りは 2 枚まとめて
        // 1 回の推論（= 無料枠 1 消費のまま。契約 MAX_FRIDGE_IMAGES）
        const photos = await capturePhotoSeries(source, expoImagePickerPhotoCaptureAdapter, {
          maxCount: MAX_FRIDGE_IMAGES,
          confirmMore: confirmContinueCapture,
        });
        if (photos.length === 0) return; // キャンセル
        setPhase('processing');

        const inference = await inferFridgeItems({
          images: photos.map((photo) => ({
            localPath: photo.localPath,
            mimeType: mimeTypeFor(photo.localPath),
          })),
        });
        // 消費は managed サーバー経由の成功時だけ（BYOK は自分のキー = 無制限）
        if (inference.source === 'cloud') {
          recordCloudInference()
            .then(refreshFreemium)
            .catch(() => undefined);
        }

        if (inference.items.length === 0) {
          setErrorMsg(t('pantry.fridge.noItems'));
          setPhase('error');
          return;
        }

        // 既存在庫との重複（名寄せ済み比較）を印にする。読めなくても素の比較で続ける
        const [pantryItems, aliasMap] = await Promise.all([
          getPantryItems().catch(() => []),
          getAliasMap().catch(() => ({}) as Record<string, string>),
        ]);
        setItems(
          buildFridgeReviewItems(
            inference.items,
            pantryItems.map((item) => item.name),
            aliasMap,
          ),
        );
        setPhase('review');
      } catch (error) {
        setErrorMsg(error instanceof FridgeInferError ? error.message : t('pantry.fridge.failed'));
        setPhase('error');
      }
    },
    [refreshFreemium, router],
  );

  const handleAdd = useCallback(async () => {
    const chosen = items.filter((it) => it.include && it.name.trim());
    let failed = 0;
    for (const it of chosen) {
      const name = it.name.trim();
      // 既にその品が 1 か所だけに置いてあるなら、そこへ足す（レシートと同じ）。
      // 数量は null のまま渡す＝「数量未管理」で登録する（分量は読ませない）
      // 数量テキスト（「3本」「約200g」）を quantity × unit に分解。読めない表現は
      // 数量未管理（null）のまま — 推測で 1 にしない
      const { quantity, unit } = parseFridgeQuantityText(it.quantity);
      const groupName = await defaultGroupFor(name, unit).catch(() => null);
      const added = await addPantryItem(name, { quantity, unit, groupName }).catch(() => null);
      // 失敗を数える（P5 — 全部入ったように見せない。正直に言う）
      if (!added) failed += 1;
    }
    setAddedCount(chosen.length - failed);
    setFailedCount(failed);
    setPhase('done');
  }, [items]);

  const chosenCount = items.filter((it) => it.include && it.name.trim()).length;

  return (
    // 品目名を直すとキーボードが出る。包まないと下部の「在庫に追加」フッターが隠れる
    <KeyboardAvoider style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel={t('common.close')}
        >
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('pantry.fridge.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {phase === 'processing' && <Loading message={t('pantry.fridge.reading')} />}

      {(phase === 'select' || phase === 'error') && (
        <View style={styles.selectArea}>
          {phase === 'error' && errorMsg ? (
            <Text style={styles.errorText}>{errorMsg}</Text>
          ) : (
            <Text style={styles.hint}>{t('pantry.fridge.lead')}</Text>
          )}

          {freemium &&
            (freemium.isPremium || freemium.isByok ? (
              <Text style={styles.quotaPremium}>
                {freemium.isByok
                  ? t('recipe.photo.unlimitedByok')
                  : t('recipe.photo.unlimitedPremium')}
              </Text>
            ) : (
              <Pressable onPress={() => router.push('/recipes/paywall')} hitSlop={8}>
                <Text style={styles.quotaText}>
                  {tCount('recipe.photo.quotaRemaining', freemium.remaining)}
                </Text>
                <Text style={styles.quotaHint}>{t('recipe.photo.quotaHint')}</Text>
              </Pressable>
            ))}

          <Pressable style={styles.bigButton} onPress={() => handlePick('camera')}>
            <Camera size={20} color={Colors.bg} />
            <Text style={styles.bigButtonText}>{t('pantry.fridge.capture')}</Text>
          </Pressable>
          <Pressable style={styles.bigButtonOutline} onPress={() => handlePick('gallery')}>
            <ImageIcon size={20} color={Colors.gold} />
            <Text style={styles.bigButtonOutlineText}>{t('common.pickFromGallery')}</Text>
          </Pressable>

          {/* 開示は撮影・選択の**前**に読める場所へ（A 階層・設計 §4-5） */}
          <Text style={styles.disclosure}>{t('pantry.fridge.disclosure')}</Text>

          {phase === 'error' && (
            <Pressable style={styles.manualLink} onPress={() => router.replace('/(tabs)/pantry')}>
              <Text style={styles.manualLinkText}>{t('pantry.fridge.manualFallback')}</Text>
            </Pressable>
          )}
        </View>
      )}

      {phase === 'review' && (
        <>
          <Text style={styles.reviewHint}>{t('pantry.fridge.resultHint')}</Text>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            /* 編集中でもチェックや他の行を 1 タップで操作できる */
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable
                  onPress={() =>
                    setItems((prev) =>
                      prev.map((it) => (it.id === item.id ? { ...it, include: !it.include } : it)),
                    )
                  }
                  hitSlop={6}
                  accessibilityLabel={
                    item.include ? t('pantry.fridge.exclude') : t('pantry.fridge.include')
                  }
                >
                  <View style={[styles.checkbox, item.include && styles.checkboxOn]}>
                    {item.include && <Check size={14} color={Colors.bg} />}
                  </View>
                </Pressable>
                <View style={styles.nameColumn}>
                  <View style={styles.nameRow}>
                    {/* 読み取りに自信が無い品目は「たぶん」印（自動確定はどの段階でもしない） */}
                    {item.band === 'low' && (
                      <Text
                        style={styles.uncertainBadge}
                        accessibilityLabel={t('pantry.fridge.uncertainLabel')}
                      >
                        {t('pantry.fridge.uncertainBadge')}
                      </Text>
                    )}
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
                    {/* 数量（読めた場合のみ入る・編集可・空欄可 = 数量未管理。
                        オーナー決定 2026-09-05 — 推測はさせず、直せる形で見せる） */}
                    <TextInput
                      style={[styles.quantityInput, !item.include && styles.nameInputOff]}
                      value={item.quantity}
                      onChangeText={(text) =>
                        setItems((prev) =>
                          prev.map((it) => (it.id === item.id ? { ...it, quantity: text } : it)),
                        )
                      }
                      editable={item.include}
                      maxLength={30}
                      placeholder={t('pantry.fridge.quantityPlaceholder')}
                      placeholderTextColor={Colors.muted}
                      accessibilityLabel={t('pantry.fridge.quantityLabel')}
                    />
                  </View>
                  {/* 在庫に既にある品は既定オフ＋理由の表示（上書き・合算はしない） */}
                  {item.inPantry && (
                    <Text style={styles.inPantryNote}>{t('pantry.fridge.alreadyInPantry')}</Text>
                  )}
                </View>
              </View>
            )}
          />
          <View style={styles.footer}>
            <Pressable style={styles.linkButton} onPress={() => setPhase('select')}>
              <Text style={styles.linkText}>{t('pantry.fridge.retry')}</Text>
            </Pressable>
            <Pressable
              style={[styles.addButton, chosenCount === 0 && styles.addButtonDisabled]}
              onPress={handleAdd}
              disabled={chosenCount === 0}
            >
              <Text style={styles.addButtonText}>
                {tCount('pantry.fridge.confirm', chosenCount)}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {phase === 'done' && (
        <View style={styles.selectArea}>
          <View style={styles.doneIcon}>
            <Check size={30} color={Colors.gold} />
          </View>
          <Text style={styles.doneText}>{tCount('pantry.fridge.added', addedCount)}</Text>
          {/* 一部失敗を隠さない（P5）。名寄せや DB の失敗はここで正直に言う */}
          {failedCount > 0 && (
            <Text style={styles.doneFailedText}>
              {tCount('pantry.fridge.addFailed', failedCount)}
            </Text>
          )}
          {/* A: そのまま「この材料で作れるレシピ」へ（新しい生成ロジックは作らない — 既存資産へ接続） */}
          <Pressable style={styles.bigButton} onPress={() => router.replace('/cookable')}>
            <ChefHat size={20} color={Colors.bg} />
            <Text style={styles.bigButtonText}>{t('pantry.fridge.cookableCta')}</Text>
          </Pressable>
          <Pressable
            style={styles.bigButtonOutline}
            onPress={() => router.replace('/recipes/consult')}
          >
            <MessagesSquare size={20} color={Colors.gold} />
            <Text style={styles.bigButtonOutlineText}>{t('pantry.fridge.consultCta')}</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => router.back()}>
            <Text style={styles.linkText}>{t('common.close')}</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoider>
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
  disclosure: {
    // 開示は読めて初めて開示になる（muted だと背景と同化する — レシートの知見をそのまま）
    color: Colors.paperDim,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  errorText: {
    color: '#C97A4A',
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 14,
    marginBottom: 8,
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
  manualLink: { paddingVertical: 8 },
  manualLinkText: { color: Colors.muted, fontSize: 13, textDecorationLine: 'underline' },
  reviewHint: {
    color: Colors.paperDim,
    fontSize: 13,
    paddingHorizontal: 20,
    paddingVertical: 12,
    lineHeight: 19,
  },
  listContent: { paddingHorizontal: 20, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  nameColumn: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  uncertainBadge: {
    fontSize: 11,
    color: '#E0A85C',
    borderWidth: 1,
    borderColor: '#8A6A3A',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  nameInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.paper,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#130E08',
  },
  quantityInput: {
    width: 76,
    fontSize: 14,
    color: Colors.paper,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: '#130E08',
    textAlign: 'center',
  },
  // 無効（既定オフ）でも品名は読めること（実機指摘 2026-09-05 — muted #5A4A34 ＋
  // opacity 0.5 は背景 #0A0805 に沈んで視認不能だった）。#9A8A6C は背景に対して
  // 約 5.4:1（WCAG AA）。「無効」はチェックなし＋入力背景の消灯で伝える
  nameInputOff: { color: '#9A8A6C', backgroundColor: 'transparent' },
  inPantryNote: { fontSize: 11, color: Colors.goldDim },
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
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1108',
  },
  doneText: { color: Colors.paper, fontSize: 16, fontWeight: '500', textAlign: 'center' },
  doneFailedText: { color: '#C97A4A', fontSize: 13, textAlign: 'center' },
});

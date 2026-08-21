/**
 * レシート登録（P5）— 在庫画面の「レシート」から開く。
 * レシート写真 → 読み取り → 品目確認(編集/取捨) → 在庫へ一括追加。
 *
 * 読み取りは2経路（`docs/在庫・レシート設計レビュー.md` §3.4 / Issue #178）:
 *   端末内OCRが使える → 文字起こし → **テキストだけ**を AI へ → 構造化
 *   使えない/読めない → **画像**を AI へ（Vision）
 * 端末内OCRは文字起こしに専念する。品目化（非食品の除外・重複統合・数量抽出）は
 * どちらの経路でも AI 側の同じロジックを通る。
 * 端末内OCRが転ぶ条件（モデル未取得・認識失敗・文字なし）はすべて画像経路へ落とす。
 */
import { useRouter } from 'expo-router';
import { Camera, Check, ImageIcon, Store, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GroupPicker } from '../../src/components/GroupPicker';
import { KeyboardAvoider } from '../../src/components/KeyboardAvoider';
import { Loading } from '../../src/components/Loading';
import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import {
  recognizeTextOnDevice,
  isClientOcrAvailable,
} from '../../src/services/client-ocr.provider';
import { expoImageManipulatorPreprocessAdapter } from '../../src/services/expo-image-preprocess.adapter';
import { expoImagePickerPhotoCaptureAdapter } from '../../src/services/expo-photo-capture.adapter';
import { preprocessImageForOcr } from '../../src/services/image-preprocess.service';
import { addPantryItem, defaultGroupFor } from '../../src/services/pantry.service';
import {
  capturePhoto,
  PhotoCaptureCancelledError,
  type PhotoCaptureSource,
} from '../../src/services/photo-capture.service';
import {
  inferReceiptFromText,
  inferReceiptFromVision,
  type ReceiptInference,
} from '../../src/services/receipt-vision.provider';
import { checkOffByNames, matchPendingByNames } from '../../src/services/shopping-list.service';
import {
  getShoppingStoreGroups,
  getStoreGroupFor,
  learnStoreGroup,
} from '../../src/services/store-group.service';
import { formatQuantityInput, parseQuantityInput } from '../../src/utils/receiptQuantity';

/**
 * 端末内OCRで文字起こしする。**読めなければ null**（呼び出し側は画像経路へ）。
 * 前処理（傾き・コントラスト補正）は失敗しても元画像で続ける — 読めれば十分で、
 * ここで止まると「端末内で読めたはずのレシート」を画像経路に流すことになる。
 */
async function readTextOnDevice(localPath: string): Promise<string | null> {
  let imageUri = localPath;
  try {
    const pre = await preprocessImageForOcr(localPath, expoImageManipulatorPreprocessAdapter);
    imageUri = pre.imageUri;
  } catch {
    // fall back to the original image
  }
  return recognizeTextOnDevice(imageUri);
}

function mimeTypeFor(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

type Phase = 'select' | 'processing' | 'review' | 'error';

interface ReviewItem {
  id: string;
  name: string;
  /** 数量は自由入力のまま持つ（空欄＝数量未管理。0 や 1 で埋めない）。 */
  quantity: string;
  unit: string;
  include: boolean;
}

export default function ReceiptScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /**
   * 端末内OCRが**いま**使えるか。文言（何を送るか）を出し分けるためだけに持つ。
   * 経路そのものは読み取りの直前に判定し直す（モデルはあとから届くことがある）。
   */
  const [ocrReady, setOcrReady] = useState(false);

  /** レシートが読めた店名（v13）。買い物グループの対応付けに使う */
  const [store, setStore] = useState<string | null>(null);
  const [storeGroup, setStoreGroup] = useState<string | null>(null);
  const [storeGroups, setStoreGroups] = useState<string[]>([]);
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  /** 「買い物リストの◯件を消し込みます」の先読み。**黙って消さない**ための表示 */
  const [checkOffCount, setCheckOffCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    isClientOcrAvailable()
      .then((available) => {
        if (mounted) setOcrReady(available);
      })
      .catch(() => {
        if (mounted) setOcrReady(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handlePick = useCallback(async (source: PhotoCaptureSource) => {
    setErrorMsg(null);
    setPhase('processing');
    try {
      const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);

      // ① 端末内OCRで文字にできたら、テキストだけを AI へ送る（写真は端末から出ない）
      let inference: ReceiptInference | null = null;
      const ocrText = await readTextOnDevice(photo.localPath);
      if (ocrText) {
        inference = await inferReceiptFromText({ ocrText });
        // レシートと認識されない／1件も取れないのは OCR が崩れたということ。
        // 写真ならまだ読める見込みがあるので、画像経路をもう一度だけ試す
        if (!inference.isReceipt || inference.items.length === 0) inference = null;
      }

      // ② 端末内OCRが使えない・読めなかった → 画像を AI へ（BYOKキーがあれば直接 Gemini）
      if (!inference) {
        inference = await inferReceiptFromVision({
          localPath: photo.localPath,
          mimeType: mimeTypeFor(photo.localPath),
        });
        if (!inference.isReceipt) {
          setErrorMsg(t('pantry.receipt.notRecognized'));
          setPhase('error');
          return;
        }
      }

      if (inference.items.length === 0) {
        setErrorMsg(t('pantry.receipt.noItems'));
        setPhase('error');
        return;
      }
      setItems(
        inference.items.map((item, i) => ({
          id: String(i),
          name: item.name,
          quantity: formatQuantityInput(item.quantity),
          unit: item.unit ?? '',
          include: true,
        })),
      );

      // 店名は「次に同じ品を買い物リストへ入れるときの既定の店」を決めるためだけに使う。
      // 初めての店なら未設定のまま出し、利用者がその場で結び付けられるようにする
      const storeName = inference.store?.trim() || null;
      setStore(storeName);
      setStoreGroup(storeName ? await getStoreGroupFor(storeName).catch(() => null) : null);
      setStoreGroups(await getShoppingStoreGroups().catch(() => []));

      setPhase('review');
    } catch (error) {
      if (error instanceof PhotoCaptureCancelledError) {
        setPhase('select');
        return;
      }
      setErrorMsg(error instanceof Error ? error.message : t('pantry.receipt.failed'));
      setPhase('error');
    }
  }, []);

  const includedNames = items
    .filter((it) => it.include && it.name.trim())
    .map((it) => it.name.trim())
    .join('\u0000');

  // 品目名を直すたびに追従させる（名前を直して初めて当たることがある）
  useEffect(() => {
    if (phase !== 'review') return;
    let mounted = true;
    matchPendingByNames(includedNames ? includedNames.split('\u0000') : [])
      .then((hit) => {
        if (mounted) setCheckOffCount(hit.length);
      })
      .catch(() => {
        if (mounted) setCheckOffCount(0);
      });
    return () => {
      mounted = false;
    };
  }, [phase, includedNames]);

  const handleAdd = useCallback(async () => {
    const chosen = items.filter((it) => it.include && it.name.trim());
    for (const it of chosen) {
      const name = it.name.trim();
      const unit = it.unit.trim() || null;
      // 既にその品が 1 か所だけに置いてあるなら、そこへ足す。置き場所を使っている人の
      // 買い足しが「未設定」に別行で積まれるのを防ぐ（使っていない人には常に null）
      const groupName = await defaultGroupFor(name, unit).catch(() => null);
      // 空欄の数量は null のまま渡す＝在庫は「数量未管理」で持つ（§6）
      await addPantryItem(name, {
        quantity: parseQuantityInput(it.quantity),
        unit,
        groupName,
      }).catch(() => undefined);
    }

    // 買った品を買い物リストから消し込む（消さずにチェックを付けるだけ＝取り消せる）
    await checkOffByNames(chosen.map((it) => it.name.trim())).catch(() => undefined);
    if (store && storeGroup) await learnStoreGroup(store, storeGroup).catch(() => undefined);

    router.back();
  }, [items, router, store, storeGroup]);

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
        <Text style={styles.headerTitle}>{t('pantry.receipt.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {phase === 'processing' && <Loading message={t('pantry.receipt.reading')} />}

      {(phase === 'select' || phase === 'error') && (
        <View style={styles.selectArea}>
          {phase === 'error' && errorMsg ? (
            <Text style={styles.errorText}>{errorMsg}</Text>
          ) : (
            <Text style={styles.hint}>{t('pantry.receipt.lead')}</Text>
          )}
          <Pressable style={styles.bigButton} onPress={() => handlePick('camera')}>
            <Camera size={20} color={Colors.bg} />
            <Text style={styles.bigButtonText}>{t('pantry.receipt.capture')}</Text>
          </Pressable>
          <Pressable style={styles.bigButtonOutline} onPress={() => handlePick('gallery')}>
            <ImageIcon size={20} color={Colors.gold} />
            <Text style={styles.bigButtonOutlineText}>{t('common.pickFromGallery')}</Text>
          </Pressable>
          {/* 何が端末から出るのかを、経路に合わせて出し分ける（テキストだけ／写真） */}
          <Text style={styles.cloudNote}>
            {ocrReady ? t('pantry.receipt.disclosureOnDevice') : t('pantry.receipt.disclosure')}
          </Text>
        </View>
      )}

      {phase === 'review' && (
        <>
          <Text style={styles.reviewHint}>{t('pantry.receipt.resultHint')}</Text>
          {store != null && (
            <Pressable
              style={styles.storeRow}
              onPress={() => setStorePickerOpen(true)}
              accessibilityLabel={t('pantry.receipt.storeGroupTitle', { store })}
            >
              <Store size={14} color={Colors.muted} />
              <Text style={styles.storeText} numberOfLines={1}>
                {store} / {t('pantry.receipt.storeGroupLabel')}:{' '}
                {storeGroup ?? t('pantry.receipt.storeGroupUnset')}
              </Text>
            </Pressable>
          )}
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
                    item.include ? t('pantry.receipt.exclude') : t('pantry.receipt.include')
                  }
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
                <TextInput
                  style={[styles.qtyInput, !item.include && styles.nameInputOff]}
                  value={item.quantity}
                  onChangeText={(text) =>
                    setItems((prev) =>
                      prev.map((it) => (it.id === item.id ? { ...it, quantity: text } : it)),
                    )
                  }
                  editable={item.include}
                  keyboardType="numeric"
                  maxLength={6}
                  placeholder={t('pantry.receipt.quantityPlaceholder')}
                  placeholderTextColor={Colors.muted}
                  accessibilityLabel={t('pantry.receipt.quantityLabel')}
                />
                <TextInput
                  style={[styles.unitInput, !item.include && styles.nameInputOff]}
                  value={item.unit}
                  onChangeText={(text) =>
                    setItems((prev) =>
                      prev.map((it) => (it.id === item.id ? { ...it, unit: text } : it)),
                    )
                  }
                  editable={item.include}
                  maxLength={6}
                  placeholder={t('pantry.receipt.unitPlaceholder')}
                  placeholderTextColor={Colors.muted}
                  accessibilityLabel={t('pantry.receipt.unitLabel')}
                />
              </View>
            )}
          />
          {checkOffCount > 0 && (
            <Text style={styles.checkOffNote}>
              {tCount('pantry.receipt.checkOff', checkOffCount)}
            </Text>
          )}
          <View style={styles.footer}>
            <Pressable style={styles.linkButton} onPress={() => setPhase('select')}>
              <Text style={styles.linkText}>{t('pantry.receipt.retry')}</Text>
            </Pressable>
            <Pressable
              style={[styles.addButton, chosenCount === 0 && styles.addButtonDisabled]}
              onPress={handleAdd}
              disabled={chosenCount === 0}
            >
              <Text style={styles.addButtonText}>
                {tCount('pantry.receipt.confirm', chosenCount)}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      <GroupPicker
        visible={storePickerOpen}
        title={store ? t('pantry.receipt.storeGroupTitle', { store }) : ''}
        groups={storeGroups}
        value={storeGroup}
        noneLabel={t('pantry.receipt.storeGroupUnset')}
        newPlaceholder={t('pantry.shopping.storeGroup.newPlaceholder')}
        createLabel={t('pantry.group.create')}
        onSelect={(group) => {
          setStoreGroup(group);
          if (group && !storeGroups.includes(group)) setStoreGroups((prev) => [...prev, group]);
          setStorePickerOpen(false);
        }}
        onClose={() => setStorePickerOpen(false)}
      />
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  storeText: { fontSize: 12, color: Colors.muted, flexShrink: 1 },
  checkOffNote: {
    fontSize: 12,
    color: Colors.goldDim,
    paddingHorizontal: 20,
    paddingBottom: 8,
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
  cloudNote: {
    color: Colors.muted,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.8,
    marginTop: 4,
  },
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
  qtyInput: {
    width: 52,
    fontSize: 15,
    color: Colors.paper,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: '#130E08',
    textAlign: 'center',
  },
  unitInput: {
    width: 56,
    fontSize: 15,
    color: Colors.paper,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: '#130E08',
    textAlign: 'center',
  },
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

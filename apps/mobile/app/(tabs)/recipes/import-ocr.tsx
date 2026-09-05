/**
 * S10: 紙面からレシピを読み取る画面。
 *
 * **中身は端末内 OCR から AI に置き換わった**（`docs/レシピ推論の評価設計.md` §10）。
 * ML Kit は版面が少しでも複雑だと 1 文を断片に割ってしまい、実際のレシピ本や
 * 食品パッケージでは成立しなかった。ルート名（`import-ocr`）は 8 ファイルが
 * 参照しているのでそのまま。利用者に見える名前（「文字入り画像から作成」）も変わらない。
 *
 * 端末内 OCR との違い:
 * - **写真がサーバーへ出る** → 開示を必ず出す（`recipeImport.page.disclosure`）
 * - **無料枠を消費する** → `ensureInferenceCredit()` を通す
 * - **オフラインでは使えない**
 * - **iOS でも使える**（ML Kit は Android 限定だった）
 * - **複数枚を 1 つのレシピにまとめられる**（表に料理名・裏に材料と作り方）
 */
import { useRouter } from 'expo-router';
import {
  Camera,
  Image as ImageIcon,
  PenLine,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { RecipeForm } from '../../../src/components/RecipeForm';
import { SourceBanner } from '../../../src/components/SourceBanner';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { t, tCount } from '../../../src/i18n';
import { ensureInferenceCredit } from '../../../src/services/inference-gate.service';
import { expoImagePickerPhotoCaptureAdapter } from '../../../src/services/expo-photo-capture.adapter';
import {
  capturePhotoSeries,
  capturePhotosFromGallery,
  confirmContinueCapture,
  UserFacingError,
  type CapturedPhoto,
} from '../../../src/services/photo-capture.service';
import {
  MAX_RECIPE_PAGE_IMAGES,
  readRecipeFromPages,
  RecipePageError,
  type RecipePageResult,
} from '../../../src/services/recipe-page.provider';
import { createRecipe } from '../../../src/services/recipe.service';
import { maybeRequestStoreReview } from '../../../src/services/review-request.service';
import { createOcrSource } from '../../../src/services/source.service';
import { recordCloudInference } from '../../../src/services/usage.service';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'select' | 'processing' | 'preview';

function accuracyLabel(confidence: RecipePageResult['confidence']): string {
  if (confidence === 'high') return t('recipeImport.ocr.accuracy.high');
  if (confidence === 'medium') return t('recipeImport.ocr.accuracy.medium');
  return t('recipeImport.ocr.accuracy.low');
}

export default function ImportRecipePageScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [pages, setPages] = useState<CapturedPhoto[]>([]);
  const [result, setResult] = useState<RecipePageResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleManual = () => router.replace('/recipes/new');

  const addFromCamera = useCallback(async () => {
    setErrorMsg(null);
    try {
      // 連続撮影: 表→裏のように残り枠まで続けて撮れる（1 枚ごとに続行を確認）
      const shot = await capturePhotoSeries('camera', expoImagePickerPhotoCaptureAdapter, {
        maxCount: MAX_RECIPE_PAGE_IMAGES - pages.length,
        confirmMore: confirmContinueCapture,
      });
      if (shot.length === 0) return; // 1 枚目でキャンセル
      setPages((current) => [...current, ...shot].slice(0, MAX_RECIPE_PAGE_IMAGES));
    } catch (error) {
      setErrorMsg(error instanceof UserFacingError ? error.message : t('common.photoAddFailed'));
    }
  }, [pages.length]);

  const addFromGallery = useCallback(async () => {
    setErrorMsg(null);
    try {
      const remaining = MAX_RECIPE_PAGE_IMAGES - pages.length;
      const picked = await capturePhotosFromGallery(expoImagePickerPhotoCaptureAdapter, remaining);
      if (picked.length === 0) return;
      setPages((current) => [...current, ...picked].slice(0, MAX_RECIPE_PAGE_IMAGES));
    } catch (error) {
      setErrorMsg(error instanceof UserFacingError ? error.message : t('common.photoAddFailed'));
    }
  }, [pages.length]);

  const removePage = useCallback((index: number) => {
    setPages((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleRead = useCallback(async () => {
    if (pages.length === 0) return;
    setErrorMsg(null);

    // 枠切れなら、その場で広告視聴を持ちかけて続行する（端末内 OCR のときは無料だった）
    const gate = await ensureInferenceCredit();
    if (gate === 'paywall') {
      router.push('/recipes/paywall');
      return;
    }
    if (gate !== 'ready') return;

    setPhase('processing');
    try {
      const read = await readRecipeFromPages({ imageUris: pages.map((page) => page.localPath) });
      void recordCloudInference().catch(() => undefined);
      setResult(read);
      setPhase('preview');
    } catch (error) {
      setErrorMsg(error instanceof RecipePageError ? error.message : t('recipeImport.page.failed'));
      setPhase('select');
    }
  }, [pages, router]);

  const handleSave = useCallback(
    async (data: RecipeFormData) => {
      const sourceId = await createOcrSource({
        rawText: '',
        capturedAt: pages[0]?.takenAt,
      });
      // 紙面の撮影から中身を起こした下書き（#266）。端末内 OCR は廃止済みで、
      // この経路は現在すべて生成モデルを通る
      await createRecipe({ ...data, sourceId, aiGenerated: true });
      setToastMessage(t('recipeImport.saved'));
      // 紙面から AI の下書きが形になった瞬間にストア評価を打診（条件・頻度はサービス側）
      void maybeRequestStoreReview('ai-recipe');
      setTimeout(() => router.replace('/(tabs)/recipes'), 1500);
    },
    [pages, router],
  );

  if (phase === 'preview' && result) {
    return (
      <View style={styles.container}>
        <SourceBanner
          icon={<Camera size={12} color={Colors.goldDim} />}
          text={[
            accuracyLabel(result.confidence),
            // 裏面だけを撮ると料理名が無いのは普通。必須項目なので先に伝える
            result.draft.title ? '' : t('recipeImport.page.titleMissing'),
          ]
            .filter(Boolean)
            .join(' / ')}
        />
        <RecipeForm
          initialValues={result.draft}
          onSubmit={handleSave}
          onCancel={() => setPhase('select')}
          title={t('recipeImport.page.formTitle')}
          submitLabel={t('common.save')}
          topInset={false}
        />
        <Toast
          message={toastMessage ?? ''}
          visible={toastMessage != null}
          onDismiss={() => setToastMessage(null)}
        />
      </View>
    );
  }

  const hasPages = pages.length > 0;
  const canAddMore = pages.length < MAX_RECIPE_PAGE_IMAGES;
  const busy = phase === 'processing';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('recipeImport.page.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/*
          写真が入ったら説明を畳む。撮る前に読むものであって、
          選んだあとも占有し続けると、肝心のサムネイルと実行ボタンが下に押される
        */}
        {!hasPages && (
          <>
            <View style={styles.iconWrapper}>
              <Camera size={44} color={Colors.gold} />
            </View>
            <Text style={styles.title}>{t('recipeImport.page.heading')}</Text>
            <Text style={styles.description}>{t('recipeImport.page.lead')}</Text>
            <Text style={styles.hintText}>
              {t('recipeImport.page.multiHint', { max: MAX_RECIPE_PAGE_IMAGES })}
            </Text>
          </>
        )}

        {hasPages && (
          <View style={styles.pageGrid}>
            {pages.map((page, index) => (
              <View key={`${page.localPath}-${index}`} style={styles.pageThumbWrap}>
                <Image source={{ uri: page.localPath }} style={styles.pageThumb} />
                {/* 順番がそのまま読み取りの順になるので、番号を出す */}
                <View style={styles.pageIndex}>
                  <Text style={styles.pageIndexText}>{index + 1}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('recipeImport.page.removePage')}
                  style={styles.pageRemove}
                  onPress={() => removePage(index)}
                  hitSlop={8}
                  disabled={busy}
                >
                  <Trash2 size={13} color={Colors.bg} />
                </Pressable>
              </View>
            ))}
            {canAddMore ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('recipeImport.page.addMore')}
                style={styles.addTile}
                onPress={() => void addFromCamera()}
                disabled={busy}
              >
                <Plus size={20} color={Colors.gold} />
                <Text style={styles.addTileText}>{t('recipeImport.page.addMore')}</Text>
              </Pressable>
            ) : (
              <View style={[styles.addTile, styles.addTileFull]}>
                <Text style={styles.addTileText}>
                  {tCount('recipeImport.page.limitReached', MAX_RECIPE_PAGE_IMAGES)}
                </Text>
              </View>
            )}
          </View>
        )}

        {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

        {busy ? (
          <View style={styles.processingBox}>
            <ActivityIndicator size="large" color={Colors.gold} />
            <Text style={styles.processingText}>{t('recipeImport.page.reading')}</Text>
          </View>
        ) : (
          <View style={styles.actionGrid}>
            {hasPages ? (
              <Pressable
                accessibilityRole="button"
                style={styles.primaryButton}
                onPress={() => void handleRead()}
              >
                <Sparkles size={18} color={Colors.bg} />
                <Text style={styles.primaryButtonText}>{t('recipeImport.page.read')}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.takePhoto')}
                style={styles.primaryButton}
                onPress={() => void addFromCamera()}
              >
                <Camera size={18} color={Colors.bg} />
                <Text style={styles.primaryButtonText}>{t('common.takePhoto')}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.pickFromGallery')}
              style={[styles.secondaryButton, !canAddMore && styles.buttonDisabled]}
              onPress={() => void addFromGallery()}
              disabled={!canAddMore}
            >
              <ImageIcon size={18} color={Colors.gold} />
              <Text style={styles.secondaryButtonText}>{t('common.pickFromGallery')}</Text>
            </Pressable>
          </View>
        )}

        {/* 送信先の開示。**送る前に見えている**必要があるので実行ボタンの直下 */}
        <Text style={styles.disclosureText}>{t('recipeImport.page.disclosure')}</Text>

        <View style={styles.divider} />

        <Pressable style={styles.manualButton} onPress={handleManual} disabled={busy}>
          <PenLine size={16} color={Colors.goldDim} />
          <Text style={styles.manualButtonText}>{t('recipeImport.ocr.manualAction')}</Text>
        </Pressable>
      </ScrollView>
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
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 36,
    gap: 14,
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
  hintText: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  // 調理記録の写真グリッドと同じ寸法・同じ削除ボタンにする（アプリ内で作法を揃える）
  pageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  pageThumbWrap: {
    width: 92,
    height: 116,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#130E08',
  },
  pageThumb: {
    width: '100%',
    height: '100%',
  },
  /** 並び順がそのまま読み取りの順になるので番号を出す */
  pageIndex: {
    position: 'absolute',
    top: 5,
    left: 5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: Colors.bgOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageIndexText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.paper,
  },
  pageRemove: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: 92,
    height: 116,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addTileFull: {
    borderStyle: 'solid',
  },
  addTileText: {
    fontSize: 11,
    color: Colors.goldDim,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    color: '#F2A07B',
    textAlign: 'center',
    lineHeight: 20,
  },
  processingBox: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  processingText: {
    fontSize: 13,
    color: Colors.paperDim,
  },
  actionGrid: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.gold,
    paddingVertical: 13,
    borderRadius: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: '#130E08',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.gold,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  disclosureText: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 17,
  },
  divider: {
    width: '60%',
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 8,
  },
  // 手入力は**逃げ道**であって主役ではない。金色の大ボタンだと読み取りと競合するので控えめに
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  manualButtonText: {
    fontSize: 13,
    color: Colors.goldDim,
  },
});

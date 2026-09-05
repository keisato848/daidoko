/**
 * 相談してレシピを作る（S18）。
 *
 * 写真からレシピが**目の前に料理がある**ときの入口なのに対し、こちらは
 * **まだ料理が無い**ときの入口。話しながら下書きを育て、納得したら保存する。
 *
 * 保存は必ず既存の RecipeForm を通す。**AI が書いたものをそのまま保存しない**
 * のは、写真レシピ・感想調整と同じ約束（docs/フリーミアム設計.md）。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, ImagePlus, RotateCcw, Send, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { expoImagePickerPhotoCaptureAdapter } from '../../../src/services/expo-photo-capture.adapter';
import {
  capturePhotoSeries,
  confirmContinueCapture,
  type CapturedPhoto,
  type PhotoCaptureSource,
} from '../../../src/services/photo-capture.service';
import { MAX_CONSULT_IMAGES_PER_MESSAGE } from '../../../src/services/recipe-consult.provider';
import { GroupMultiChips } from '../../../src/components/GroupMultiChips';
import { KeyboardAvoider } from '../../../src/components/KeyboardAvoider';
import { RecipeForm } from '../../../src/components/RecipeForm';
import { Colors } from '../../../src/constants/theme';
import { t } from '../../../src/i18n';
import {
  getInStockNormalizedNames,
  getPantryGroups,
  UNGROUPED,
} from '../../../src/services/pantry.service';
import {
  ConsultError,
  consultRecipe,
  type ConsultMessage,
} from '../../../src/services/recipe-consult.provider';
import { dialog } from '../../../src/services/dialog.service';
import { createRecipe } from '../../../src/services/recipe.service';
import { maybeRequestStoreReview } from '../../../src/services/review-request.service';
import { ensureInferenceCredit } from '../../../src/services/inference-gate.service';
import { recordCloudInference } from '../../../src/services/usage.service';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'chat' | 'confirm';

/** AI 側の発言。 */
function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.assistantRow}>
      <View style={[styles.bubble, styles.bubbleAssistant]}>{children}</View>
    </View>
  );
}

export default function ConsultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ seed?: string }>();
  const [phase, setPhase] = useState<Phase>('chat');
  const [messages, setMessages] = useState<ConsultMessage[]>([]);
  const [input, setInput] = useState(params.seed ?? '');
  const [draft, setDraft] = useState<RecipeFormData | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usePantry, setUsePantry] = useState(false);
  /** 次の発言に添える写真（端末内パス）。送ったら空に戻す */
  const [pendingPhotos, setPendingPhotos] = useState<CapturedPhoto[]>([]);
  const [pantryGroups, setPantryGroups] = useState<string[]>([]);
  /** 送る置き場所。**空 = すべて**（置き場所を使っていない人は何も選ばずに済む） */
  const [pantryGroupFilter, setPantryGroupFilter] = useState<string[]>([]);

  // 在庫を送るときだけグループを出す。切ってあるうちは在庫に触らない
  useEffect(() => {
    if (!usePantry) return;
    let mounted = true;
    getPantryGroups()
      .then((names) => {
        if (mounted) setPantryGroups(names);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [usePantry]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // 会話が伸びたら最新へ寄せる
  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages, busy]);

  const addPhoto = useCallback(
    async (source: PhotoCaptureSource) => {
      setErrorMsg(null);
      try {
        // 連続撮影/複数選択: 1 メッセージの残り枠（最大 2 枚）まで続けて取り込める
        const shot = await capturePhotoSeries(source, expoImagePickerPhotoCaptureAdapter, {
          maxCount: MAX_CONSULT_IMAGES_PER_MESSAGE - pendingPhotos.length,
          confirmMore: confirmContinueCapture,
        });
        if (shot.length === 0) return; // キャンセル
        setPendingPhotos((current) =>
          [...current, ...shot].slice(0, MAX_CONSULT_IMAGES_PER_MESSAGE),
        );
      } catch {
        setErrorMsg(t('common.photoAddFailed'));
      }
    },
    [pendingPhotos.length],
  );

  const removePhoto = useCallback((index: number) => {
    setPendingPhotos((current) => current.filter((_, i) => i !== index));
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    // 枠切れなら、その場で広告視聴を持ちかけてそのまま続行する（2026-08-12）。
    // ペイウォールは広告を出せないとき（視聴上限・no-fill）の逃げ道
    const gate = await ensureInferenceCredit();
    if (gate === 'paywall') {
      router.push('/recipes/paywall');
      return;
    }
    if (gate !== 'ready') return;

    const photos = pendingPhotos;
    const next: ConsultMessage[] = [
      ...messages,
      photos.length > 0
        ? { role: 'user', text, imageUris: photos.map((photo) => photo.localPath) }
        : { role: 'user', text },
    ];
    setMessages(next);
    setInput('');
    setPendingPhotos([]);
    setErrorMsg(null);
    setBusy(true);
    try {
      const pantry = usePantry
        ? await getInStockNormalizedNames(
            pantryGroupFilter.length > 0 ? pantryGroupFilter : undefined,
          ).catch(() => [])
        : undefined;
      const turn = await consultRecipe({
        messages: next,
        draft,
        ...(pantry && pantry.length > 0 ? { pantry } : {}),
      });
      setMessages([...next, { role: 'assistant', text: turn.reply }]);
      if (turn.draft) setDraft(turn.draft);
      setReady(turn.ready);
      // 成功した往復だけ枠を消費する（写真レシピと同じ数え方）
      void recordCloudInference().catch(() => undefined);
    } catch (err) {
      // 失敗した発言は入力欄に戻す。打ち直させない
      setMessages(messages);
      setInput(text);
      setPendingPhotos(photos);
      setErrorMsg(err instanceof ConsultError ? err.message : t('error.photoRecipeFailed'));
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages, draft, usePantry, pantryGroupFilter, pendingPhotos, router]);

  const handleRestart = async () => {
    const confirmed = await dialog.confirm({
      title: t('recipeImport.consult.restart'),
      message: t('recipeImport.consult.restartConfirm'),
      confirmLabel: t('recipeImport.consult.restart'),
      destructive: true,
    });
    if (!confirmed) return;
    setMessages([]);
    setDraft(null);
    setReady(false);
    setErrorMsg(null);
  };

  const handleSave = async (data: RecipeFormData) => {
    // 会話から AI が全文を書いた下書き（#266）。**ここが最大の無印地帯だった** —
    // 出所行も作らないので、印を立てないと AI 由来だと後から一切分からない
    const recipeId = await createRecipe({ ...data, aiGenerated: true });
    // 相談から AI の下書きが形になった瞬間にストア評価を打診（条件・頻度はサービス側）
    void maybeRequestStoreReview('ai-recipe');
    router.replace(`/(tabs)/recipes/${recipeId}`);
  };

  if (phase === 'confirm' && draft) {
    return (
      <View style={styles.container}>
        <RecipeForm
          initialValues={draft}
          onSubmit={handleSave}
          onCancel={() => setPhase('chat')}
          submitLabel={t('common.save')}
          title={t('recipeImport.consult.confirmTitle')}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoider style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.headerButton}>
          <ChevronLeft size={24} color={Colors.gold} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('recipeImport.consult.title')}</Text>
        <Pressable
          onPress={() => void handleRestart()}
          hitSlop={8}
          style={styles.headerButton}
          disabled={messages.length === 0}
        >
          <RotateCcw size={20} color={messages.length === 0 ? Colors.muted : Colors.gold} />
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && (
          <View style={styles.intro}>
            <Text style={styles.introHeading}>{t('recipeImport.consult.heading')}</Text>
            <Text style={styles.introLead}>{t('recipeImport.consult.lead')}</Text>
          </View>
        )}

        {messages.length === 0 ? (
          <AssistantRow>
            <Text style={styles.bubbleText}>{t('recipeImport.consult.firstMessage')}</Text>
          </AssistantRow>
        ) : null}

        {messages.map((message, index) =>
          message.role === 'user' ? (
            <View key={`${index}-user`} style={[styles.bubble, styles.bubbleUser]}>
              <Text style={styles.bubbleTextUser}>{message.text}</Text>
            </View>
          ) : (
            <AssistantRow key={`${index}-assistant`}>
              <Text style={styles.bubbleText}>{message.text}</Text>
            </AssistantRow>
          ),
        )}

        {busy && (
          <AssistantRow>
            <View style={styles.thinking}>
              <ActivityIndicator size="small" color={Colors.gold} />
              <Text style={styles.thinkingText}>{t('recipeImport.consult.thinking')}</Text>
            </View>
          </AssistantRow>
        )}

        {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

        {draft && (
          <Pressable style={styles.draftCard} onPress={() => setPhase('confirm')}>
            <Text style={styles.draftLabel}>
              {ready
                ? t('recipeImport.consult.draftReady')
                : t('recipeImport.consult.draftInProgress')}
            </Text>
            <Text style={styles.draftTitle}>{draft.title}</Text>
            <Text style={styles.draftAction}>{t('recipeImport.consult.openDraft')}</Text>
          </Pressable>
        )}

        <Text style={styles.disclaimer}>{t('recipeImport.consult.disclaimer')}</Text>
        {draft && (
          // AI 生成コンテンツの報告導線（docs/レシピ表紙AI生成設計.md §6 —
          // Play ポリシー「アプリを出ずに報告できること」を満たす）
          <Pressable
            onPress={() =>
              router.push({ pathname: '/recipes/report', params: { source: 'consult' } })
            }
            hitSlop={8}
          >
            <Text style={styles.reportLink}>{t('coverImage.report')}</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.pantryRow}>
        <View style={styles.pantryLabels}>
          <Text style={styles.pantryLabel}>{t('recipeImport.consult.usePantry')}</Text>
          <Text style={styles.pantrySubtitle}>
            {usePantry
              ? t('recipeImport.consult.usePantryOn')
              : t('recipeImport.consult.usePantryOff')}
          </Text>
        </View>
        <Switch
          value={usePantry}
          onValueChange={setUsePantry}
          trackColor={{ false: Colors.bgInput, true: Colors.gold }}
          thumbColor={Colors.paper}
        />
      </View>

      {usePantry && (
        <GroupMultiChips
          groups={pantryGroups}
          selected={pantryGroupFilter}
          onToggle={(group) =>
            setPantryGroupFilter((prev) =>
              prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group],
            )
          }
          ungroupedLabel={t('pantry.group.ungrouped')}
          ungroupedValue={UNGROUPED}
        />
      )}

      {pendingPhotos.length > 0 && (
        <View style={styles.pendingRow}>
          {pendingPhotos.map((photo, index) => (
            <View key={`${photo.localPath}-${index}`} style={styles.pendingThumbWrap}>
              <Image source={{ uri: photo.localPath }} style={styles.pendingThumb} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('recipeImport.consult.removePhoto')}
                style={styles.pendingRemove}
                onPress={() => removePhoto(index)}
                hitSlop={8}
                disabled={busy}
              >
                <X size={12} color={Colors.bg} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* 送信先の開示。**写真の有無によらず常に出す** — 文字だけの相談でも、
          会話・作りかけの下書き・（在庫を考慮するときは）材料名を毎回送っている */}
      <Text style={styles.disclosureText}>{t('recipeImport.consult.disclosure')}</Text>

      <View style={styles.composer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('recipeImport.consult.attachPhoto')}
          style={[
            styles.attachButton,
            (busy || pendingPhotos.length >= MAX_CONSULT_IMAGES_PER_MESSAGE) &&
              styles.attachButtonDisabled,
          ]}
          onPress={() => void addPhoto('camera')}
          onLongPress={() => void addPhoto('gallery')}
          disabled={busy || pendingPhotos.length >= MAX_CONSULT_IMAGES_PER_MESSAGE}
        >
          <ImagePlus size={19} color={Colors.gold} />
        </Pressable>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={t('recipeImport.consult.placeholder')}
          placeholderTextColor={Colors.muted}
          multiline
          editable={!busy}
          /* サーバー契約は 1 発言 ≤2000 字（inferConsultSchema）。超えて送ると 400 で
             発言ごと弾かれるので、入力の時点で契約に収める（P4） */
          maxLength={2000}
        />
        <Pressable
          style={[styles.sendButton, (!input.trim() || busy) && styles.sendButtonDisabled]}
          onPress={send}
          disabled={!input.trim() || busy}
          accessibilityLabel={t('recipeImport.consult.send')}
        >
          <Send size={20} color={Colors.bg} />
        </Pressable>
      </View>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    // ステータスバーに重ならないよう、import-photo と同じ余白を取る
    paddingTop: 54,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerButton: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.paper },
  thread: { padding: 16, gap: 12, paddingBottom: 24 },
  intro: { marginBottom: 4, alignItems: 'center' },
  assistantRow: { flexDirection: 'row', alignItems: 'flex-end', maxWidth: '88%' },
  introHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.paper,
    marginBottom: 6,
    textAlign: 'center',
  },
  introLead: { fontSize: 14, lineHeight: 21, color: Colors.paperDim, textAlign: 'center' },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: Colors.bgInput, flexShrink: 1 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: Colors.gold },
  bubbleText: { fontSize: 15, lineHeight: 22, color: Colors.paper },
  bubbleTextUser: { fontSize: 15, lineHeight: 22, color: Colors.bg },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText: { fontSize: 14, color: Colors.paperDim },
  error: { fontSize: 14, color: Colors.goldDim, textAlign: 'center', marginTop: 4 },
  draftCard: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  draftLabel: { fontSize: 12, color: Colors.gold, letterSpacing: 0.5 },
  draftTitle: { fontSize: 17, fontWeight: '600', color: Colors.paper },
  draftAction: { fontSize: 14, color: Colors.gold, marginTop: 4 },
  disclaimer: { fontSize: 12, lineHeight: 18, color: Colors.muted, marginTop: 8 },
  reportLink: {
    fontSize: 12,
    color: Colors.muted,
    textDecorationLine: 'underline',
    marginTop: 6,
  },
  pantryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  pantryLabels: { flex: 1, paddingRight: 12 },
  pantryLabel: { fontSize: 15, color: Colors.paper },
  pantrySubtitle: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  // 添えた写真は composer のすぐ上に置く。**送る前に見えている**ことが要る
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  pendingThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pendingThumb: {
    width: '100%',
    height: '100%',
  },
  pendingRemove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 開示は読めて初めて開示になる。import-photo の disclosureText と同じ色・大きさ
  disclosureText: {
    fontSize: 12,
    lineHeight: 17,
    color: Colors.paperDim,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  attachButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButtonDisabled: {
    opacity: 0.4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    backgroundColor: Colors.bgInput,
    color: Colors.paper,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
});

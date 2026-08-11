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
import { ChevronLeft, RotateCcw, Send } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { RecipeForm } from '../../../src/components/RecipeForm';
import { Colors } from '../../../src/constants/theme';
import { t } from '../../../src/i18n';
import { getInStockNormalizedNames } from '../../../src/services/pantry.service';
import {
  ConsultError,
  consultRecipe,
  type ConsultMessage,
} from '../../../src/services/recipe-consult.provider';
import { createRecipe } from '../../../src/services/recipe.service';
import { getFreemiumStatus, recordCloudInference } from '../../../src/services/usage.service';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'chat' | 'confirm';

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // 会話が伸びたら最新へ寄せる
  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [messages, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    // 上限に達しているならペイウォールへ（写真レシピと同じ扱い）
    const status = await getFreemiumStatus().catch(() => null);
    if (status && !status.canInfer) {
      router.push('/recipes/paywall');
      return;
    }

    const next: ConsultMessage[] = [...messages, { role: 'user', text }];
    setMessages(next);
    setInput('');
    setErrorMsg(null);
    setBusy(true);
    try {
      const pantry = usePantry ? await getInStockNormalizedNames().catch(() => []) : undefined;
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
      setErrorMsg(err instanceof ConsultError ? err.message : t('error.photoRecipeFailed'));
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages, draft, usePantry, router]);

  const handleRestart = () => {
    Alert.alert(t('recipeImport.consult.restart'), t('recipeImport.consult.restartConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('recipeImport.consult.restart'),
        style: 'destructive',
        onPress: () => {
          setMessages([]);
          setDraft(null);
          setReady(false);
          setErrorMsg(null);
        },
      },
    ]);
  };

  const handleSave = async (data: RecipeFormData) => {
    const recipeId = await createRecipe(data);
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.headerButton}>
          <ChevronLeft size={24} color={Colors.gold} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('recipeImport.consult.title')}</Text>
        <Pressable
          onPress={handleRestart}
          hitSlop={8}
          style={styles.headerButton}
          disabled={messages.length === 0}
        >
          <RotateCcw size={20} color={messages.length === 0 ? Colors.muted : Colors.gold} />
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.thread}>
        {messages.length === 0 && (
          <View style={styles.intro}>
            <Text style={styles.introHeading}>{t('recipeImport.consult.heading')}</Text>
            <Text style={styles.introLead}>{t('recipeImport.consult.lead')}</Text>
          </View>
        )}

        {messages.length === 0 ? (
          <View style={[styles.bubble, styles.bubbleAssistant]}>
            <Text style={styles.bubbleText}>{t('recipeImport.consult.firstMessage')}</Text>
          </View>
        ) : null}

        {messages.map((message, index) => (
          <View
            key={`${index}-${message.role}`}
            style={[
              styles.bubble,
              message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            <Text style={message.role === 'user' ? styles.bubbleTextUser : styles.bubbleText}>
              {message.text}
            </Text>
          </View>
        ))}

        {busy && (
          <View style={[styles.bubble, styles.bubbleAssistant, styles.thinking]}>
            <ActivityIndicator size="small" color={Colors.gold} />
            <Text style={styles.thinkingText}>{t('recipeImport.consult.thinking')}</Text>
          </View>
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

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={t('recipeImport.consult.placeholder')}
          placeholderTextColor={Colors.muted}
          multiline
          editable={!busy}
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
    </KeyboardAvoidingView>
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
  intro: { marginBottom: 4 },
  introHeading: { fontSize: 20, fontWeight: '700', color: Colors.paper, marginBottom: 6 },
  introLead: { fontSize: 14, lineHeight: 21, color: Colors.paperDim },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: Colors.bgInput },
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

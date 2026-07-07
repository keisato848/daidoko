/**
 * S09: URL Import screen
 * Two phases: (1) URL input → fetch, (2) preview / edit with RecipeForm
 */
import { useRouter } from 'expo-router';
import { Globe, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { RecipeForm } from '../../../src/components/RecipeForm';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { type RecipeDraft, runImportAgent } from '../../../src/agents/import.agent';
import { createRecipe } from '../../../src/services/recipe.service';
import { applyAutoStepTimers } from '../../../src/utils/stepTimer';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'input' | 'fetching' | 'preview';

function draftToFormData(draft: RecipeDraft): RecipeFormData {
  return {
    title: draft.title,
    titleReading: '',
    description: draft.description ?? '',
    servings: draft.servings,
    cookTimeMin: draft.cookTimeMin,
    prepTimeMin: draft.prepTimeMin,
    ingredients: draft.ingredients.map((i) => ({
      name: i.name,
      amount: i.amount ?? '',
      groupLabel: '',
      note: '',
    })),
    // 「10分煮る」等の時間表現からタイマーを自動セット（フォームで修正可能）
    steps: applyAutoStepTimers(draft.steps.map((s) => ({ body: s.body, timerSec: undefined }))),
    tags: [],
  };
}

export default function ImportUrlScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('input');
  const [url, setUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [showToast, setShowToast] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleFetch = useCallback(async () => {
    setErrorMsg(null);
    setPhase('fetching');

    const controller = new AbortController();
    abortRef.current = controller;

    const result = await runImportAgent(url, controller.signal);

    if (result.ok && result.data) {
      setDraft(result.data);
      setPhase('preview');
    } else {
      setErrorMsg(result.error?.message ?? '取り込みに失敗しました');
      setPhase('input');
    }
    abortRef.current = null;
  }, [url]);

  const handleCancel = () => {
    abortRef.current?.abort();
    router.back();
  };

  const handleSave = useCallback(
    async (data: RecipeFormData) => {
      await createRecipe(data);
      setShowToast(true);
      setTimeout(() => router.push('/(tabs)/recipes'), 1500);
    },
    [router],
  );

  // ── Phase: input ────────────────────────────────────────────────────────────
  if (phase === 'input' || phase === 'fetching') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={handleCancel} hitSlop={12}>
            <X size={20} color={Colors.muted} />
          </Pressable>
          <Text style={styles.headerTitle}>URLから取り込み</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>レシピページのURLを貼り付けてください</Text>
          <View style={styles.inputRow}>
            <Globe size={16} color={Colors.muted} />
            <TextInput
              style={styles.urlInput}
              value={url}
              onChangeText={(v) => {
                setUrl(v);
                setErrorMsg(null);
              }}
              placeholder="https://example.com/recipe/..."
              placeholderTextColor={Colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleFetch}
              editable={phase !== 'fetching'}
            />
          </View>
          {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

          <Text style={styles.supportedNote}>
            対応サイト: クラシル・デリッシュキッチン・Nadia など JSON-LD 対応のレシピサイト
          </Text>
        </View>

        {phase === 'fetching' ? (
          <View style={styles.loadingArea}>
            <ActivityIndicator size="large" color={Colors.gold} />
            <Text style={styles.loadingText}>レシピを取り込んでいます...</Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <Pressable
              style={[styles.fetchButton, !url.trim() && styles.fetchButtonDisabled]}
              onPress={handleFetch}
              disabled={!url.trim()}
            >
              <Text style={styles.fetchButtonText}>取り込む</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  // ── Phase: preview ──────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {draft?.sourceName && (
        <View style={styles.sourceBanner}>
          <Globe size={12} color={Colors.goldDim} />
          <Text style={styles.sourceName}>取り込み元: {draft.sourceName}</Text>
        </View>
      )}
      <RecipeForm
        initialValues={draft ? draftToFormData(draft) : undefined}
        onSubmit={handleSave}
        onCancel={() => setPhase('input')}
        title="レシピを確認・編集"
        submitLabel="保存"
      />
      <Toast
        message="レシピを保存しました！"
        visible={showToast}
        onDismiss={() => setShowToast(false)}
      />
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
  inputSection: {
    padding: 24,
    gap: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  urlInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paper,
    padding: 0,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#FF6B6B',
  },
  supportedNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.muted,
    lineHeight: 18,
  },
  loadingArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  actions: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  fetchButton: {
    backgroundColor: Colors.gold,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  fetchButtonDisabled: {
    opacity: 0.4,
  },
  fetchButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
    letterSpacing: 1,
  },
  sourceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#1C1409',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sourceName: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.goldDim,
  },
});

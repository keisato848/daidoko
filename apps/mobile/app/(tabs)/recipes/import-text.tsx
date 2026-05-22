/**
 * Freeform text import screen
 * Paste recipe text, parse locally, then confirm/edit with RecipeForm.
 */
import { useRouter } from 'expo-router';
import { ClipboardCopy, FileText, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Clipboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { RecipeForm } from '../../../src/components/RecipeForm';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { createRecipe } from '../../../src/services/recipe.service';
import {
  RECIPE_TEXT_AI_PROMPT,
  type ParsedRecipeText,
} from '../../../src/utils/recipeTextParser';
import { parseRecipeTextWithAssistance } from '../../../src/utils/recipeTextNormalizer';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'input' | 'preview';

const SAMPLE_PLACEHOLDER = `肉じゃが
4人分
材料
じゃがいも 3個
玉ねぎ 1個
牛こま肉 200g
作り方
1. 材料を切る
2. 肉を炒めて野菜を加える
3. 煮汁を入れて煮込む`;

const CONFIDENCE_LABEL: Record<ParsedRecipeText['confidence'], string> = {
  high: '解析できました',
  medium: '一部を確認してください',
  low: '入力を補ってください',
};

const NORMALIZED_LABEL: Record<ParsedRecipeText['normalizedBy'], string> = {
  parser: '',
  'gemma-native': '端末内AIで補正しました',
  'local-heuristic': '補正して解析しました',
};

export default function ImportTextScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('input');
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedRecipeText | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  const handleParse = useCallback(async () => {
    setIsParsing(true);
    try {
      const result = await parseRecipeTextWithAssistance(rawText);
      setParsed(result);
      setPhase('preview');
    } finally {
      setIsParsing(false);
    }
  }, [rawText]);

  const handleCopyPrompt = useCallback(() => {
    Clipboard.setString(RECIPE_TEXT_AI_PROMPT);
    showToast('AI用指示をコピーしました');
  }, [showToast]);

  const handleSave = useCallback(
    async (data: RecipeFormData) => {
      await createRecipe(data);
      showToast('レシピを保存しました');
      setTimeout(() => router.replace('/(tabs)/recipes'), 1500);
    },
    [router, showToast],
  );

  if (phase === 'preview') {
    return (
      <View style={styles.container}>
        {parsed && (
          <View style={styles.sourceBanner}>
            <FileText size={12} color={Colors.goldDim} />
            <Text style={styles.sourceName}>
              {[CONFIDENCE_LABEL[parsed.confidence], NORMALIZED_LABEL[parsed.normalizedBy]]
                .filter(Boolean)
                .join(' / ')}
            </Text>
          </View>
        )}
        <RecipeForm
          initialValues={parsed?.formData}
          onSubmit={handleSave}
          onCancel={() => setPhase('input')}
          title="レシピを確認・編集"
          submitLabel="保存"
        />
        <Toast
          message={toastMessage ?? ''}
          visible={toastMessage != null}
          onDismiss={() => setToastMessage(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>テキストから作成</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrapper}>
          <FileText size={32} color={Colors.gold} />
        </View>
        <Text style={styles.title}>レシピ本文を貼り付け</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="AI用指示をコピー"
          style={styles.copyButton}
          onPress={handleCopyPrompt}
        >
          <ClipboardCopy size={16} color={Colors.gold} />
          <Text style={styles.copyButtonText}>AI用指示をコピー</Text>
        </Pressable>
        <TextInput
          style={styles.textInput}
          value={rawText}
          onChangeText={setRawText}
          placeholder={SAMPLE_PLACEHOLDER}
          placeholderTextColor={Colors.muted}
          multiline
          textAlignVertical="top"
          autoCorrect={false}
        />

        <Pressable
          style={[styles.parseButton, !rawText.trim() && styles.parseButtonDisabled]}
          onPress={handleParse}
          disabled={!rawText.trim() || isParsing}
        >
          <Text style={styles.parseButtonText}>{isParsing ? '解析中...' : '解析して確認'}</Text>
        </Pressable>
      </ScrollView>
      <Toast
        message={toastMessage ?? ''}
        visible={toastMessage != null}
        onDismiss={() => setToastMessage(null)}
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
  content: {
    padding: 24,
    gap: 16,
  },
  iconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.paper,
  },
  copyButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 8,
    backgroundColor: Colors.bgCard,
    paddingHorizontal: 14,
  },
  copyButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.gold,
  },
  textInput: {
    minHeight: 300,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.bgInput,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
    lineHeight: 22,
  },
  parseButton: {
    backgroundColor: Colors.gold,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  parseButtonDisabled: {
    opacity: 0.4,
  },
  parseButtonText: {
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

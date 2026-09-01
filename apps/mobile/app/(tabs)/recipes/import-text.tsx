/**
 * Freeform text import screen
 * Paste recipe text, parse locally, then confirm/edit with RecipeForm.
 */
import { useRouter } from 'expo-router';
import { ClipboardCopy, FileText, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Clipboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { RecipeForm } from '../../../src/components/RecipeForm';
import { SourceBanner } from '../../../src/components/SourceBanner';
import { Toast } from '../../../src/components/Toast';
import { KeyboardAwareScroll } from '../../../src/components/KeyboardAwareScroll';
import { Colors } from '../../../src/constants/theme';
import { t } from '../../../src/i18n';
import { createRecipe } from '../../../src/services/recipe.service';
import { RECIPE_TEXT_AI_PROMPT, type ParsedRecipeText } from '../../../src/utils/recipeTextParser';
import { parseRecipeTextWithAssistance } from '../../../src/utils/recipeTextNormalizer';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'input' | 'preview';

function confidenceLabel(confidence: ParsedRecipeText['confidence']): string {
  if (confidence === 'high') return t('recipeImport.text.confidence.high');
  if (confidence === 'medium') return t('recipeImport.text.confidence.medium');
  return t('recipeImport.text.confidence.low');
}

function normalizedLabel(normalizedBy: ParsedRecipeText['normalizedBy']): string {
  if (normalizedBy === 'gemma-native') return t('recipeImport.text.normalized.gemmaNative');
  if (normalizedBy === 'local-heuristic') return t('recipeImport.text.normalized.localHeuristic');
  return '';
}

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
    showToast(t('recipeImport.text.copied'));
  }, [showToast]);

  const handleSave = useCallback(
    async (data: RecipeFormData) => {
      // **同じ画面でも、AI を通る回と通らない回がある**（#266）。
      // 既定は正規表現パーサ（`parser` / `local-heuristic`）で、これは生成ではない。
      // 画面単位で固定値にすると、パーサで作った回にも AI の印が付いて誤表示になる
      await createRecipe({ ...data, aiGenerated: parsed?.normalizedBy === 'gemma-native' });
      showToast(t('recipeImport.saved'));
      setTimeout(() => router.replace('/(tabs)/recipes'), 1500);
    },
    [parsed, router, showToast],
  );

  if (phase === 'preview') {
    return (
      <View style={styles.container}>
        {parsed && (
          <SourceBanner
            icon={<FileText size={12} color={Colors.goldDim} />}
            text={[confidenceLabel(parsed.confidence), normalizedLabel(parsed.normalizedBy)]
              .filter(Boolean)
              .join(' / ')}
          />
        )}
        <RecipeForm
          topInset={false}
          initialValues={parsed?.formData}
          onSubmit={handleSave}
          onCancel={() => setPhase('input')}
          title={t('recipeImport.formTitle')}
          submitLabel={t('common.save')}
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
        <Text style={styles.headerTitle}>{t('recipeImport.text.title')}</Text>
        {/* 本文の入力欄は画面の大半を占めるので、下にボタンを置くと
            フォーカス時にキーボードで隠れる（KeyboardAwareScroll の余白では足りない）。
            ヘッダーならキーボードの高さに関係なく必ず押せる（RecipeForm の保存と同じ形）。 */}
        <Pressable
          accessibilityRole="button"
          style={[styles.headerAction, !rawText.trim() && styles.headerActionDisabled]}
          onPress={handleParse}
          disabled={!rawText.trim() || isParsing}
        >
          <Text style={styles.headerActionText}>
            {isParsing ? t('recipeImport.text.parsing') : t('recipeImport.text.parse')}
          </Text>
        </Pressable>
      </View>

      <KeyboardAwareScroll
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.iconWrapper}>
          <FileText size={32} color={Colors.gold} />
        </View>
        <Text style={styles.title}>{t('recipeImport.text.heading')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('recipeImport.text.copyPrompt')}
          style={styles.copyButton}
          onPress={handleCopyPrompt}
        >
          <ClipboardCopy size={16} color={Colors.gold} />
          <Text style={styles.copyButtonText}>{t('recipeImport.text.copyPrompt')}</Text>
        </Pressable>
        <TextInput
          style={styles.textInput}
          value={rawText}
          onChangeText={setRawText}
          placeholder={t('recipeImport.text.samplePlaceholder')}
          placeholderTextColor={Colors.muted}
          multiline
          textAlignVertical="top"
          autoCorrect={false}
        />
      </KeyboardAwareScroll>
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
  // ヘッダーの主要アクション。RecipeForm の保存ボタンと見た目を揃える
  headerAction: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.gold,
    borderRadius: 8,
  },
  headerActionDisabled: {
    opacity: 0.5,
  },
  headerActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.bg,
    letterSpacing: 1,
  },
});

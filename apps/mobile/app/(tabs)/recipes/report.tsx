/**
 * AI 生成コンテンツの報告（docs/レシピ表紙AI生成設計.md §6）。
 *
 * Play の AI 生成コンテンツポリシー（"without needing to exit the app"）を満たすための
 * アプリ内フォーム。mailto は使わない。入口は 3 箇所（cover-image プレビューシート・
 * 相談・写真レシピの結果部）から `?source=` 付きで開く — どの画面からかはログの手がかり。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '../../../src/components/FormField';
import { KeyboardAwareScroll } from '../../../src/components/KeyboardAwareScroll';
import { Colors } from '../../../src/constants/theme';
import { t } from '../../../src/i18n';
import { dialog } from '../../../src/services/dialog.service';
import { reportContent, type ReportCategory } from '../../../src/services/report.service';

const CATEGORIES: { value: ReportCategory; label: () => string }[] = [
  { value: 'inappropriate', label: () => t('report.categoryInappropriate') },
  { value: 'inaccurate', label: () => t('report.categoryInaccurate') },
  { value: 'other', label: () => t('report.categoryOther') },
];

export default function ReportContentScreen() {
  const router = useRouter();
  const { source } = useLocalSearchParams<{ source?: string }>();
  const [category, setCategory] = useState<ReportCategory>('inappropriate');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const ok = await reportContent({ category, text, source: source ?? 'unknown' });
      if (ok) {
        await dialog.alert({ title: t('report.sentTitle'), message: t('report.sentBody') });
        router.back();
      } else {
        await dialog.alert({ title: t('report.failedTitle'), message: t('report.failedBody') });
      }
    } finally {
      setSubmitting(false);
    }
  }, [category, text, source, router]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel={t('common.close')}
        >
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('report.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScroll contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>{t('report.lead')}</Text>

        <Text style={styles.label}>{t('report.categoryLabel')}</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => {
            const selected = category === c.value;
            return (
              <Pressable
                key={c.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.categoryChip, selected && styles.categoryChipActive]}
                onPress={() => setCategory(c.value)}
              >
                <Text style={[styles.categoryText, selected && styles.categoryTextActive]}>
                  {c.label()}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FormField
          label={t('report.textLabel')}
          value={text}
          onChangeText={setText}
          placeholder={t('report.textPlaceholder')}
          multiline
          maxLength={500}
          style={styles.multilineInput}
        />

        <Pressable
          accessibilityRole="button"
          style={[styles.submitButton, submitting && styles.disabled]}
          onPress={() => void handleSubmit()}
          disabled={submitting}
        >
          <Text style={styles.submitText}>
            {submitting ? t('report.submitting') : t('report.submit')}
          </Text>
        </Pressable>
      </KeyboardAwareScroll>
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
  body: { paddingHorizontal: 24, paddingVertical: 28, gap: 14 },
  lead: { fontSize: 13, color: Colors.paperDim, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '500', color: Colors.paperDim, marginTop: 4 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgInput,
  },
  categoryChipActive: { borderColor: Colors.gold, backgroundColor: '#241A0D' },
  categoryText: { fontSize: 13, color: Colors.paperDim },
  categoryTextActive: { color: Colors.gold, fontWeight: '600' },
  multilineInput: { minHeight: 90, textAlignVertical: 'top' },
  submitButton: {
    backgroundColor: Colors.gold,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  submitText: { fontSize: 15, fontWeight: '600', color: Colors.bg },
  disabled: { opacity: 0.55 },
});

/**
 * 枠に入れる料理を選ぶシート（S20・Track C PR-4）。
 *
 * **AI は呼ばない。** 蔵書庫から選ぶだけの即時・¥0・オフライン可の操作
 * （献立の「差し替え」と同じ性格）。埋まっている枠には「外す」を出す。
 */
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { BottomSheet } from './BottomSheet';
import { KeyboardAvoider } from './KeyboardAvoider';
import { Colors } from '../constants/theme';
import { t } from '../i18n';
import { recipeMatchesQuery } from '../utils/recipeSearch';

export interface SlotPickCandidate {
  id: string;
  title: string;
  titleReading?: string | null;
}

export function MenuSlotPickSheet({
  visible,
  slotLabel,
  recipes,
  canClear,
  onCancel,
  onPick,
  onClear,
}: {
  visible: boolean;
  /** 「副菜に入れる」の副菜。どの枠を編集しているか分からなくなるので必ず出す */
  slotLabel: string;
  recipes: readonly SlotPickCandidate[];
  /** 既に料理が入っている枠でだけ「外す」を出す */
  canClear: boolean;
  onCancel: () => void;
  onPick: (recipe: SlotPickCandidate) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');

  // 開くたびに検索語を捨てる。残すと、別の枠を開いたのに前回の絞り込みのままで
  // 「レシピが数件しか無い」ように見える
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  // 蔵書が増えると選べないので絞り込みを付ける。既存の検索と同じ正規化を使う
  // （ひらがな・カタカナ・全角半角の揺れを画面ごとに書き分けない）
  const shown = useMemo(() => {
    const q = query.trim();
    if (!q) return recipes;
    return recipes.filter((r) =>
      recipeMatchesQuery(
        { title: r.title, titleReading: r.titleReading ?? null, tags: [], ingredientNames: [] },
        q,
      ),
    );
  }, [query, recipes]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      title={t('menu.slotPick.title', { slot: slotLabel })}
    >
      {/* 検索欄にフォーカスすると、包まないと一覧と「空にする」がキーボードに隠れる
        （この構成では adjustResize が効かない — `keyboard-covers-buttons` の教訓）。
        `app/` 配下しか見ない横断テスト（#172）はこのシートを拾わないので手で包む */}
      <KeyboardAvoider>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t('menu.slotPick.searchPlaceholder')}
          placeholderTextColor={Colors.muted}
          accessibilityLabel={t('menu.slotPick.searchPlaceholder')}
        />

        {shown.length === 0 ? (
          <Text style={styles.empty}>{t('menu.slotPick.noMatch')}</Text>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(item) => item.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => onPick(item)}
                accessibilityRole="button"
                accessibilityLabel={item.title}
              >
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </Pressable>
            )}
          />
        )}

        {canClear ? (
          <Pressable style={styles.clear} onPress={onClear} accessibilityRole="button">
            <Text style={styles.clearText}>{t('menu.slotPick.clear')}</Text>
          </Pressable>
        ) : null}
      </KeyboardAvoider>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.paper,
    backgroundColor: Colors.bgInput,
    marginBottom: 8,
  },
  list: { maxHeight: 320 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowTitle: { fontSize: 16, color: Colors.paper },
  empty: { fontSize: 14, color: Colors.muted, paddingVertical: 20, textAlign: 'center' },
  clear: { paddingVertical: 14, alignItems: 'center' },
  clearText: { fontSize: 15, color: Colors.danger },
});

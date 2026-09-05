/**
 * 一括生成レシピの提案レビューシート（M3-1・`docs/買い物リスト・在庫設計.md` §10.12）。
 *
 * **提案であって自動確定にしない。** 1 品ずつ採用/却下をトグルでき、既定は全採用 —
 * 時短派は「この◯品で確定」ワンタップ、確認派は外してから確定（美咲・律子・健太の両立）。
 * 保存・献立への組み込みは呼び出し側（menu.tsx）がやる — ここは選ばせて返すだけ。
 */
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from './BottomSheet';
import { Colors, Typography } from '../constants/theme';
import { t, tCount } from '../i18n';
import type { MenuRecipeDraft } from '../services/menu-recipes.provider';

interface Props {
  visible: boolean;
  drafts: readonly MenuRecipeDraft[];
  /** 保存中。確定ボタンを二度押しさせない */
  busy: boolean;
  onCancel: () => void;
  onConfirm: (selected: MenuRecipeDraft[]) => void;
}

export function MenuRecipeProposalSheet({ visible, drafts, busy, onCancel, onConfirm }: Props) {
  // 開くたびに既定（全採用・M3-1）へ戻す。前回の却下を持ち越すと、
  // 別の生成結果で意図しない品が外れたまま確定される
  const [checked, setChecked] = useState<readonly boolean[]>(() => drafts.map(() => true));
  const [openedFor, setOpenedFor] = useState<readonly MenuRecipeDraft[]>(drafts);
  if (openedFor !== drafts) {
    setOpenedFor(drafts);
    setChecked(drafts.map(() => true));
  }

  const toggle = (index: number) => {
    setChecked((prev) => prev.map((value, at) => (at === index ? !value : value)));
  };

  const selected = drafts.filter((_, index) => checked[index]);

  return (
    <BottomSheet visible={visible} onClose={onCancel} title={t('menu.bulk.sheetTitle')}>
      <Text style={styles.body}>{t('menu.bulk.sheetBody')}</Text>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {drafts.map((draft, index) => {
          const on = checked[index] === true;
          return (
            <Pressable
              key={`${draft.title}-${index}`}
              style={styles.row}
              onPress={() => toggle(index)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={draft.title}
            >
              <View style={[styles.box, on && styles.boxOn]}>
                {on && <Check size={14} color={Colors.bg} strokeWidth={3} />}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.title} numberOfLines={1}>
                  {draft.title}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[
                    draft.cookTimeMin !== undefined
                      ? t('menu.day.minutes', { count: draft.cookTimeMin })
                      : null,
                    tCount('menu.bulk.ingredientCount', draft.ingredients.length),
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                </Text>
                {draft.description ? (
                  <Text style={styles.description} numberOfLines={2}>
                    {draft.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        style={[styles.confirm, (selected.length === 0 || busy) && styles.confirmOff]}
        disabled={selected.length === 0 || busy}
        onPress={() => onConfirm(selected)}
        accessibilityRole="button"
      >
        <Text
          style={[styles.confirmText, (selected.length === 0 || busy) && styles.confirmTextOff]}
        >
          {selected.length === 0
            ? t('menu.bulk.confirmNone')
            : tCount('menu.bulk.confirm', selected.length)}
        </Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: Typography.size.sm,
    color: Colors.paperDim,
    marginBottom: 12,
  },
  list: {
    maxHeight: 380,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  boxOn: {
    backgroundColor: Colors.gold,
  },
  rowText: { flex: 1, gap: 2 },
  title: {
    fontSize: Typography.size.base,
    color: Colors.paper,
  },
  meta: {
    fontSize: Typography.size.xs,
    color: Colors.goldDim,
  },
  description: {
    fontSize: Typography.size.xs,
    color: Colors.paperDim,
    lineHeight: 17,
  },
  confirm: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: Colors.gold,
    alignItems: 'center',
  },
  confirmOff: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.bg,
  },
  confirmTextOff: {
    color: Colors.muted,
  },
});

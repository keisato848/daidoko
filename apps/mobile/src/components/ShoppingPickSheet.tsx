/**
 * レシピの材料を買い物リストへ入れるときの選択シート（#214）。
 *
 * **在庫にある材料を一覧から消さない。** チェックを外した状態で「在庫 1個」と
 * 理由を添えて見せ、足りなければ利用者が入れ直せるようにする。
 * 数量の引き算はアプリではやらない（`docs/買い物リスト・在庫設計.md` §5.3-a）。
 *
 * 出すのは**除外が発生したときだけ**。全部足りないなら呼び出し側が
 * そのまま追加する（1 タップの速い道を壊さない）。
 */
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from './BottomSheet';
import { Colors, Typography } from '../constants/theme';
import { t } from '../i18n';
import { formatStockAmount, type ShoppingPlanRow } from '../utils/shoppingPlan';

interface Props {
  visible: boolean;
  rows: readonly ShoppingPlanRow[];
  onCancel: () => void;
  onConfirm: (selected: ShoppingPlanRow[]) => void;
}

function reasonFor(row: ShoppingPlanRow): string | null {
  if (row.status === 'on-list') return t('recipe.detail.shoppingPick.onList');
  if (row.status !== 'in-pantry') return null;
  const amount = formatStockAmount(row.stockQuantity, row.stockUnit);
  return amount
    ? t('recipe.detail.shoppingPick.inPantry', { amount })
    : t('recipe.detail.shoppingPick.inPantryUnknown');
}

export function ShoppingPickSheet({ visible, rows, onCancel, onConfirm }: Props) {
  // 開くたびに既定（足りないものだけ）へ戻す。前回の選択を持ち越すと、
  // 別のレシピで意図しないものが入る
  const [checked, setChecked] = useState<readonly boolean[]>(() => rows.map((r) => r.selected));
  const [openedFor, setOpenedFor] = useState<readonly ShoppingPlanRow[]>(rows);
  if (openedFor !== rows) {
    setOpenedFor(rows);
    setChecked(rows.map((r) => r.selected));
  }

  const toggle = (index: number) => {
    setChecked((prev) => prev.map((value, at) => (at === index ? !value : value)));
  };

  const selected = rows.filter((_, index) => checked[index]);

  return (
    <BottomSheet visible={visible} onClose={onCancel} title={t('recipe.detail.shoppingPick.title')}>
      <Text style={styles.body}>{t('recipe.detail.shoppingPick.body')}</Text>

      {/* 一括操作は**リストの上**に置く。7 日ぶんで 30 行を超えると、
          下に置いたぶんだけスクロールしないと届かない */}
      <View style={styles.bulkRow}>
        <Pressable
          style={styles.bulkButton}
          onPress={() => setChecked(rows.map(() => true))}
          accessibilityRole="button"
        >
          <Text style={styles.bulkText}>{t('recipe.detail.shoppingPick.selectAll')}</Text>
        </Pressable>
        <Pressable
          style={styles.bulkButton}
          onPress={() => setChecked(rows.map(() => false))}
          accessibilityRole="button"
        >
          <Text style={styles.bulkText}>{t('recipe.detail.shoppingPick.clearAll')}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {rows.map((row, index) => {
          const reason = reasonFor(row);
          const on = checked[index] === true;
          return (
            <Pressable
              key={`${row.name}-${index}`}
              style={styles.row}
              onPress={() => toggle(index)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={row.name}
            >
              <View style={[styles.box, on && styles.boxOn]}>
                {on && <Check size={14} color={Colors.bg} strokeWidth={3} />}
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {row.name}
              </Text>
              {row.amount ? <Text style={styles.amount}>{row.amount}</Text> : null}
              {reason ? <Text style={styles.reason}>{reason}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        style={[styles.confirm, selected.length === 0 && styles.confirmOff]}
        disabled={selected.length === 0}
        onPress={() => onConfirm(selected)}
      >
        <Text style={[styles.confirmText, selected.length === 0 && styles.confirmTextOff]}>
          {selected.length === 0
            ? t('recipe.detail.shoppingPick.addNone')
            : `${t('recipe.detail.shoppingPick.add')}（${selected.length}）`}
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
  bulkRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  bulkButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bulkText: {
    fontSize: Typography.size.xs,
    color: Colors.paperDim,
  },
  list: {
    maxHeight: 360,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  boxOn: {
    backgroundColor: Colors.gold,
  },
  name: {
    fontSize: Typography.size.base,
    color: Colors.paper,
    flexShrink: 1,
  },
  amount: {
    fontSize: Typography.size.xs,
    color: Colors.paperDim,
  },
  reason: {
    fontSize: Typography.size.xs,
    color: Colors.goldDim,
    marginLeft: 'auto',
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

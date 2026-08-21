/**
 * グループの絞り込みチップ（v13）。在庫の置き場所・買い物の買う場所で共用する。
 *
 * **「未設定」は常に表示する。** 絞り込みで未設定の品が消えると、振り分け忘れが
 * 埋もれて買い忘れ・二重買いになる。レシピ一覧のタグチップと同じ操作感に揃えてある。
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';

export interface GroupChipsProps {
  /** 選べるグループ名（未設定は含めない — こちらで足す） */
  groups: readonly string[];
  /** 選択中。null = すべて、UNGROUPED = 未設定 */
  selected: string | null;
  onSelect: (group: string | null) => void;
  allLabel: string;
  ungroupedLabel: string;
  /** 未設定バケツを指す番兵（pantry.service の UNGROUPED） */
  ungroupedValue: string;
}

export function GroupChips({
  groups,
  selected,
  onSelect,
  allLabel,
  ungroupedLabel,
  ungroupedValue,
}: GroupChipsProps) {
  // グループを一度も使っていないなら、チップ自体を出さない（使わない人の画面を変えない）
  if (groups.length === 0) return null;

  const chips: { value: string | null; label: string }[] = [
    { value: null, label: allLabel },
    ...groups.map((group) => ({ value: group, label: group })),
    { value: ungroupedValue, label: ungroupedLabel },
  ];

  return (
    // ScrollView を素の View で包む。列レイアウトの直下に置くと縦いっぱいまで伸び、
    // チップが縦長の帯になってしまう（レシピ一覧のタグチップと同じ組み方に揃えてある）
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {chips.map((chip) => {
          const active = selected === chip.value;
          return (
            <Pressable
              key={chip.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onSelect(chip.value)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // stretch のままだとチップが ScrollView の高さいっぱいに伸びる
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  chipText: {
    fontSize: 12,
    color: Colors.muted,
    maxWidth: 140,
  },
  chipTextActive: {
    color: Colors.bg,
    fontWeight: '600',
  },
});

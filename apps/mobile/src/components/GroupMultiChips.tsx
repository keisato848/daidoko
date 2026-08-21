/**
 * グループの複数選択チップ（v13）。相談で「どの置き場所の在庫を見てもらうか」を選ぶのに使う。
 *
 * **1つも選ばれていない＝すべて**。選ばせないと使えない作りにすると、置き場所を使っていない人にも
 * 選択を強いることになる。絞り込み用の {@link GroupChips} と違って、ここは足し算で選ぶ。
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';

export interface GroupMultiChipsProps {
  /** 選べるグループ名（未設定は含めない — こちらで足す） */
  groups: readonly string[];
  /** 選択中のグループ。空 = すべて */
  selected: readonly string[];
  onToggle: (group: string) => void;
  ungroupedLabel: string;
  /** 未設定バケツを指す番兵（pantry.service の UNGROUPED） */
  ungroupedValue: string;
}

export function GroupMultiChips({
  groups,
  selected,
  onToggle,
  ungroupedLabel,
  ungroupedValue,
}: GroupMultiChipsProps) {
  // グループを一度も使っていないなら、チップ自体を出さない
  if (groups.length === 0) return null;

  const chips: { value: string; label: string }[] = [
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
          const active = selected.includes(chip.value);
          return (
            <Pressable
              key={chip.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onToggle(chip.value)}
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

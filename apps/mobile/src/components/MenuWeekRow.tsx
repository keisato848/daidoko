/**
 * 週ビューの 1 日ぶん（S20・Track C PR-3）。見出し（日付・今日）＋枠の並び。
 *
 * 判断（どの日がいつか・今日か・済みか）は `utils/menuWeek.ts` が済ませていて、
 * ここは**描くだけ**。サービス層は jest で動かせないので、判断をここに置くと
 * テストで固定できなくなる（`docs/品質基準.md` §2.3）。
 */
import { RefreshCw } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { t } from '../i18n';
import { weekdayLabels } from '../utils/calendar';
import { isDayDone, type WeekDayRow } from '../utils/menuWeek';

import { MenuSlotLine, type SlotRecipeMeta } from './MenuSlotLine';

/**
 * `YYYY-MM-DD` を「9/19（金）」にする。**`new Date('YYYY-MM-DD')` は UTC 解釈**で
 * 日本時間では前日になるので、`T00:00:00` を付けてローカルで読む。
 */
function dateLabel(dateKey: string): string | null {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const weekday = weekdayLabels()[date.getDay()] ?? '';
  return t('menu.week.dateLabel', {
    month: String(date.getMonth() + 1),
    day: String(date.getDate()),
    weekday,
  });
}

export function MenuWeekRow({
  row,
  metaByRecipeId,
  busy,
  onOpenRecipe,
  onSwap,
}: {
  row: WeekDayRow;
  /** レシピ ID → 表示に足りない情報（無くなった・調理時間）。枠の行は持っていない */
  metaByRecipeId: ReadonlyMap<string, SlotRecipeMeta>;
  busy: boolean;
  onOpenRecipe: (recipeId: string) => void;
  /** その日の主菜を次の候補へ差し替える（M1 のまま・AI は呼ばない） */
  onSwap: (day: number) => void;
}) {
  // 日付が出せるのは自動モード（anchorDate あり）だけ。手動プランは「N日目」のまま
  const label =
    (row.dateKey !== null ? dateLabel(row.dateKey) : null) ?? t('menu.day.label', { day: row.day });
  // 差し替えは主菜がある日だけ。無くなったレシピの日は候補計算の元が無いので出さない
  const main = row.slots.find((s) => s.entry !== null);
  const canSwap = main?.entry != null && metaByRecipeId.get(main.entry.recipeId)?.missing !== true;

  return (
    <View style={[styles.row, row.isToday && styles.rowToday, isDayDone(row) && styles.rowDone]}>
      <View style={styles.header}>
        <Text style={[styles.date, row.isToday && styles.dateToday]}>{label}</Text>
        {row.isToday ? (
          <View style={styles.todayChip}>
            <Text style={styles.todayChipText}>{t('menu.week.today')}</Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        {canSwap ? (
          <Pressable
            onPress={() => onSwap(row.day)}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('menu.day.replace')}
          >
            <View style={styles.swapRow}>
              <RefreshCw size={14} color={Colors.gold} />
              <Text style={styles.swapText}>{t('menu.day.replace')}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {row.slots.map((cell) => {
        const recipeId = cell.entry?.recipeId;
        const meta = recipeId !== undefined ? metaByRecipeId.get(recipeId) : undefined;
        // **開けない枠には onPress を渡さない。** 渡して子側で無視すると、
        // 「押せるはずだが何もしない」要素になり、読み上げにもボタンとして出る
        const openable = recipeId !== undefined && meta?.missing !== true;
        return (
          <MenuSlotLine
            key={cell.slotId}
            cell={cell}
            meta={meta}
            onPress={openable ? () => onOpenRecipe(recipeId) : undefined}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  // 今日は枠線だけで示す（塗ると料理名のコントラストが落ちる）
  rowToday: { borderColor: Colors.gold },
  rowDone: { opacity: 0.75 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  spacer: { flex: 1 },
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swapText: { fontSize: 13, color: Colors.gold },
  date: { fontSize: 13, color: Colors.goldDim },
  dateToday: { color: Colors.gold },
  todayChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: Colors.gold,
  },
  todayChipText: { fontSize: 11, color: Colors.bg },
});

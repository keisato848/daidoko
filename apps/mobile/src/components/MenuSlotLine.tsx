/**
 * 週ビューの 1 枠ぶん（S20・Track C PR-3）。「主菜: 肉じゃが」の 1 行。
 *
 * **枠が空でも行は出す。** 出さないと「その枠を決めていない」と「その枠が無い」が
 * 見分けられず、副菜を足したこと自体を忘れる。
 *
 * 老眼のペルソナ（のりこ）を基準に、料理名は 16px・押せる範囲は行ぜんたい
 * （小さな「開く」リンクを狙わせない）。
 */
import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { t } from '../i18n';
import { decodeReason } from '../utils/menuPlan';
import type { WeekSlotCell } from '../utils/menuWeek';

/** 保存された `reason` を文言に戻す。往復は `decodeReason` 側でテストしてある */
function reasonText(reason: string): string {
  const { kind, subject } = decodeReason(reason);
  if (kind === 'expiry' && subject) return t('menu.reason.expiry', { name: subject });
  if (kind === 'coverage') return t('menu.reason.coverage', { count: subject });
  if (kind === 'pinned') return t('menu.reason.pinned');
  if (kind === 'few-missing') return t('menu.reason.fewMissing', { count: subject });
  // AI（M2）の理由はここでは翻訳しない — subject が AI 出力そのもの（ai-output-locale の世界）
  if (kind === 'ai') return subject;
  // M3: 一括生成で新しく作って組み込んだ日
  if (kind === 'ai-new') return t('menu.reason.aiNew');
  return '';
}

/**
 * レシピ側の状態。**枠の行（`menu_plan_slots`）は持っていない**ので、画面が
 * レシピ ID で引いて渡す。PR-4 で hydrate が枠ごとに計算するようになったら畳む。
 */
export interface SlotRecipeMeta {
  /** レシピが削除・アーカイブされた */
  missing: boolean;
  cookTimeMin: number | null;
}

export function MenuSlotLine({
  cell,
  meta,
  onPress,
}: {
  cell: WeekSlotCell;
  meta?: SlotRecipeMeta | undefined;
  /** 献立が入っている枠だけ押せる。空の枠は押しても何も起きない（PR-4 で足す口になる） */
  onPress?: (() => void) | undefined;
}) {
  const entry = cell.entry;
  const done = entry?.doneAt != null;
  const missing = meta?.missing === true;
  // なぜこの日にこれなのか（§10.3）。AI を使わず採点の決め手から機械的に作る
  const reason = entry !== null && !missing ? reasonText(entry.reason) : '';

  const body = (
    <View style={styles.line}>
      <Text style={styles.slotLabel} numberOfLines={1}>
        {cell.label}
      </Text>
      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            entry === null && styles.empty,
            missing && styles.empty,
            done && styles.titleDone,
          ]}
          numberOfLines={2}
        >
          {entry === null
            ? t('menu.week.slotEmpty')
            : missing
              ? t('menu.day.missing')
              : entry.title}
        </Text>
        {entry !== null && !missing && meta?.cookTimeMin != null ? (
          <Text style={styles.meta}>{t('menu.day.minutes', { count: meta.cookTimeMin })}</Text>
        ) : null}
        {reason ? <Text style={styles.reason}>{reason}</Text> : null}
      </View>
      {/* 済みは色だけで示さない（色覚・屋外の明るさで消える）。印を添える */}
      {done ? <Check size={16} color={Colors.goldDim} /> : null}
    </View>
  );

  // 無くなったレシピは開かせない（開くと「レシピが見つかりません」になるだけ）
  if (entry === null || missing || !onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={entry.title}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  // 枠名は幅を固定して料理名の頭を縦に揃える（視線が縦に流れる）
  slotLabel: { width: 48, fontSize: 12, color: Colors.muted },
  body: { flex: 1 },
  title: { fontSize: 16, color: Colors.paper },
  titleDone: { color: Colors.paperDim },
  empty: { color: Colors.muted, fontSize: 14 },
  meta: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  reason: { fontSize: 12, color: Colors.goldDim, marginTop: 2 },
});

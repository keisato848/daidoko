/**
 * 週ビューの 1 枠ぶん（S20・Track C PR-3）。「主菜: 肉じゃが」の 1 行。
 *
 * **枠が空でも行は出す。** 出さないと「その枠を決めていない」と「その枠が無い」が
 * 見分けられず、副菜を足したこと自体を忘れる。
 *
 * 老眼のペルソナ（のりこ）を基準に、料理名は 16px・押せる範囲は行ぜんたい
 * （小さな「開く」リンクを狙わせない）。
 */
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
  onEdit,
}: {
  cell: WeekSlotCell;
  meta?: SlotRecipeMeta | undefined;
  /** 埋まっている枠＝レシピを開く／空の枠＝料理を入れる。渡されなければ押せない */
  onPress?: (() => void) | undefined;
  /**
   * 枠の中身を変える。**埋まっている枠でだけ別のボタンとして出す** — 行のタップは
   * レシピを開く方に使っているので、変える口が無いと入れ替えられない
   */
  onEdit?: (() => void) | undefined;
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
      {/* **記号ではなく文字で出す**（受付票 C の受入基準）。✓ だけだと、のりこ（老眼・
        紙のレシピ帳から移行）には何の印か伝わらない。色だけで示すのも同じ理由で不可
        （色覚・屋外の明るさで消える）。献立が入っている枠にだけ出す */}
      {entry !== null && !missing ? (
        <Text style={[styles.state, done && styles.stateDone]}>
          {done ? t('menu.week.stateDone') : t('menu.week.statePlanned')}
        </Text>
      ) : null}
      {entry !== null && onEdit ? (
        <Pressable
          onPress={onEdit}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${cell.label} ${t('menu.slotPick.change')}`}
        >
          <Text style={styles.edit}>{t('menu.slotPick.change')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  // **押せるかどうかは呼び出し側が決める。** ここで `entry === null` を弾くと、
  // 空の枠に渡された「入れる」が黙って捨てられ、**枠を足しても入れる口が無くなる**
  // （PR-4 の実機確認で踏んだ）。子が渡された onPress を無視する形にしない
  //（`docs/品質基準.md` §2.3 の `fireEvent.press` の項と同じ理由）
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={entry?.title ?? `${cell.label} ${t('menu.week.slotEmpty')}`}
    >
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
  // 「予定」「済み」。13px は受入基準の下限（副菜の本文と同じ大きさ）
  state: { fontSize: 13, color: Colors.muted },
  stateDone: { color: Colors.gold },
  edit: { fontSize: 13, color: Colors.gold },
});

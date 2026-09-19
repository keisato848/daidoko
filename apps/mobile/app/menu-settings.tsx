/**
 * S21 献立の設定（#215 A1・設計 §10.11）— menu.tsx の歯車から開く。
 *
 * 二段オプトイン: 親「毎日の献立」（既定オフ）→ 子「足りない材料を自動で追加」
 * （既定オフ）。親をオンにした瞬間に一度だけ `runDailyMenuMaintenance()` を呼んで
 * 今日ぶんを組む（次の起動を待たせない）。オフにした瞬間に通知を取り消す——
 * 「通知 → menu → 歯車 → OFF」の 3 タップで確実に止められることが設計要件（§10.11.4）。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { HeaderBackButton } from '../src/components/HeaderBackButton';
import { KeyboardAvoider } from '../src/components/KeyboardAvoider';
import { NumberStepper } from '../src/components/NumberStepper';
import { Colors } from '../src/constants/theme';
import { t } from '../src/i18n';
import {
  getMenuAutoDays,
  getMenuAutoNotifyTime,
  getMenuTasteMemo,
  isMenuAutoAddEnabled,
  isMenuAutoEnabled,
  MENU_TASTE_MEMO_MAX_LENGTH,
  setMenuAutoAddEnabled,
  setMenuAutoDays,
  setMenuAutoEnabled,
  setMenuAutoNotifyTime,
  setMenuTasteMemo,
} from '../src/services/app-meta.service';
import { dialog } from '../src/services/dialog.service';
import {
  clearMenuPlan,
  getMenuSlotSettings,
  MENU_MEAL_TIMES,
  refreshMenuNotificationSchedule,
  runDailyMenuMaintenance,
  saveMenuSlotSettings,
  type MenuMealTime,
} from '../src/services/menu-plan.service';
import { formatMenuAutoNotifyTime, type MenuAutoNotifyTime } from '../src/utils/menuAuto';
import {
  addSlot,
  canRemoveSlot,
  isAutoFillSlot,
  normalizeSlots,
  removeSlot,
  setSlotAutoFill,
  SLOT_KINDS,
  type SlotKind,
} from '../src/utils/menuSlots';
import type { WeekSlotSetting } from '../src/utils/menuWeek';

/**
 * 時間帯・枠の種類の文言。`t()` はキーをリテラル型で受けるので、
 * 実行時に決まるものはこの対応表で引く（menu.tsx の MEAL_TIME_LABEL_KEY と同じ作法）。
 */
const MEAL_TIME_LABEL_KEY = {
  breakfast: 'menu.mealTime.breakfast',
  lunch: 'menu.mealTime.lunch',
  dinner: 'menu.mealTime.dinner',
} as const satisfies Record<MenuMealTime, string>;

const SLOT_KIND_LABEL_KEY = {
  main: 'menu.slotKind.main',
  side: 'menu.slotKind.side',
  soup: 'menu.slotKind.soup',
  salad: 'menu.slotKind.salad',
  dessert: 'menu.slotKind.dessert',
} as const satisfies Record<SlotKind, string>;

/** 足せる枠。主菜は最初からあって消せないので、足す側には出さない */
const ADDABLE_SLOT_KINDS = SLOT_KINDS.filter((k): k is Exclude<SlotKind, 'main'> => k !== 'main');

/** 通知時刻の選択肢。専用の時刻ピッカーは入れず、既存の「日数チップ」と同じ形で選ばせる */
const NOTIFY_TIME_OPTIONS: readonly MenuAutoNotifyTime[] = [
  { hour: 6, minute: 0 },
  { hour: 6, minute: 30 },
  { hour: 7, minute: 0 },
  { hour: 7, minute: 30 },
  { hour: 8, minute: 0 },
  { hour: 8, minute: 30 },
  { hour: 9, minute: 0 },
];

function formatTimeLabel(time: MenuAutoNotifyTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export default function MenuSettingsScreen() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [parentOn, setParentOn] = useState(false);
  const [childOn, setChildOn] = useState(false);
  const [days, setDays] = useState(3);
  const [notifyTime, setNotifyTime] = useState<MenuAutoNotifyTime>({ hour: 7, minute: 0 });
  // M3-4: 家族の嗜好メモ（ローカル保存・同期しない）。一括生成にだけ渡す
  const [tasteMemo, setTasteMemo] = useState('');
  // 枠の構成（PR-4・§10.14）。時間帯ごとに持つので、編集対象の時間帯も状態に持つ
  const [slotMealTime, setSlotMealTime] = useState<MenuMealTime>('dinner');
  const [slots, setSlots] = useState<WeekSlotSetting[]>([]);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([
        isMenuAutoEnabled(),
        isMenuAutoAddEnabled(),
        getMenuAutoDays(),
        getMenuAutoNotifyTime(),
        getMenuTasteMemo(),
      ]).then(([auto, add, x, time, memo]) => {
        setParentOn(auto);
        setChildOn(add);
        setDays(x);
        setNotifyTime(time);
        setTasteMemo(memo);
        setLoaded(true);
      });
    }, []),
  );

  // 枠は編集対象の時間帯が変わるたびに読み直す。**正規化してから画面へ**
  // （同期で主菜だけ消えた・重複した状態を受け取っても、開いた時点で直る）
  useFocusEffect(
    useCallback(() => {
      void getMenuSlotSettings(slotMealTime)
        .then((rows) => setSlots(normalizeSlots(rows, t('menu.slotKind.main'))))
        .catch(() => setSlots([]));
    }, [slotMealTime]),
  );

  /**
   * 枠を保存する。画面へは先に反映し、保存の失敗で操作感を止めない。
   *
   * **保存の直前に必ず `normalizeSlots` を通す。** 読み込み前や時間帯を切り替えた直後は
   * `slots` が空・前の時間帯のままで、そこへ「足す」を押すと主菜の無い並びを渡してしまう。
   * `saveMenuSlotSettings` は渡した並びを「その時間帯の全部」として扱うので、
   * **主菜が removed 扱いで消え、墓標が家族にも飛ぶ**
   */
  const persistSlots = useCallback(
    (next: WeekSlotSetting[]) => {
      const normalized = normalizeSlots(next, t('menu.slotKind.main'));
      setSlots(normalized);
      void saveMenuSlotSettings(slotMealTime, normalized).catch(() => undefined);
    },
    [slotMealTime],
  );

  const handleToggleParent = useCallback((next: boolean) => {
    setParentOn(next); // 反応を待たせない（先に画面へ反映）
    void (async () => {
      await setMenuAutoEnabled(next).catch(() => undefined);
      if (next) {
        // オンにした瞬間に今日ぶんを組む。次の起動まで待たせない（§10.11.1 と同じ経路）
        await runDailyMenuMaintenance().catch(() => undefined);
      } else {
        // 予約済みの通知を取り消す。「3 タップで止められる」を保証する
        await refreshMenuNotificationSchedule().catch(() => undefined);
      }
    })();
  }, []);

  const handleToggleChild = useCallback((next: boolean) => {
    setChildOn(next);
    void setMenuAutoAddEnabled(next).catch(() => setChildOn(!next));
  }, []);

  const handleChangeDays = useCallback((next: number | undefined) => {
    if (next == null) return;
    setDays(next);
    void setMenuAutoDays(next).catch(() => undefined);
  }, []);

  const handlePickNotifyTime = useCallback(
    (time: MenuAutoNotifyTime) => {
      setNotifyTime(time);
      void (async () => {
        await setMenuAutoNotifyTime(time).catch(() => undefined);
        // 親がオンのときだけ、変えた時刻ですぐ予約し直す
        if (parentOn) await refreshMenuNotificationSchedule().catch(() => undefined);
      })();
    },
    [parentOn],
  );

  /** 献立を消す。破壊的操作なので確認を挟む（`docs/画面設計.md` §7-3）。在庫・買い物リストは触らない */
  const handleClearPlan = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: t('menu.settings.clearConfirmTitle'),
      message: t('menu.settings.clearConfirmBody'),
      confirmLabel: t('menu.settings.clearAction'),
      destructive: true,
    });
    if (!confirmed) return;
    await clearMenuPlan();
    router.back(); // menu.tsx へ戻る。フォーカス時に取り直して空の状態を見せる
  }, [router]);

  if (!loaded) return null;

  return (
    // 嗜好メモ（M3-4）の TextInput があるので KeyboardAvoider で包む（S21 全体）
    <KeyboardAvoider style={styles.container}>
      <View style={styles.header}>
        <HeaderBackButton />
        <Text style={styles.headerTitle}>{t('menu.settings.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('menu.settings.parentLabel')}</Text>
            <Text style={styles.rowSubtitle}>{t('menu.settings.parentSubtitle')}</Text>
          </View>
          <Switch
            value={parentOn}
            onValueChange={handleToggleParent}
            trackColor={{ false: Colors.border, true: Colors.gold }}
            thumbColor={Colors.paper}
          />
        </View>

        <View style={[styles.section, !parentOn && styles.sectionDisabled]}>
          <NumberStepper
            label={t('menu.settings.daysLabel')}
            value={days}
            onChange={handleChangeDays}
            min={2}
            max={7}
          />

          <Text style={styles.chipLabel}>{t('menu.settings.notifyTimeLabel')}</Text>
          <View style={styles.chipRow}>
            {NOTIFY_TIME_OPTIONS.map((option) => {
              const selected =
                formatMenuAutoNotifyTime(option) === formatMenuAutoNotifyTime(notifyTime);
              return (
                <Pressable
                  key={formatMenuAutoNotifyTime(option)}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => handlePickNotifyTime(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                    {formatTimeLabel(option)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.row, styles.childRow, !parentOn && styles.sectionDisabled]}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('menu.settings.childLabel')}</Text>
            <Text style={styles.rowSubtitle}>{t('menu.settings.childSubtitle')}</Text>
          </View>
          <Switch
            value={childOn}
            onValueChange={handleToggleChild}
            trackColor={{ false: Colors.border, true: Colors.gold }}
            thumbColor={Colors.paper}
          />
        </View>

        {/* M3-4: 家族の嗜好・定番食材は事前登録して毎回聞かない（§10.12）。
          親トグルとは独立 — 一括生成（M3）は自動モードがオフでも使える。
          保存は編集を終えたとき（onEndEditing/onBlur）。1 文字ごとに DB へ書かない */}
        <View style={styles.tasteSection}>
          <Text style={styles.rowLabel}>{t('menu.settings.tasteLabel')}</Text>
          <Text style={styles.rowSubtitle}>{t('menu.settings.tasteSubtitle')}</Text>
          <TextInput
            style={styles.tasteInput}
            value={tasteMemo}
            onChangeText={setTasteMemo}
            onEndEditing={() => void setMenuTasteMemo(tasteMemo).catch(() => undefined)}
            onBlur={() => void setMenuTasteMemo(tasteMemo).catch(() => undefined)}
            placeholder={t('menu.settings.tastePlaceholder')}
            placeholderTextColor={Colors.muted}
            multiline
            maxLength={MENU_TASTE_MEMO_MAX_LENGTH}
          />
        </View>

        {/* 枠の構成（PR-4・§10.14）。時間帯ごとに持つ。自動モードとは独立
          （手で組む人も枠は使う）ので sectionDisabled を掛けない */}
        <View style={styles.slotSection}>
          <Text style={styles.rowLabel}>{t('menu.settings.slotsLabel')}</Text>
          <Text style={styles.rowSubtitle}>{t('menu.settings.slotsSubtitle')}</Text>

          <Text style={styles.chipLabel}>{t('menu.settings.slotsMealTimeLabel')}</Text>
          <View style={styles.chipRow}>
            {MENU_MEAL_TIMES.map((option) => (
              <Pressable
                key={option}
                style={[styles.chip, slotMealTime === option && styles.chipActive]}
                onPress={() => setSlotMealTime(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: slotMealTime === option }}
              >
                <Text style={[styles.chipText, slotMealTime === option && styles.chipTextActive]}>
                  {t(MEAL_TIME_LABEL_KEY[option])}
                </Text>
              </Pressable>
            ))}
          </View>

          {slots.map((slot) => (
            <View key={slot.slotId} style={styles.slotRow}>
              <Text style={styles.slotName}>{slot.label}</Text>
              {/* 主菜は「自動で埋める」を切れない（切ると「組む」が何も組まない）ので
                  スイッチも消すも出さない。`canRemoveSlot` と `setSlotAutoFill` が同じ判断を持つ */}
              {canRemoveSlot(slot.slotId) ? (
                <View style={styles.slotActions}>
                  <Text style={styles.slotAutoFillLabel}>{t('menu.settings.slotAutoFill')}</Text>
                  <Switch
                    value={isAutoFillSlot(slot)}
                    onValueChange={(next) =>
                      persistSlots(setSlotAutoFill(slots, slot.slotId, next))
                    }
                    trackColor={{ false: Colors.border, true: Colors.gold }}
                    thumbColor={Colors.paper}
                    accessibilityLabel={`${slot.label} ${t('menu.settings.slotAutoFill')}`}
                  />
                  <Pressable
                    onPress={() => persistSlots(removeSlot(slots, slot.slotId))}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${slot.label} ${t('menu.settings.slotRemove')}`}
                  >
                    <Text style={styles.slotRemove}>{t('menu.settings.slotRemove')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
          {slots.some((s) => canRemoveSlot(s.slotId)) ? (
            <Text style={styles.rowSubtitle}>{t('menu.settings.slotAutoFillNote')}</Text>
          ) : null}

          <View style={styles.chipRow}>
            {ADDABLE_SLOT_KINDS.map((kind) => {
              const label = t(SLOT_KIND_LABEL_KEY[kind]);
              return (
                <Pressable
                  key={kind}
                  style={styles.chip}
                  onPress={() => persistSlots(addSlot(slots, kind, label))}
                  accessibilityRole="button"
                >
                  <Text style={styles.chipText}>{t('menu.settings.slotAdd', { kind: label })}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          style={styles.clearButton}
          onPress={() => void handleClearPlan()}
          accessibilityRole="button"
        >
          <Trash2 size={15} color="#FF6B6B" />
          <Text style={styles.clearButtonText}>{t('menu.settings.clearAction')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  slotSection: { marginTop: 24, gap: 6 },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  slotName: { fontSize: 16, color: Colors.paper },
  slotActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  slotAutoFillLabel: { fontSize: 13, color: Colors.paperDim },
  slotRemove: { fontSize: 14, color: Colors.gold },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 58,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '500', color: Colors.paper },
  headerSpacer: { width: 36 },
  content: { padding: 20, paddingBottom: 48, gap: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  childRow: { borderBottomWidth: 0 },
  rowText: { flex: 1, gap: 4 },
  rowLabel: { fontSize: 15, color: Colors.paper },
  rowSubtitle: { fontSize: 13, color: Colors.paperDim, lineHeight: 19 },
  section: { paddingTop: 4, gap: 8 },
  sectionDisabled: { opacity: 0.5 },
  chipLabel: { fontSize: 13, color: Colors.muted, marginBottom: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  chipText: { fontSize: 14, color: Colors.paper },
  chipTextActive: { color: Colors.bg },
  tasteSection: { gap: 6, paddingTop: 4 },
  tasteInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.paper,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#5A2E2E',
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 4,
  },
  clearButtonText: { fontSize: 13, fontWeight: '600', color: '#FF6B6B' },
});

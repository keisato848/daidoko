/**
 * S20 献立（X 日分の献立・#215 M1）— ホームのカード・在庫・買い物から開く。
 *
 * **開いた時点で M1 の献立が既に出ている**（設計 §10.7）。開いてから AI を呼ぶ作りは
 * 枠切れ・オフライン・蔵書庫不足のどれかで**画面が空になる**。M2 の AI は
 * ボタン 1 本に閉じ込め、失敗しても M1 の並びがそのまま生きる形にする。
 *
 * 差し替えは候補の次点へ（即時・¥0・オフライン可）。AI は絶対に呼ばない。
 * 在庫が変わったら「作り直す」を静かに出すだけで、**勝手に組み直さない**。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import {
  CalendarDays,
  ChefHat,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Wand2,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import { arrangeMenu, MenuArrangeError } from '../../src/services/menu-arrange.provider';
import {
  applyMenuArrangement,
  buildMenuArrangeContext,
  generateMenuPlan,
  getMenuPlan,
  replaceMenuDay,
  type MenuDayView,
  type MenuPlanView,
} from '../../src/services/menu-plan.service';
import { ensureInferenceCredit } from '../../src/services/inference-gate.service';
import { FREE_MONTHLY_LIMIT, recordCloudInference } from '../../src/services/usage.service';
import { decodeReason } from '../../src/utils/menuPlan';

/** 日数の選択肢（設計 §10.7） */
const DAY_OPTIONS = [2, 3, 5, 7] as const;

/** 保存された `reason` を文言に戻す。往復は `decodeReason` 側でテストしてある */
function reasonText(reason: string): string {
  const { kind, subject } = decodeReason(reason);
  if (kind === 'expiry' && subject) return t('menu.reason.expiry', { name: subject });
  if (kind === 'coverage') return t('menu.reason.coverage', { count: subject });
  if (kind === 'pinned') return t('menu.reason.pinned');
  if (kind === 'few-missing') return t('menu.reason.fewMissing', { count: subject });
  // AI（M2）の理由はここでは翻訳しない — subject が AI 出力そのもの（ai-output-locale の世界）
  if (kind === 'ai') return subject;
  return '';
}

export default function MenuScreen() {
  const router = useRouter();
  const [view, setView] = useState<MenuPlanView | null>(null);
  const [days, setDays] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // M2（AI 並べ替え）の状態。plan は常に M1/M2 どちらの並びも表示し続け、
  // AI 実行中も画面を塞がない（§10.7）。失敗しても plan には一切触らない
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await getMenuPlan();
    setView(next);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const build = useCallback(async () => {
    setBusy(true);
    setAiError(null);
    try {
      setView(await generateMenuPlan(days));
    } finally {
      setBusy(false);
    }
  }, [days]);

  const swap = useCallback(async (day: number) => {
    setBusy(true);
    try {
      const next = await replaceMenuDay(day);
      if (next) setView(next);
    } finally {
      setBusy(false);
    }
  }, []);

  // 「AIに並べ替えてもらう」。呼ぶのは「組む」1 操作につき 1 回 — 差し替えでは絶対に
  // 呼ばない（§10.5）。失敗・枠切れ・空の結果はすべて M1 の並びへそのまま落とす（§10.7）。
  const runAi = useCallback(async () => {
    setAiError(null);
    const gate = await ensureInferenceCredit();
    if (gate === 'paywall') {
      router.push('/recipes/paywall');
      return;
    }
    if (gate !== 'ready') return; // cancelled — 何も変えない

    setAiRunning(true);
    try {
      const context = await buildMenuArrangeContext();
      if (!context || context.candidates.length === 0) {
        throw new MenuArrangeError(t('menu.ai.emptyResult'), true);
      }
      const result = await arrangeMenu({
        candidates: context.candidates,
        pantry: context.pantryNames,
        recentTitles: context.recentTitles,
        days,
      });
      if (result.days.length === 0) {
        throw new MenuArrangeError(t('menu.ai.emptyResult'), true);
      }
      const next = await applyMenuArrangement(result);
      if (next) setView(next);
      // 成功時だけ枠を消費（BYOK・プレミアムは内部で no-op・consult と同じ倒し方）
      void recordCloudInference().catch(() => undefined);
    } catch (err) {
      setAiError(err instanceof MenuArrangeError ? err.message : t('menu.ai.failed'));
      // plan には触らない — M1（または前回）の並びがそのまま生きている
    } finally {
      setAiRunning(false);
    }
  }, [days, router]);

  if (!loaded) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.gold} />
      </View>
    );
  }

  const hasPlan = view !== null && view.days.length > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <CalendarDays size={20} color={Colors.gold} />
        <Text style={styles.title}>{t('menu.title')}</Text>
        {/* AI が並べ替えた献立だと分かるように（M1/M2 どちらの結果かは source に残す・§10.6） */}
        {view?.plan.source === 'ai' ? (
          <View style={styles.arrangedBadge}>
            <Text style={styles.arrangedBadgeText}>{t('menu.ai.arrangedBadge')}</Text>
          </View>
        ) : null}
      </View>

      {/* 日数の選択と「組む」。組み直しはいつでもできる */}
      <Text style={styles.sectionLabel}>{t('menu.days.label')}</Text>
      <View style={styles.dayRow}>
        {DAY_OPTIONS.map((option) => (
          <Pressable
            key={option}
            style={[styles.dayChip, days === option && styles.dayChipActive]}
            onPress={() => setDays(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: days === option }}
          >
            <Text style={[styles.dayChipText, days === option && styles.dayChipTextActive]}>
              {t('menu.days.option', { count: option })}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.primary, busy && styles.disabled]}
        onPress={build}
        disabled={busy}
        accessibilityRole="button"
      >
        <Sparkles size={16} color={Colors.bg} />
        <Text style={styles.primaryText}>{t('menu.card.build')}</Text>
      </Pressable>

      {/* M2: AI に並べ替えてもらう。M1 の献立がある前提の 1 操作（§10.7） */}
      {hasPlan ? (
        <View style={styles.aiSection}>
          <Pressable
            style={[styles.aiButton, (aiRunning || busy) && styles.disabled]}
            onPress={() => void runAi()}
            disabled={aiRunning || busy}
            accessibilityRole="button"
          >
            {aiRunning ? (
              <ActivityIndicator size="small" color={Colors.gold} />
            ) : (
              <Wand2 size={16} color={Colors.gold} />
            )}
            <Text style={styles.aiButtonText}>
              {aiRunning ? t('menu.ai.running') : t('menu.ai.button')}
            </Text>
          </Pressable>
          {/* 残数は出さない。上限の静的表示だけ（§10.10.4 — 献立コードに数字を持たせない） */}
          <Text style={styles.aiLimitNote}>{tCount('menu.ai.limitNote', FREE_MONTHLY_LIMIT)}</Text>
        </View>
      ) : null}

      {/* AI が失敗しても画面は塞がない。M1（または前回）の並びがそのまま生きている（§10.7） */}
      {aiError ? (
        <View style={styles.staleBar}>
          <Text style={styles.staleText}>{aiError}</Text>
          <Pressable onPress={() => void runAi()} disabled={aiRunning} accessibilityRole="button">
            <Text style={styles.staleAction}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 在庫が変わった。勝手に組み直さず、伝えるだけ（§10.6） */}
      {view?.stale ? (
        <View style={styles.staleBar}>
          <Text style={styles.staleText}>{t('menu.stale.message')}</Text>
          <Pressable onPress={build} disabled={busy} accessibilityRole="button">
            <Text style={styles.staleAction}>{t('menu.stale.rebuild')}</Text>
          </Pressable>
        </View>
      ) : null}

      {hasPlan ? (
        <>
          {view.days.map((day) => (
            <DayCard
              key={day.day}
              day={day}
              busy={busy}
              onOpen={() => router.push(`/recipes/${day.recipeId}`)}
              onSwap={() => void swap(day.day)}
            />
          ))}

          <Pressable
            style={styles.secondary}
            onPress={() => router.push('/shopping')}
            accessibilityRole="button"
          >
            <ShoppingCart size={16} color={Colors.gold} />
            <Text style={styles.secondaryText}>{t('menu.shopping.add')}</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t('menu.emptyDays.title')}</Text>
          <Text style={styles.emptyBody}>{t('menu.emptyDays.noRecipes')}</Text>
          <Pressable
            style={styles.secondary}
            onPress={() => router.push('/recipes/consult')}
            accessibilityRole="button"
          >
            <ChefHat size={16} color={Colors.gold} />
            <Text style={styles.secondaryText}>{t('menu.emptyDays.toConsult')}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function DayCard({
  day,
  busy,
  onOpen,
  onSwap,
}: {
  day: MenuDayView;
  busy: boolean;
  onOpen: () => void;
  onSwap: () => void;
}) {
  const reason = reasonText(day.reason);
  return (
    <View style={[styles.card, day.doneAt !== null && styles.cardDone]}>
      <Text style={styles.dayLabel}>{t('menu.day.label', { day: day.day })}</Text>
      <Text style={styles.dayTitle}>{day.missing ? t('menu.day.missing') : day.title}</Text>
      {day.cookTimeMin !== null ? (
        <Text style={styles.dayMeta}>{t('menu.day.minutes', { count: day.cookTimeMin })}</Text>
      ) : null}
      {reason ? <Text style={styles.dayReason}>{reason}</Text> : null}
      {day.doneAt !== null ? <Text style={styles.doneBadge}>{t('menu.day.done')}</Text> : null}

      {!day.missing ? (
        <View style={styles.cardActions}>
          <Pressable onPress={onOpen} accessibilityRole="button">
            <Text style={styles.cardAction}>{t('menu.day.openRecipe')}</Text>
          </Pressable>
          <Pressable onPress={onSwap} disabled={busy} accessibilityRole="button">
            <View style={styles.swapRow}>
              <RefreshCw size={14} color={Colors.gold} />
              <Text style={styles.cardAction}>{t('menu.day.replace')}</Text>
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '500', color: Colors.paper, letterSpacing: 0.5 },
  sectionLabel: { fontSize: 13, color: Colors.muted, marginBottom: 8 },
  dayRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  dayChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dayChipActive: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  dayChipText: { fontSize: 14, color: Colors.paper },
  dayChipTextActive: { color: Colors.bg },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 14,
    marginBottom: 16,
  },
  primaryText: { fontSize: 15, color: Colors.bg, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  arrangedBadge: {
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  arrangedBadgeText: { fontSize: 11, color: Colors.gold },
  aiSection: { marginBottom: 16, gap: 6 },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 12,
  },
  aiButtonText: { fontSize: 14, color: Colors.gold, fontWeight: '600' },
  aiLimitNote: { fontSize: 12, color: Colors.muted, textAlign: 'center' },
  staleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  staleText: { fontSize: 14, color: Colors.muted },
  staleAction: { fontSize: 14, color: Colors.gold, fontWeight: '600' },
  card: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardDone: { opacity: 0.5 },
  dayLabel: { fontSize: 12, color: Colors.gold, marginBottom: 4 },
  dayTitle: { fontSize: 15, color: Colors.paper },
  dayMeta: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  dayReason: { fontSize: 13, color: Colors.muted, marginTop: 6 },
  doneBadge: { fontSize: 12, color: Colors.gold, marginTop: 6 },
  cardActions: { flexDirection: 'row', gap: 20, marginTop: 12 },
  cardAction: { fontSize: 14, color: Colors.gold },
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 8,
  },
  secondaryText: { fontSize: 14, color: Colors.gold },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyTitle: { fontSize: 15, color: Colors.paper },
  emptyBody: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
});

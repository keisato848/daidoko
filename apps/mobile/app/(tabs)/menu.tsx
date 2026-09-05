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
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  ShoppingCart,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MenuRecipeProposalSheet } from '../../src/components/MenuRecipeProposalSheet';
import { ShoppingPickSheet } from '../../src/components/ShoppingPickSheet';
import { Toast } from '../../src/components/Toast';
import { Colors } from '../../src/constants/theme';
import { MENU_AI_ENABLED } from '../../src/config';
import { t, tCount } from '../../src/i18n';
import { getMenuTasteMemo } from '../../src/services/app-meta.service';
import { arrangeMenu, MenuArrangeError } from '../../src/services/menu-arrange.provider';
import {
  generateMenuRecipes,
  MenuRecipesError,
  type MenuRecipeDraft,
} from '../../src/services/menu-recipes.provider';
import {
  addMenuShoppingRows,
  applyMenuArrangement,
  buildMenuArrangeContext,
  buildMenuBulkContext,
  buildMenuShoppingPlan,
  fillMenuPlanShortfall,
  generateMenuPlan,
  getMenuPlan,
  getStoredMealTimes,
  MENU_MEAL_TIMES,
  replaceMenuDay,
  undoMenuAutoAddedItems,
  type MenuDayView,
  type MenuMealTime,
  type MenuPlanView,
} from '../../src/services/menu-plan.service';
import { createRecipe } from '../../src/services/recipe.service';
import { ensureInferenceCredit } from '../../src/services/inference-gate.service';
import { FREE_MONTHLY_LIMIT, recordCloudInference } from '../../src/services/usage.service';
import { decodeReason } from '../../src/utils/menuPlan';
import type { ShoppingPlanRow } from '../../src/utils/shoppingPlan';
import { formatSnapshotTime } from '../../src/utils/widgetSnapshot';

/** 日数の選択肢（設計 §10.7） */
const DAY_OPTIONS = [2, 3, 5, 7] as const;

/**
 * 時間帯チップの文言（設計 §10.13）。`t()` はキーをリテラル型で受けるため、
 * 実行時に決まる時間帯はこの対応表で引く。
 */
const MEAL_TIME_LABEL_KEY = {
  breakfast: 'menu.mealTime.breakfast',
  lunch: 'menu.mealTime.lunch',
  dinner: 'menu.mealTime.dinner',
} as const satisfies Record<MenuMealTime, string>;

/** ヘッダ近くの控えめな表記。**夕は無印**（朝/昼のときだけ出す・§10.13） */
const MEAL_TIME_PLAN_LABEL_KEY = {
  breakfast: 'menu.mealTime.planLabel.breakfast',
  lunch: 'menu.mealTime.planLabel.lunch',
} as const;

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

export default function MenuScreen() {
  const router = useRouter();
  const [view, setView] = useState<MenuPlanView | null>(null);
  const [days, setDays] = useState<number>(3);
  /**
   * 選択中の時間帯（v19・§10.13）。**既定は夕 — 選ばなければ従来と完全に同じ操作**。
   * 時間帯ごとに独立したプランを持ち、チップは表示の切り替えも兼ねる
   * （夕のプランを保ったまま昼を組める）。
   */
  const [mealTime, setMealTime] = useState<MenuMealTime>('dinner');
  /** プランが保存されている時間帯（チップの「他にもある」ドット用） */
  const [plannedMealTimes, setPlannedMealTimes] = useState<MenuMealTime[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // M2（AI 並べ替え）の状態。plan は常に M1/M2 どちらの並びも表示し続け、
  // AI 実行中も画面を塞がない（§10.7）。失敗しても plan には一切触らない
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // A1: 直近の自動追加を取り消す（§10.11.2）。取り消し中もほかの操作は塞がない
  const [undoing, setUndoing] = useState(false);
  // M3（一括生成・§10.12）。plan には成功して確定するまで一切触らない（M2 と同じ倒し方）
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  /** 提案レビューシート（M3-1）。null = 閉じている */
  const [proposals, setProposals] = useState<MenuRecipeDraft[] | null>(null);
  /** #214 の選択シート（M3-5）。null = 閉じている */
  const [pickRows, setPickRows] = useState<ShoppingPlanRow[] | null>(null);
  const [pickRecipeIds, setPickRecipeIds] = useState<Record<string, string>>({});
  // 「組む」直後の結果トースト。レシピが少ないと結果が前回と同じ = 再レンダー差分ゼロで
  // 「壊れた」ように見える（実機 Pixel で確認）ので、組めた/不足を必ず言う
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const load = useCallback(async () => {
    const [next, planned] = await Promise.all([getMenuPlan(mealTime), getStoredMealTimes()]);
    setView(next);
    setPlannedMealTimes(planned);
    setLoaded(true);
  }, [mealTime]);

  const handleUndoAutoAdd = useCallback(async () => {
    setUndoing(true);
    try {
      await undoMenuAutoAddedItems();
    } finally {
      setUndoing(false);
      await load();
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const build = useCallback(async () => {
    setBusy(true);
    setAiError(null);
    try {
      // 置き換わるのは**選択中の時間帯のプランだけ**（§10.13 — 夕を保ったまま昼を組める）
      const next = await generateMenuPlan(days, mealTime);
      setView(next);
      setPlannedMealTimes(await getStoredMealTimes().catch((): MenuMealTime[] => []));
      // 結果を必ず言う（要求どおり組めた / 足りず短くなった）。0 日のときはトーストを
      // 出さない — 画面が「組めませんでした」の空状態に切り替わり、それ自体が答えになる
      if (next && next.days.length > 0) {
        const built = next.days.length;
        const requested = next.plan.requestedDays ?? days;
        setToastMessage(
          built < requested
            ? tCount('menu.buildResult.partial', built)
            : tCount('menu.buildResult.built', built),
        );
        setToastVisible(true);
      }
    } finally {
      setBusy(false);
    }
  }, [days, mealTime]);

  const swap = useCallback(
    async (day: number) => {
      setBusy(true);
      try {
        const result = await replaceMenuDay(day, mealTime);
        if (result.outcome === 'swapped') {
          setView(result.view);
        } else if (result.outcome === 'no-candidates') {
          // 変化ゼロで黙らない（P5 — 押したのに何も起きないのは故障に見える）
          setToastMessage(t('menu.swap.noCandidates'));
          setToastVisible(true);
        }
      } finally {
        setBusy(false);
      }
    },
    [mealTime],
  );

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
      const next = await applyMenuArrangement(result, mealTime);
      if (next) setView(next);
      // 成功時だけ枠を消費（BYOK・プレミアムは内部で no-op・consult と同じ倒し方）
      void recordCloudInference().catch(() => undefined);
      // 並びが変わらなくても必ず言う（P5 — 無言だと「押せていない」と区別できない）
      setToastMessage(t('menu.ai.done'));
      setToastVisible(true);
    } catch (err) {
      setAiError(err instanceof MenuArrangeError ? err.message : t('menu.ai.failed'));
      // plan には触らない — M1（または前回）の並びがそのまま生きている
    } finally {
      setAiRunning(false);
    }
  }, [days, mealTime, router]);

  // M3-5: 献立の不足材料を #214 の選択シートへ（在庫突合・自動では入れない）。
  // 一括生成の確定後と、既存の「足りない材料をまとめて追加」ボタンの両方から入る
  const openShoppingPick = useCallback(async (): Promise<boolean> => {
    // 突合は**表示中のプランだけ**（§10.13 — 複数プラン横断の合算は次版 Issue。
    // 朝の卵＋夜の卵の重複排除にテストが揃うまで踏み込まない）
    const plan = await buildMenuShoppingPlan(mealTime);
    if (!plan || plan.rows.length === 0) {
      setToastMessage(t('menu.shopping.none'));
      setToastVisible(true);
      return false;
    }
    setPickRecipeIds(plan.recipeIdByName);
    setPickRows(plan.rows);
    return true;
  }, [mealTime]);

  const commitShoppingPick = useCallback(
    async (selected: ShoppingPlanRow[]) => {
      setPickRows(null);
      const added = await addMenuShoppingRows(selected, pickRecipeIds).catch(() => 0);
      setToastMessage(
        added > 0
          ? tCount('recipe.detail.shoppingAdded', added)
          : t('recipe.detail.shoppingAllOnList'),
      );
      setToastVisible(true);
    },
    [pickRecipeIds],
  );

  // M3: 不足分レシピの一括生成。1 操作 = LLM 呼び出し 1 回 = 無料枠 1 消費（M3-3）。
  // 失敗・空結果はエラー文言だけ出し、プランには一切触らない（M2 と同じ倒し方）
  const runBulkGenerate = useCallback(async () => {
    const requested = view?.plan.requestedDays;
    const missingDays =
      view && typeof requested === 'number' ? Math.max(0, requested - view.days.length) : 0;
    if (missingDays <= 0 || bulkRunning) return;

    setBulkError(null);
    const gate = await ensureInferenceCredit();
    if (gate === 'paywall') {
      router.push('/recipes/paywall');
      return;
    }
    if (gate !== 'ready') return; // cancelled — 何も変えない

    setBulkRunning(true);
    try {
      const [context, memo] = await Promise.all([buildMenuBulkContext(), getMenuTasteMemo()]);
      if (!context) throw new MenuRecipesError(t('menu.bulk.failed'), true);
      const drafts = await generateMenuRecipes({
        days: missingDays,
        existingTitles: context.existingTitles,
        pantry: context.pantryNames,
        ...(memo ? { preferences: memo } : {}),
        // 時間帯をプロンプトの出し分けに渡す（§10.13）。夕は省略 = サーバー既定
        // （旧クライアントと同じリクエスト形のまま）
        ...(mealTime !== 'dinner' ? { mealTime } : {}),
      });
      if (drafts.length === 0) throw new MenuRecipesError(t('menu.bulk.emptyResult'), true);
      // 成功時だけ枠を消費。一括で 1 回分（M3-3）。BYOK・プレミアムは内部で no-op
      void recordCloudInference().catch(() => undefined);
      setProposals(drafts); // 提案レビューへ（M3-1・自動確定にしない）
    } catch (err) {
      setBulkError(err instanceof MenuRecipesError ? err.message : t('menu.bulk.failed'));
    } finally {
      setBulkRunning(false);
    }
  }, [view, bulkRunning, mealTime, router]);

  // M3-1 の確定: 採用分だけを aiGenerated=true で保存（M3-2・#266 の印を流用）→
  // 献立の空き日に組み込み → #214 の選択シートへ接続（M3-5・自動では入れない）
  const confirmProposals = useCallback(
    async (selected: MenuRecipeDraft[]) => {
      if (selected.length === 0) return;
      setBulkSaving(true);
      try {
        const additions: { recipeId: string; title: string }[] = [];
        for (const draft of selected) {
          const recipeId = await createRecipe({
            title: draft.title,
            ...(draft.description !== undefined && { description: draft.description }),
            ...(draft.servings !== undefined && { servings: draft.servings }),
            ...(draft.cookTimeMin !== undefined && { cookTimeMin: draft.cookTimeMin }),
            ingredients: draft.ingredients.map((ing) => ({
              name: ing.name,
              ...(ing.amount !== undefined && { amount: ing.amount }),
            })),
            steps: draft.steps.map((step) => ({ body: step.body })),
            tags: draft.tags ?? [],
            aiGenerated: true,
          });
          additions.push({ recipeId, title: draft.title });
        }
        setProposals(null);
        const next = await fillMenuPlanShortfall(additions, mealTime);
        if (next) setView(next);
        setToastMessage(tCount('menu.bulk.done', additions.length));
        setToastVisible(true);
        // 買い物リストへは確認ステップ経由（M3-5）。シートが開けば toast はその背後に出る
        await openShoppingPick().catch(() => undefined);
      } catch {
        setBulkError(t('menu.bulk.saveFailed'));
      } finally {
        setBulkSaving(false);
      }
    },
    [mealTime, openShoppingPick],
  );

  if (!loaded) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={Colors.gold} />
      </View>
    );
  }

  const hasPlan = view !== null && view.days.length > 0;
  // 自動モード（§10.11）で組まれたプランだけが anchorDate を持つ。手動プランは日付を持たない
  const isAuto = view?.plan.anchorDate != null;
  const autoAddedCount = view?.plan.autoAddedItemIds?.length ?? 0;
  // 要求日数に届かなかった分。旧データ（requestedDays 未保存）では 0 のまま = バナーは出ない。
  // 0 件時だけでなく **1 件以上でも要求未達なら常に案内を出す**（隆: 中間帯こそ案内が要る）
  const requestedDays = view?.plan.requestedDays;
  const shortfall =
    hasPlan && typeof requestedDays === 'number'
      ? Math.max(0, requestedDays - view.days.length)
      : 0;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <CalendarDays size={20} color={Colors.gold} />
          <Text style={styles.title}>{t('menu.title')}</Text>
          {/* AI が並べ替えた献立だと分かるように（M1/M2 どちらの結果かは source に残す・§10.6）。
            M2 は評価 2 周で F 軸未達のため 1.13.0 では見送り（§10.10.5 の判断ルール・
            docs/eval/menu-rank/2026-08-29-round2-*）。コードは A2/R6 の土台として残す。
            再挑戦時はこの env を立てて評価をやり直す */}
          {MENU_AI_ENABLED && view?.plan.source === 'ai' ? (
            <View style={styles.arrangedBadge}>
              <Text style={styles.arrangedBadgeText}>{t('menu.ai.arrangedBadge')}</Text>
            </View>
          ) : null}
          <View style={styles.headerSpacer} />
          {/* 献立の設定（S21）。通知 → menu → 歯車 → OFF の 3 タップで止められる導線（§10.11.4） */}
          <Pressable
            style={styles.gearButton}
            onPress={() => router.push('/menu-settings')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('menu.auto.settingsButton')}
          >
            <SettingsIcon size={18} color={Colors.goldDim} />
          </Pressable>
        </View>

        {/* 表示中のプランの時間帯（§10.13）。**夕は無印・朝/昼のときだけ表記**（3 対 1 の多数派決定） */}
        {hasPlan && view.plan.mealTime !== 'dinner' ? (
          <Text style={styles.mealTimeNote}>{t(MEAL_TIME_PLAN_LABEL_KEY[view.plan.mealTime])}</Text>
        ) : null}

        {/* 自動モードの出所（§10.11.1）。予約後の在庫変化で嘘にならないよう料理名は載せない */}
        {isAuto && view ? (
          <Text style={styles.autoNote}>
            {t('menu.card.autoGeneratedAt', { time: formatSnapshotTime(view.plan.generatedAt) })}
          </Text>
        ) : null}

        {/* 直近の自動追加を取り消す（§10.11.2）。チェック済みは消さない・消えるのは行だけ */}
        {autoAddedCount > 0 ? (
          <Pressable
            style={[styles.secondary, undoing && styles.disabled]}
            onPress={() => void handleUndoAutoAdd()}
            disabled={undoing}
            accessibilityRole="button"
          >
            <Undo2 size={16} color={Colors.gold} />
            <Text style={styles.secondaryText}>{tCount('menu.auto.undo', autoAddedCount)}</Text>
          </Pressable>
        ) : null}

        {/* 時間帯の選択（§10.13）。既定は夕 — 選ばなければ従来と完全に同じ操作。
          チップは表示の切り替えも兼ねる（時間帯ごとに独立したプラン）。他の時間帯に
          プランがあるチップには控えめなドットを付ける */}
        <Text style={styles.sectionLabel}>{t('menu.mealTime.label')}</Text>
        <View style={styles.dayRow}>
          {MENU_MEAL_TIMES.map((option) => (
            <Pressable
              key={option}
              style={[styles.dayChip, mealTime === option && styles.dayChipActive]}
              onPress={() => setMealTime(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: mealTime === option }}
            >
              <View style={styles.mealTimeChipInner}>
                <Text style={[styles.dayChipText, mealTime === option && styles.dayChipTextActive]}>
                  {t(MEAL_TIME_LABEL_KEY[option])}
                </Text>
                {mealTime !== option && plannedMealTimes.includes(option) ? (
                  <View style={styles.mealTimeDot} />
                ) : null}
              </View>
            </Pressable>
          ))}
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

        {/* M2: AI に並べ替えてもらう。M1 の献立がある前提の 1 操作（§10.7）。
          M2 は評価 2 周で F 軸未達のため 1.13.0 では見送り（§10.10.5 の判断ルール・
          docs/eval/menu-rank/2026-08-29-round2-*）。コードは A2/R6（プレミアム自動モード・
          献立ウィジェット）の土台として残す。再挑戦時はこの env を立てて評価をやり直す */}
        {MENU_AI_ENABLED && hasPlan ? (
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
            <Text style={styles.aiLimitNote}>
              {tCount('menu.ai.limitNote', FREE_MONTHLY_LIMIT)}
            </Text>
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

            {/* 要求日数に届かなかったときのバナー（一覧の末尾に 1 つ・空カードは並べない）。
              主ボタンは M3 の一括生成（§10.12 — 「AI に相談して作る」はここへ吸収）。
              「レシピを追加」は残す（M3 はあくまで提案。手で選びたい人の道を塞がない） */}
            {shortfall > 0 ? (
              <View style={styles.shortfallBanner}>
                <Text style={styles.shortfallText}>
                  {tCount('menu.shortfall.banner', shortfall)}
                </Text>
                <Pressable
                  style={[styles.bulkButton, (bulkRunning || busy) && styles.disabled]}
                  onPress={() => void runBulkGenerate()}
                  disabled={bulkRunning || busy}
                  accessibilityRole="button"
                >
                  {bulkRunning ? (
                    <ActivityIndicator size="small" color={Colors.bg} />
                  ) : (
                    <Wand2 size={16} color={Colors.bg} />
                  )}
                  <Text style={styles.bulkButtonText}>
                    {bulkRunning
                      ? t('menu.bulk.generating')
                      : tCount('menu.shortfall.bulkGenerate', shortfall)}
                  </Text>
                </Pressable>
                {/* 残数は出さない。上限の静的表示だけ（§10.10.4 と同じ判断） */}
                <Text style={styles.aiLimitNote}>
                  {tCount('menu.ai.limitNote', FREE_MONTHLY_LIMIT)}
                </Text>
                {bulkError ? <Text style={styles.bulkErrorText}>{bulkError}</Text> : null}
                <Pressable
                  style={styles.secondary}
                  onPress={() => router.push('/(tabs)/add')}
                  accessibilityRole="button"
                >
                  <Plus size={16} color={Colors.gold} />
                  <Text style={styles.secondaryText}>{t('menu.shortfall.addRecipe')}</Text>
                </Pressable>
              </View>
            ) : null}

            {/* M3-5: #214 の選択シートへ（在庫突合・自動では入れない）。以前は /shopping へ
              遷移するだけで実際には何も追加していなかった — ラベルどおりの挙動に接続 */}
            <Pressable
              style={styles.secondary}
              onPress={() => void openShoppingPick()}
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

      {/* M3-1: 提案レビュー。1 品ずつ採用/却下・既定は全採用・ワンタップ確定 */}
      <MenuRecipeProposalSheet
        visible={proposals !== null}
        drafts={proposals ?? []}
        busy={bulkSaving}
        onCancel={() => setProposals(null)}
        onConfirm={(selected) => void confirmProposals(selected)}
      />

      {/* M3-5: #214 の選択シート（在庫突合）。確定後・「まとめて追加」ボタンの両方から */}
      <ShoppingPickSheet
        visible={pickRows !== null}
        rows={pickRows ?? []}
        onCancel={() => setPickRows(null)}
        onConfirm={(selected) => void commitShoppingPick(selected)}
      />

      {/* 「組む」直後の結果トースト（数秒で消える）。ScrollView の外 = 画面に対して固定 */}
      <Toast
        message={toastMessage}
        visible={toastVisible}
        onDismiss={() => setToastVisible(false)}
      />
    </View>
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
  scroll: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  // paddingTop は他の href:null 画面（family.tsx・menu-settings.tsx 等）と同じ 58
  // （ステータスバー分の余白。この画面だけ抜けていてタイトルと時計が重なっていた）
  content: { paddingHorizontal: 16, paddingTop: 58, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '500', color: Colors.paper, letterSpacing: 0.5 },
  headerSpacer: { flex: 1 },
  gearButton: { padding: 4 },
  autoNote: { fontSize: 12, color: Colors.muted, marginBottom: 16 },
  // 朝/昼のときだけ出す控えめな表記（§10.13。夕は無印）
  mealTimeNote: { fontSize: 13, color: Colors.goldDim, marginBottom: 8 },
  mealTimeChipInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  // 他の時間帯にプランがあることを示す控えめなドット
  mealTimeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.gold },
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
  // 不足バナー。空カードの代わりに 1 つだけ（枠は staleBar と同じ控えめな線）
  shortfallBanner: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  shortfallText: { fontSize: 14, color: Colors.muted },
  // M3: 一括生成の主ボタン（バナー内。塗りは「組む」と同じ gold = 主導線であることを示す）
  bulkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 10,
    marginBottom: 6,
  },
  bulkButtonText: { fontSize: 14, color: Colors.bg, fontWeight: '600' },
  bulkErrorText: { fontSize: 13, color: Colors.muted, marginTop: 6 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyTitle: { fontSize: 15, color: Colors.paper },
  emptyBody: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
});

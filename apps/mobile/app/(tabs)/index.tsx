/**
 * S01: Home / Timeline screen
 * Shows the want-to-cook shelf (pinned recipes), monthly stats, and recent
 * cooking logs with filter tabs
 */
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Bookmark,
  CalendarDays,
  Camera,
  ChefHat,
  LayoutGrid,
  MessagesSquare,
  Settings as SettingsIcon,
  Store,
  Trash2,
  X,
} from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { CoachMarkOverlay } from '../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../src/components/HelpButton';
import { EmptyState } from '../../src/components/EmptyState';
import { Loading } from '../../src/components/Loading';
import { MonthlyStats } from '../../src/components/MonthlyStats';
import { PressableScale } from '../../src/components/PressableScale';
import { Stars } from '../../src/components/Stars';
import { Colors } from '../../src/constants/theme';
import { useCoachMarks } from '../../src/hooks/useCoachMarks';
import { useSyncRefresh } from '../../src/hooks/useSyncRefresh';
import { t, tCount } from '../../src/i18n';
import { getMenuPlan } from '../../src/services/menu-plan.service';
import { formatMonthDay, formatMonthLabel } from '../../src/i18n/format';
import { deleteCookingLog } from '../../src/services/cooking-log.service';
import { dialog } from '../../src/services/dialog.service';
import { getInStockNormalizedNames } from '../../src/services/pantry.service';
import { getWantToCookRecipes } from '../../src/services/recipe.service';
import { getTimeline } from '../../src/services/timeline.service';
import type { RecipeListItem, TimelineEntry } from '../../src/services/types';
import { useCookingSessionStore } from '../../src/stores/cooking-session.store';
import { formatProfileDisplayName } from '../../src/utils/profile';
import { computeMonthlyStats } from '../../src/utils/timelineStats';
import { formatSnapshotTime } from '../../src/utils/widgetSnapshot';

type FilterTab = 'week' | 'month' | 'all';

const FILTER_TABS: readonly FilterTab[] = ['week', 'month', 'all'];

// **モジュール定数にしない。** import 時のロケールで文言が固定され、
// 起動時の言語判定より前に読まれると日本語のまま残る
function filterLabel(tab: FilterTab): string {
  if (tab === 'week') return t('home.filter.week');
  if (tab === 'month') return t('home.filter.month');
  return t('home.filter.all');
}

/**
 * 空のときの見出し。**`${期間}の記録がありません` のようにラベルを差し込まない。**
 * 日本語は「の」で繋がるが、英語は "Week's records not found" になって壊れる。
 */
function emptyTitle(filter: FilterTab): string {
  if (filter === 'all') return t('home.empty.allTitle');
  if (filter === 'week') return t('home.empty.weekTitle');
  return t('home.empty.monthTitle');
}

function formatDate(isoDate: string): string {
  return formatMonthDay(new Date(isoDate));
}

function getFilterDate(filter: FilterTab): Date | null {
  const now = new Date();
  if (filter === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return weekAgo;
  }
  if (filter === 'month') {
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    return monthAgo;
  }
  return null;
}

export default function HomeScreen() {
  const router = useRouter();
  const cookingSession = useCookingSessionStore((state) => state.session);
  const [allEntries, setAllEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 初回利用ガイド（コーチマーク）
  const cartRef = useRef<View>(null);
  const fabRef = useRef<View>(null);
  const coach = useCoachMarks(
    'home',
    [
      {
        key: 'fab',
        title: t('home.coach.fabTitle'),
        text: t('home.coach.fabText'),
        ref: fabRef,
      },
      {
        key: 'cart',
        title: t('home.coach.cartTitle'),
        text: t('home.coach.cartText'),
        ref: cartRef,
      },
    ],
    !loading && !selectMode,
  );

  const [wantList, setWantList] = useState<RecipeListItem[]>([]);
  /**
   * 在庫に何か入っているか。**入っているときだけ**「在庫で作れるレシピ」を出す。
   * 在庫を使っていない人のホームは変えない（0 件のときに出しても押した先が空になるだけ）。
   */
  const [hasStock, setHasStock] = useState(false);
  /**
   * 献立の「次の一品」（#215）。まだ作っていない最初の日のレシピ名。
   * 献立が無ければ null で、カードは組む導線だけを出す。
   * **`anchorDate` があるときだけ「今日」と言える**（§10.11）——自動モードで
   * 組まれたプランだけが持つ。手動プランは日付を持たないので「次の一品」のまま
   */
  const [nextMenuTitle, setNextMenuTitle] = useState<string | null>(null);
  const [menuIsToday, setMenuIsToday] = useState(false);
  /** 自動モードのときだけ出す出所（「今朝 HH:MM に自動で組みました」）。手動プランでは null */
  const [menuGeneratedAt, setMenuGeneratedAt] = useState<string | null>(null);

  const loadTimeline = useCallback(async () => {
    const [entries, want, inStock, menu] = await Promise.all([
      getTimeline(),
      getWantToCookRecipes(),
      getInStockNormalizedNames().catch((): string[] => []),
      getMenuPlan().catch(() => null),
    ]);
    setAllEntries(entries);
    setWantList(want);
    setHasStock(inStock.length > 0);
    // まだ作っていない最初の日。削除されたレシピの日は飛ばす
    const next = menu?.days.find((d) => d.doneAt === null && !d.missing) ?? null;
    setNextMenuTitle(next ? next.title : null);
    const isAuto = menu?.plan.anchorDate != null;
    setMenuIsToday(isAuto);
    setMenuGeneratedAt(isAuto ? (menu?.plan.generatedAt ?? null) : null);
    setLoading(false);
  }, []);

  const entries = useMemo(() => {
    const filterDate = getFilterDate(filter);
    return filterDate ? allEntries.filter((l) => new Date(l.cookedAt) >= filterDate) : allEntries;
  }, [allEntries, filter]);

  const monthlyStats = useMemo(() => computeMonthlyStats(allEntries), [allEntries]);
  const monthLabel = formatMonthLabel(new Date());

  let menuCardLabel = t('menu.title');
  if (nextMenuTitle)
    menuCardLabel = menuIsToday ? t('menu.card.todayTitle') : t('menu.card.nextTitle');

  useFocusEffect(
    useCallback(() => {
      void loadTimeline();
    }, [loadTimeline]),
  );

  // ホームを開いたまま家族の変更が届いたときに読み直す（クラウド同期 S1）
  useSyncRefresh(
    useCallback(() => {
      void loadTimeline();
    }, [loadTimeline]),
  );

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(entries.map((entry) => entry.id)));
  }, [entries]);

  const handleBulkDelete = useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;

    const confirmed = await dialog.confirm({
      title: t('home.delete.title'),
      message: tCount('home.delete.confirm', count),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    await Promise.all([...selectedIds].map((id) => deleteCookingLog(id)));
    exitSelectMode();
    await loadTimeline();
  }, [selectedIds, exitSelectMode, loadTimeline]);

  const renderItem = ({ item, index }: { item: TimelineEntry; index: number }) => {
    const showDateHeader =
      index === 0 || formatDate(entries[index - 1].cookedAt) !== formatDate(item.cookedAt);
    const isSelected = selectedIds.has(item.id);
    const userName = formatProfileDisplayName(item.userName);

    return (
      <View>
        {showDateHeader && <Text style={styles.dateHeader}>{formatDate(item.cookedAt)}</Text>}
        <PressableScale
          style={[styles.card, isSelected && styles.cardSelected]}
          onPress={() => {
            if (selectMode) {
              toggleSelect(item.id);
            } else if (item.recipeId) {
              router.push(`/(tabs)/recipes/${item.recipeId}`);
            }
          }}
          onLongPress={() => {
            if (!selectMode) {
              setSelectMode(true);
              setSelectedIds(new Set([item.id]));
            }
          }}
        >
          {selectMode && (
            <View style={[styles.checkBadge, isSelected && styles.checkBadgeSelected]}>
              {isSelected && <Text style={styles.checkMark}>✓</Text>}
            </View>
          )}
          <View style={styles.cardRow}>
            {item.photos.length > 0 && (
              <Image
                source={{ uri: item.photos[0].cloudUrl ?? item.photos[0].localPath }}
                style={styles.thumbnail}
              />
            )}
            <View style={styles.cardContent}>
              <View style={styles.cardHeader}>
                <Text style={styles.recipeTitle} numberOfLines={1}>
                  {item.recipeTitle}
                </Text>
                {item.rating != null && <Stars rating={item.rating} size={12} />}
              </View>
              <View style={styles.cardUser}>
                <Avatar name={userName} size={22} />
                <Text style={styles.userName}>{userName}</Text>
                {item.kind === 'eaten_out' && (
                  <View style={styles.eatenOutBadge}>
                    <Store size={10} color={Colors.goldDim} />
                    <Text style={styles.eatenOutText} numberOfLines={1}>
                      {item.placeName ? item.placeName : t('log.kind.eatenOut')}
                    </Text>
                  </View>
                )}
              </View>
              {item.memo ? (
                <Text style={styles.memo} numberOfLines={1}>
                  &quot;{item.memo}&quot;
                </Text>
              ) : null}
            </View>
          </View>
        </PressableScale>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {selectMode ? (
        <View style={styles.selectHeader}>
          <Pressable style={styles.selectCancelBtn} onPress={exitSelectMode}>
            <X size={18} color={Colors.paper} />
          </Pressable>
          <Text style={styles.selectCount}>{tCount('home.select.count', selectedIds.size)}</Text>
          <Pressable style={styles.selectAllBtn} onPress={handleSelectAll}>
            <Text style={styles.selectAllText}>{t('home.select.all')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.filterBar}>
          <View style={styles.tabs}>
            {FILTER_TABS.map((key) => (
              <Pressable key={key} onPress={() => setFilter(key)}>
                <Text style={[styles.tab, filter === key ? styles.tabActive : styles.tabInactive]}>
                  {filterLabel(key)}
                </Text>
                {filter === key && <View style={styles.tabIndicator} />}
              </Pressable>
            ))}
          </View>
          {/* 無ラベルのアイコン4つはカート以外ほぼ発見されていなかった（R5 問題6）。
              小さくてもラベルを添えると何なのかが分かる */}
          <View style={styles.headerActions}>
            <Pressable
              style={styles.headerAction}
              onPress={() => router.push('/calendar')}
              hitSlop={8}
              accessibilityLabel={t('home.action.calendar')}
            >
              <CalendarDays size={18} color={Colors.goldDim} />
              <Text style={styles.headerActionLabel}>{t('home.action.calendarLabel')}</Text>
            </Pressable>
            <Pressable
              style={styles.headerAction}
              onPress={() => router.push('/gallery')}
              hitSlop={8}
              accessibilityLabel={t('home.action.gallery')}
            >
              <LayoutGrid size={18} color={Colors.goldDim} />
              <Text style={styles.headerActionLabel}>{t('home.action.galleryLabel')}</Text>
            </Pressable>
            {/* 買い物はボトムタブへ出したので、ここは重複。空いた枠に設定を置く
                （設定はタブから降ろした — 滅多に開かないのに下端の一等地にあった） */}
            <Pressable
              ref={cartRef}
              collapsable={false}
              style={styles.headerAction}
              onPress={() => router.push('/(tabs)/settings')}
              hitSlop={8}
              accessibilityLabel={t('home.action.settings')}
            >
              <SettingsIcon size={18} color={Colors.goldDim} />
              <Text style={styles.headerActionLabel}>{t('home.action.settingsLabel')}</Text>
            </Pressable>
            <View style={styles.headerAction}>
              <HelpButton onPress={coach.show} size={18} />
              <Text style={styles.headerActionLabel}>{t('home.action.helpLabel')}</Text>
            </View>
          </View>
        </View>
      )}

      {loading ? (
        <Loading message={t('home.loading')} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            selectMode && styles.listWithActionBar,
            entries.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            !selectMode ? (
              <View>
                {/* 調理中の復帰カード。✕ で閉じてもここから続きへ戻れる
                    （Now Cooking バーと同じセッションを見る二重の入口 —
                    ホームに戻ってきた人が最初に目にする場所なので独立に置く）。
                    **献立カードより上**に置く: 調理中は「いま火にかけている」が最優先で、
                    献立は次に作るものの話。調理していないときは出ないので、
                    平常時のホームの主役は下の献立カードのまま変わらない */}
                {cookingSession && (
                  <PressableScale
                    style={styles.resumeCard}
                    scaleTo={0.98}
                    onPress={() => router.push(`/(tabs)/recipes/${cookingSession.recipeId}/cook`)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('recipe.cook.resumeLabel')}: ${cookingSession.recipeTitle}`}
                  >
                    <ChefHat size={18} color={Colors.bg} />
                    <View style={styles.resumeTextBlock}>
                      <Text style={styles.resumeTitle} numberOfLines={1}>
                        {cookingSession.recipeTitle}
                      </Text>
                      <Text style={styles.resumeStep}>
                        {t('recipe.cook.resumeStep', {
                          step: cookingSession.stepIndex + 1,
                          total: cookingSession.totalSteps,
                        })}
                      </Text>
                    </View>
                    <Text style={styles.resumeAction}>{t('recipe.cook.resumeAction')} →</Text>
                  </PressableScale>
                )}

                {/* 献立カード（#215・決定変更 A/B・2026-08-28）。
                    ここが献立の**主入口**。「献立」は実検索語で、検索で来た人が
                    4 番目のタブを開かないと気づけないのは #182 の再演になる。
                    自動モード（§10.11）が入るまでは日付を持たないので「次の一品」と言う。
                    献立が無いときは組む導線だけを出す（勝手に組まない・§10.7） */}
                <PressableScale
                  style={styles.menuCard}
                  scaleTo={0.98}
                  onPress={() => router.push('/(tabs)/menu')}
                  accessibilityRole="button"
                  accessibilityLabel={t('menu.title')}
                >
                  <View style={styles.menuCardHead}>
                    <CalendarDays size={16} color={Colors.gold} />
                    <Text style={styles.menuCardLabel}>{menuCardLabel}</Text>
                  </View>
                  <Text style={styles.menuCardBody}>{nextMenuTitle ?? t('menu.card.empty')}</Text>
                  {/* 自動モードの出所。予約後の在庫変化で嘘にならないよう料理名は載せない（§10.11.1） */}
                  {menuIsToday && menuGeneratedAt ? (
                    <Text style={styles.menuCardMeta}>
                      {t('menu.card.autoGeneratedAt', {
                        time: formatSnapshotTime(menuGeneratedAt),
                      })}
                    </Text>
                  ) : null}
                </PressableScale>

                {/* 主役への直行。FAB（＋ → 追加方法選択）は残すが、写真からレシピだけは
                    1タップで届かせる（`docs/お店の味を再現設計.md` §4.3 問題2） */}
                <PressableScale
                  style={styles.captureButton}
                  scaleTo={0.98}
                  onPress={() => router.push('/(tabs)/recipes/import-photo')}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.capture')}
                >
                  <Camera size={20} color={Colors.bg} />
                  <Text style={styles.captureText}>{t('home.capture')}</Text>
                </PressableScale>

                {/* もう 1 本の入口。撮るのは「料理が目の前にある」とき、
                    相談は「まだ料理が無い」とき。主役を薄めないよう、
                    こちらは輪郭だけの控えめな見た目にする */}
                <PressableScale
                  style={styles.consultButton}
                  scaleTo={0.98}
                  onPress={() => router.push('/(tabs)/recipes/consult')}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.consult')}
                >
                  <MessagesSquare size={18} color={Colors.paperDim} />
                  <Text style={styles.consultText}>{t('home.consult')}</Text>
                </PressableScale>

                {/* 在庫ループ（在庫 → 作れるレシピ → 足りない材料 → 買い物リスト）の入口。
                    在庫タブを開かないと存在に気づけなかったので、**在庫に何か入っている
                    ときだけ**ホームからも直行させる（2026-08-21 の導線確認） */}
                {hasStock && (
                  <PressableScale
                    style={styles.consultButton}
                    scaleTo={0.98}
                    onPress={() => router.push('/(tabs)/cookable')}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.cookable')}
                  >
                    <ChefHat size={18} color={Colors.paperDim} />
                    <Text style={styles.consultText}>{t('home.cookable')}</Text>
                  </PressableScale>
                )}

                {wantList.length > 0 && (
                  <View style={styles.wantSection}>
                    <View style={styles.wantHeader}>
                      <Bookmark size={13} color={Colors.goldDim} fill={Colors.goldDim} />
                      {/* 主役が再現ループになったので「再現したい」。データは pinned_at のまま */}
                      <Text style={styles.wantTitle}>{t('home.wantTitle')}</Text>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.wantRow}
                    >
                      {wantList.map((recipe) => (
                        <PressableScale
                          key={recipe.id}
                          style={styles.wantCard}
                          onPress={() => router.push(`/(tabs)/recipes/${recipe.id}`)}
                        >
                          {recipe.heroPhotoUri ? (
                            <Image source={{ uri: recipe.heroPhotoUri }} style={styles.wantThumb} />
                          ) : (
                            <View style={[styles.wantThumb, styles.wantThumbPlaceholder]}>
                              <Text style={styles.wantEmoji}>🍽️</Text>
                            </View>
                          )}
                          <Text style={styles.wantCardTitle} numberOfLines={2}>
                            {recipe.title}
                          </Text>
                        </PressableScale>
                      ))}
                    </ScrollView>
                  </View>
                )}
                {monthlyStats.count > 0 && (
                  <MonthlyStats stats={monthlyStats} monthLabel={monthLabel} />
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            // 初回の第一印象であり、最大の広告面。**空のときこそ主役を語る**
            // （`docs/お店の味を再現設計.md` §4.3 問題5）
            <EmptyState
              // 🏪 はコンビニに見えて「お店で食べた味」と合わない（実機で確認）。
              // 提灯なら外で食べる店の記号として通じる
              icon={filter === 'all' ? '🏮' : '🗓'}
              title={emptyTitle(filter)}
              message={
                filter === 'all' ? t('home.empty.allMessage') : t('home.empty.filteredMessage')
              }
              actionLabel={filter === 'all' ? t('home.capture') : undefined}
              onAction={
                filter === 'all' ? () => router.push('/(tabs)/recipes/import-photo') : undefined
              }
            />
          }
        />
      )}

      {selectMode ? (
        <View style={styles.actionBar}>
          <Pressable
            style={[
              styles.actionBtn,
              styles.actionBtnDelete,
              selectedIds.size === 0 && styles.actionBtnDisabled,
            ]}
            onPress={() => void handleBulkDelete()}
            disabled={selectedIds.size === 0}
          >
            <Trash2 size={16} color={selectedIds.size === 0 ? Colors.muted : Colors.bg} />
            <Text
              style={[styles.actionBtnText, selectedIds.size === 0 && styles.actionBtnTextDisabled]}
            >
              {t('common.delete')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View ref={fabRef} collapsable={false} style={styles.fabContainer}>
          <PressableScale
            style={styles.fab}
            scaleTo={0.9}
            onPress={() => router.push('/(tabs)/add')}
          >
            <Text style={styles.fabText}>＋</Text>
          </PressableScale>
        </View>
      )}

      <CoachMarkOverlay
        visible={coach.visible}
        step={coach.step}
        index={coach.index}
        total={coach.total}
        onNext={coach.next}
        onSkip={coach.skip}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  menuCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: Colors.bgCard,
  },
  menuCardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  menuCardLabel: { fontSize: 12, color: Colors.gold, letterSpacing: 0.5 },
  menuCardBody: { fontSize: 15, color: Colors.paper, lineHeight: 21 },
  menuCardMeta: { fontSize: 11, color: Colors.muted, marginTop: 4 },
  eatenOutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 140,
  },
  eatenOutText: {
    fontSize: 10,
    color: Colors.goldDim,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingBottom: 4,
  },
  headerAction: {
    alignItems: 'center',
    gap: 2,
  },
  headerActionLabel: {
    fontSize: 9,
    fontWeight: '400',
    color: Colors.muted,
    letterSpacing: 0.5,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    paddingBottom: 8,
    fontSize: 13, // sm: フィルタータブ
    fontWeight: '400',
  },
  tabActive: {
    color: Colors.gold,
  },
  tabInactive: {
    color: Colors.muted,
  },
  tabIndicator: {
    height: 2,
    backgroundColor: Colors.gold,
    marginTop: -1,
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 80,
  },
  listWithActionBar: {
    paddingBottom: 104,
  },
  listEmpty: {
    flexGrow: 1,
  },
  dateHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
    fontSize: 12, // xs: タイムスタンプ・日付ヘッダー
    color: Colors.paperDim,
    letterSpacing: 2,
  },
  resumeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  resumeTextBlock: { flex: 1 },
  resumeTitle: { color: Colors.bg, fontSize: 14, fontWeight: '700' },
  resumeStep: { color: Colors.bg, fontSize: 11, opacity: 0.75 },
  resumeAction: { color: Colors.bg, fontSize: 12, fontWeight: '600', flexShrink: 0 },
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 15,
    marginTop: 14,
    marginBottom: 4,
  },
  consultButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 8,
    marginBottom: 4,
  },
  consultText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.paperDim,
    letterSpacing: 0.5,
  },
  captureText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
    letterSpacing: 1,
  },
  wantSection: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  wantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  wantTitle: {
    fontSize: 12, // xs: セクション見出し
    color: Colors.goldDim,
    letterSpacing: 2,
  },
  wantRow: {
    paddingHorizontal: 16,
    gap: 10,
  },
  wantCard: {
    width: 108,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 8,
    gap: 6,
  },
  wantThumb: {
    width: '100%',
    height: 64,
    borderRadius: 6,
    backgroundColor: '#1A1108',
  },
  wantThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wantEmoji: {
    fontSize: 26,
  },
  wantCardTitle: {
    fontSize: 12, // xs: カードタイトル（コンパクト）
    fontWeight: '400',
    color: Colors.paper,
    lineHeight: 16,
  },
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 14,
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardSelected: {
    borderColor: Colors.gold,
    borderWidth: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#1A1108',
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.muted,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadgeSelected: {
    borderColor: Colors.gold,
    backgroundColor: Colors.gold,
  },
  checkMark: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.bg,
    lineHeight: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recipeTitle: {
    color: Colors.paper,
    fontSize: 15, // base: カードタイトル
    fontWeight: '500',
  },
  cardUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  userName: {
    fontSize: 13, // sm: ユーザー名
    color: Colors.paperDim,
    fontWeight: '400',
  },
  memo: {
    fontSize: 13, // sm: メモ
    color: Colors.goldDim,
    fontStyle: 'italic',
    marginTop: 2,
  },
  selectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  selectCancelBtn: {
    padding: 4,
  },
  selectCount: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.paper,
  },
  selectAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 12,
    paddingBottom: 28,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionBtnDelete: {
    backgroundColor: '#7A1F1F',
  },
  actionBtnDisabled: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.bg,
  },
  actionBtnTextDisabled: {
    color: Colors.muted,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  fabText: {
    fontSize: 24,
    color: Colors.bg,
  },
});

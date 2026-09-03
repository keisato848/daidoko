/**
 * S05: Recipe Detail screen
 * Hero image, meta info, tabs (ingredients/steps/memo/history), cooking start CTA
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Bookmark,
  ChevronLeft,
  ClipboardCheck,
  MoreVertical,
  ShoppingCart,
  Store,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { Avatar } from '../../../src/components/Avatar';
import { PhotoViewer } from '../../../src/components/PhotoViewer';
import { ShareSheet } from '../../../src/components/ShareSheet';
import { ShoppingPickSheet } from '../../../src/components/ShoppingPickSheet';
import { CoachMarkOverlay } from '../../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../../src/components/HelpButton';
import { EmptyState } from '../../../src/components/EmptyState';
import { Loading } from '../../../src/components/Loading';
import { NumberStepper } from '../../../src/components/NumberStepper';
import { PressableScale } from '../../../src/components/PressableScale';
import { Stars } from '../../../src/components/Stars';
import { TagChip } from '../../../src/components/TagChip';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { useCoachMarks } from '../../../src/hooks/useCoachMarks';
import { t, tCount } from '../../../src/i18n';
import { canSkipSelection, type ShoppingPlanRow } from '../../../src/utils/shoppingPlan';
import { getLogsForRecipe } from '../../../src/services/cooking-log.service';
import { dialog } from '../../../src/services/dialog.service';
import { getStoredCredentials } from '../../../src/services/sync-client.service';
import {
  addSelectedIngredientsToList,
  buildRecipeShoppingPlan,
} from '../../../src/services/shopping-list.service';
import {
  deleteRecipe,
  getMemosForRecipe,
  getRecipeDetail,
  setRecipePinned,
  setStepPhoto,
} from '../../../src/services/recipe.service';
import type { MemoItem, RecipeDetail, TimelineEntry } from '../../../src/services/types';
import { PhotoPickerField } from '../../../src/components/PhotoPickerField';
import { isNativePlatform } from '../../../src/db/client';
import {
  getShareBlockReason,
  getWebShare,
  publishRecipeToWeb,
  renewWebShare,
  revokeWebShare,
  type WebShareRecord,
} from '../../../src/services/web-share.service';
import { formatProfileDisplayName } from '../../../src/utils/profile';
import { formatRecipeShareText } from '../../../src/utils/recipeShareText';
import { scaleAmount, servingRatio } from '../../../src/utils/shoppingScale';
import { useUnitSystemStore } from '../../../src/stores/unitSystem.store';
import {
  convertAmountForDisplay,
  convertTemperaturesForDisplay,
} from '../../../src/utils/unitSystem';
import { getRecipeEmoji } from '../../../src/utils/recipeEmoji';

type TabKey = 'ingredients' | 'steps' | 'memo' | 'history';

// **ラベルは定数に焼き付けない。** import 時のロケールで固定される
const TAB_KEYS: readonly TabKey[] = ['ingredients', 'steps', 'memo', 'history'];

function tabLabel(key: TabKey): string {
  if (key === 'ingredients') return t('recipe.detail.tab.ingredients');
  if (key === 'steps') return t('recipe.detail.tab.steps');
  if (key === 'memo') return t('recipe.detail.tab.memo');
  return t('recipe.detail.tab.history');
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('ingredients');
  const [showMenu, setShowMenu] = useState(false);
  // タブは水平スワイプでも切り替わる。ページ幅は実測（回転・分割画面に追従）し、
  // 初回フレームだけウィンドウ幅を使う
  const { width: windowWidth } = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(windowWidth);
  const pagerRef = useRef<ScrollView>(null);
  const [cookingLogs, setCookingLogs] = useState<TimelineEntry[]>([]);
  const [memos, setMemos] = useState<MemoItem[]>([]);
  // Web 共有（docs/Web共有設計.md）。判定が終わるまではメニューに出さない
  const [webShare, setWebShare] = useState<WebShareRecord | null>(null);
  const [webShareBlocked, setWebShareBlocked] = useState(true);
  const [webSharePublishing, setWebSharePublishing] = useState(false);
  // 統一共有シート（docs/共有設計.md §3-2）。共有アクションはメニューからここへ集約
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [familyJoined, setFamilyJoined] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  /** 全画面で見ている写真。null = 閉じている。一覧・詳細は cover で切っているので逃げ道を置く */
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  /** 選択シートの中身。null = 出さない（#214） */
  const [pickRows, setPickRows] = useState<readonly ShoppingPlanRow[] | null>(null);
  // 分量換算のターゲット人数（undefined = レシピの基準人数のまま）
  const [targetServings, setTargetServings] = useState<number | undefined>(undefined);
  const unitSystem = useUnitSystemStore((state) => state.system);

  const loadRecipe = useCallback(async () => {
    if (!id) {
      setRecipe(null);
      setIsLoading(false);
      return;
    }
    // 初回のみローディング表示（編集から戻ったときは静かに再取得）
    setRecipe(await getRecipeDetail(id));
    setIsLoading(false);
  }, [id]);

  const loadLogs = useCallback(async () => {
    if (!id) return;
    setCookingLogs(await getLogsForRecipe(id));
  }, [id]);

  const loadMemos = useCallback(async () => {
    if (!id) return;
    setMemos(await getMemosForRecipe(id));
  }, [id]);

  const loadWebShareState = useCallback(async () => {
    if (!id) return;
    const [blockReason, record, credentials] = await Promise.all([
      getShareBlockReason(id),
      getWebShare(id),
      getStoredCredentials().catch(() => null),
    ]);
    setWebShareBlocked(blockReason != null);
    setWebShare(record);
    setFamilyJoined(credentials !== null);
  }, [id]);

  // 編集モーダルから戻ったときも最新を表示するためフォーカス毎に再取得。
  // メモ・履歴も一緒に取る: スワイプ中は隣のタブが見えるので、
  // タブが切り替わってから読み込むのでは間に合わない
  useFocusEffect(
    useCallback(() => {
      void loadRecipe();
      void loadMemos();
      void loadLogs();
      void loadWebShareState();
    }, [loadRecipe, loadMemos, loadLogs, loadWebShareState]),
  );

  // 初回利用ガイド（コーチマーク）
  const cookRef = useRef<View>(null);
  const missingRef = useRef<View>(null);
  const menuRef = useRef<View>(null);
  const logShortcutRef = useRef<View>(null);
  // 4 枚あったが、初回に連続で出てまとめてスキップされていた（R5 問題4）。
  // 再現ループの2歩目（作る）と3歩目（近づける）に絞る。買い物リスト追加と
  // メニューは画面上に見えているので、案内が無くても辿り着ける
  const coach = useCoachMarks(
    'recipe-detail',
    [
      {
        key: 'cook',
        title: t('recipe.detail.coach.cookTitle'),
        text: t('recipe.detail.coach.cookText'),
        ref: cookRef,
      },
      {
        key: 'logShortcut',
        title: t('recipe.detail.coach.logTitle'),
        text: t('recipe.detail.coach.logText'),
        ref: logShortcutRef,
      },
    ],
    recipe != null && tab === 'ingredients' && !showMenu,
  );

  // --- タブ切り替え（タップとスワイプの2経路を1か所に集約） ---

  const goToTab = useCallback(
    (key: TabKey) => {
      setTab(key);
      const index = TAB_KEYS.indexOf(key);
      pagerRef.current?.scrollTo({ x: index * pageWidth, animated: true });
    },
    [pageWidth],
  );

  const handlePagerScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth <= 0) return;
      const key = TAB_KEYS[Math.round(event.nativeEvent.contentOffset.x / pageWidth)];
      if (key) setTab(key);
    },
    [pageWidth],
  );

  // 幅が変わったとき（回転・分割画面）に表示中のタブへ位置を戻す。
  // tab を依存に入れるとタップ時のアニメーションを打ち消してしまうので ref で読む
  const currentTabRef = useRef<TabKey>(tab);
  useEffect(() => {
    currentTabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    const index = TAB_KEYS.indexOf(currentTabRef.current);
    pagerRef.current?.scrollTo({ x: index * pageWidth, animated: false });
  }, [pageWidth]);

  // 作りたいリスト（ホームに表示）へのピン留めトグル
  const handleTogglePin = async () => {
    if (!recipe) return;
    await setRecipePinned(recipe.id, recipe.pinnedAt == null);
    await loadRecipe();
  };

  // テキスト共有（取り込みパーサと往復できる書式 — 相手はテキスト取り込みで登録可能）
  const handleShare = async () => {
    if (!recipe) return;
    try {
      await Share.share({ message: formatRecipeShareText(recipe) });
    } catch {
      // 共有シートのキャンセルは無視
    }
  };

  // Web 共有（アプリなしでも読めるページ。docs/Web共有設計.md）
  const doWebSharePublish = async () => {
    if (!recipe || webSharePublishing) return;
    setWebSharePublishing(true);
    try {
      const record = await publishRecipeToWeb(recipe);
      setWebShare(record);
      try {
        await Share.share({ message: `${recipe.title}\n${record.url}` });
      } catch {
        // 共有シートのキャンセルは無視（リンクは発行済み — メニューから再共有できる）
      }
    } catch {
      void dialog.alert({
        title: t('recipe.detail.webShare.failedTitle'),
        message: t('recipe.detail.webShare.publishFailedBody'),
      });
    } finally {
      setWebSharePublishing(false);
    }
  };

  const handleWebShare = async () => {
    if (!recipe) return;
    if (webShare) {
      // 発行済み — 受け取り期限を張り直して（§3-6・ベストエフォート）再共有する
      if (id) void renewWebShare(id);
      try {
        await Share.share({ message: `${recipe.title}\n${webShare.url}` });
      } catch {
        // キャンセルは無視
      }
      return;
    }
    // 権利面の確認（出所ゲートを通ったレシピにも、テキスト取り込み等の
    // 出所不明分があるため必ず挟む — docs/Web共有設計.md §2-2）
    const attested = await dialog.confirm({
      title: t('recipe.detail.webShare.attestTitle'),
      message: t('recipe.detail.webShare.attestBody'),
      confirmLabel: t('recipe.detail.webShare.attestOk'),
    });
    if (attested) await doWebSharePublish();
  };

  const handleWebShareStop = async () => {
    if (!id) return;
    const confirmed = await dialog.confirm({
      title: t('recipe.detail.webShare.stopTitle'),
      message: t('recipe.detail.webShare.stopConfirm'),
      confirmLabel: t('recipe.detail.webShare.stopAction'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await revokeWebShare(id);
      setWebShare(null);
      // 画面に留まる純粋な成功なのでトーストで済ませる（docs/画面設計.md §7-1）
      setToastMessage(t('recipe.detail.webShare.stopDoneBody'));
    } catch {
      void dialog.alert({
        title: t('recipe.detail.webShare.failedTitle'),
        message: t('recipe.detail.webShare.stopFailedBody'),
      });
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    const confirmed = await dialog.confirm({
      title: t('recipe.detail.deleteTitle'),
      message: t('recipe.detail.deleteConfirm'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteRecipe(id);
      router.replace('/(tabs)/recipes');
    } catch {
      void dialog.alert({
        title: t('recipe.detail.deleteFailedTitle'),
        message: t('recipe.detail.deleteFailedBody'),
      });
    }
  };

  /**
   * 材料を買い物リストへ（#214）。
   *
   * **除外が出たときだけシートを出す。** 全部足りないなら今までどおり 1 タップで入る。
   * 在庫にある材料を黙って消すと「なぜ卵が入らなかったのか」が分からず、
   * 卵が 1 個しか無いのに 3 個要る場面で行き止まりになる。
   */
  const handleAddMissingToList = async () => {
    if (!recipe) return;
    const plan = await buildRecipeShoppingPlan(recipe.id);
    if (plan.length === 0) return;
    if (canSkipSelection(plan)) {
      await commitShoppingSelection(plan);
      return;
    }
    setPickRows(plan);
  };

  const commitShoppingSelection = async (rows: ShoppingPlanRow[]) => {
    if (!recipe) return;
    setPickRows(null);
    const added = await addSelectedIngredientsToList(recipe.id, rows);
    if (added > 0) {
      setToastMessage(tCount('recipe.detail.shoppingAdded', added));
      return;
    }
    // 選んだのに 1 件も入らない = 同じ名前が未購入で並んでいるとき
    void dialog.alert({
      title: t('recipe.detail.shoppingTitle'),
      message: t('recipe.detail.shoppingAllOnList'),
    });
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Loading message={t('recipe.detail.loading')} />
      </View>
    );
  }

  if (!recipe) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon="📖"
          title={t('recipe.detail.notFoundTitle')}
          message={t('recipe.detail.notFoundMessage')}
          actionLabel={t('recipe.detail.backToList')}
          onAction={() => router.replace('/(tabs)/recipes')}
        />
      </View>
    );
  }

  // 分量換算（基準人数が未登録なら常に等倍）
  const ingredientRatio = servingRatio(recipe.servings, targetServings ?? recipe.servings ?? 1);
  // 各タブは1ページ＝画面幅。横スクロールの子なので flex ではなく実寸で指定する
  const pageStyle = { width: pageWidth };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        {recipe.heroPhotoUri ? (
          // 表紙は cover で切っている。押したら切らずに全部見せる。
          // **Pressable にも fill を持たせる** — heroPhoto は absoluteFillObject なので、
          // 大きさの無い親に入れると 0×0 に潰れて写真が消える（実機で被弾）
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setViewerUri(recipe.heroPhotoUri)}
            accessibilityRole="imagebutton"
            accessibilityLabel={recipe.title}
          >
            <Image
              source={{ uri: recipe.heroPhotoUri }}
              style={styles.heroPhoto}
              resizeMode="cover"
            />
          </Pressable>
        ) : (
          <Text style={styles.heroEmoji}>{getRecipeEmoji(recipe.title)}</Text>
        )}
        {recipe.isCoverAiGenerated && (
          <View style={styles.heroAiBadge}>
            <Text style={styles.heroAiBadgeText}>{t('coverImage.badge')}</Text>
          </View>
        )}
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={20} color={Colors.paper} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Pressable
          ref={menuRef}
          collapsable={false}
          style={styles.menuButton}
          onPress={() => setShowMenu(!showMenu)}
          hitSlop={12}
          accessibilityLabel={t('recipe.detail.menuLabel')}
        >
          <View style={styles.heroButton}>
            <MoreVertical size={20} color={Colors.paper} />
          </View>
        </Pressable>
        <View style={[styles.helpButton, styles.heroButton]}>
          <HelpButton onPress={coach.show} />
        </View>
        <Pressable
          style={styles.pinButton}
          onPress={() => void handleTogglePin()}
          hitSlop={12}
          accessibilityLabel={
            recipe.pinnedAt != null ? t('recipe.detail.pinRemove') : t('recipe.detail.pinAdd')
          }
        >
          <View style={styles.heroButton}>
            <Bookmark
              size={20}
              color={Colors.gold}
              fill={recipe.pinnedAt != null ? Colors.gold : 'transparent'}
            />
          </View>
        </Pressable>
      </View>

      {showMenu && (
        <View style={styles.menuDropdown}>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              router.push(`/(tabs)/recipes/${id}/refine`);
            }}
          >
            <Text style={styles.menuItemText}>{t('recipe.detail.menu.refine')}</Text>
          </Pressable>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              router.push(`/recipes/${id}/edit`);
            }}
          >
            <Text style={styles.menuItemText}>{t('recipe.detail.menu.edit')}</Text>
          </Pressable>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              setShareSheetOpen(true);
            }}
          >
            <Text style={styles.menuItemText}>{t('recipe.detail.menu.share')}</Text>
          </Pressable>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              router.push(`/(tabs)/recipes/${id}/revisions`);
            }}
          >
            <Text style={styles.menuItemText}>{t('recipe.detail.menu.revisions')}</Text>
          </Pressable>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              void handleDelete();
            }}
          >
            <Text style={[styles.menuItemText, styles.menuItemDestructive]}>
              {t('common.delete')}
            </Text>
          </Pressable>
        </View>
      )}

      <View style={styles.meta}>
        <Text style={styles.title}>{recipe.title}</Text>
        {recipe.isCoverAiGenerated && (
          <Text style={styles.aiDetailNote}>{t('coverImage.detailNote')}</Text>
        )}
        {/*
          中身が AI 由来のときの注意書き（#266）。表紙の一行とは**別の意味**なので
          両方出ることがある（AI で作ったレシピに AI の表紙を付けた場合）。
          材料・分量を読む直前の面なので、ここに置く。**ここだけではない** —
          料理中モードの材料オーバーレイと、共有リンクの取り込みプレビューにも同じ
          注意書きを出している（詳細を通らずに材料を読める経路があるため）。
          文言は `ai.disclaimer` をそのまま使う — 短いバッジに薄めると
          アレルギーの警告が落ちる（あの文が唯一の警告）。
        */}
        {recipe.isAiGenerated && <Text style={styles.aiRecipeNote}>{t('ai.disclaimer')}</Text>}
        {/* お店の名前（v12）。編集画面で後から足せるので、足した結果がここに出る */}
        {recipe.placeName ? (
          <View style={styles.placeRow}>
            <Store size={13} color={Colors.goldDim} />
            <Text style={styles.placeText} numberOfLines={1}>
              {recipe.placeName}
            </Text>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          {recipe.rating != null && <Stars rating={recipe.rating} size={13} />}
          {recipe.servings != null && (
            <Text style={styles.metaText}>
              👥 {tCount('recipe.detail.servingsValue', recipe.servings)}
            </Text>
          )}
          {recipe.cookTimeMin != null && (
            <Text style={styles.metaText}>
              ⏱ {tCount('recipe.detail.cookTimeValue', recipe.cookTimeMin)}
            </Text>
          )}
        </View>
        {recipe.tags.length > 0 && (
          <View style={styles.tagRow}>
            {recipe.tags.map((t) => (
              <TagChip key={t} label={t} />
            ))}
          </View>
        )}
      </View>

      <View style={styles.tabBar}>
        {TAB_KEYS.map((key) => (
          <Pressable
            key={key}
            style={styles.tabItem}
            onPress={() => goToTab(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {tabLabel(key)}
            </Text>
            {tab === key && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <ScrollView
        ref={pagerRef}
        style={styles.content}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}
        onMomentumScrollEnd={handlePagerScrollEnd}
      >
        <ScrollView style={pageStyle} contentContainerStyle={styles.contentInner}>
          <View>
            {recipe.servings != null && (
              <View style={styles.servingsRow}>
                <NumberStepper
                  label={t('common.servings')}
                  value={targetServings ?? recipe.servings}
                  onChange={setTargetServings}
                  suffix={tCount('recipe.detail.servingsUnit', targetServings ?? recipe.servings)}
                  min={1}
                />
              </View>
            )}
            {recipe.ingredients.map((ing, i) => {
              const showGroup =
                ing.groupLabel &&
                (i === 0 || recipe.ingredients[i - 1].groupLabel !== ing.groupLabel);
              return (
                <View key={ing.id}>
                  {showGroup && <Text style={styles.groupLabel}>{ing.groupLabel}</Text>}
                  <View style={styles.ingredientRow}>
                    <Text style={styles.ingredientName}>{ing.name}</Text>
                    <Text style={styles.ingredientAmount}>
                      {convertAmountForDisplay(
                        scaleAmount(ing.amount, ingredientRatio),
                        unitSystem,
                      )}
                    </Text>
                  </View>
                </View>
              );
            })}
            <Pressable
              ref={missingRef}
              collapsable={false}
              style={styles.addToListButton}
              onPress={handleAddMissingToList}
            >
              <ShoppingCart size={16} color={Colors.gold} />
              <Text style={styles.addToListText}>{t('recipe.detail.addMissingLabel')}</Text>
            </Pressable>
          </View>
        </ScrollView>

        <ScrollView style={pageStyle} contentContainerStyle={styles.contentInner}>
          <View style={styles.stepList}>
            {recipe.steps.map((step) => (
              <View key={step.id} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{step.sortOrder}</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepBody}>
                    {convertTemperaturesForDisplay(step.body, unitSystem)}
                  </Text>
                  {step.photoPath && (
                    <Pressable
                      style={styles.stepPhotoPress}
                      onPress={() => setViewerUri(step.photoPath)}
                      accessibilityRole="imagebutton"
                    >
                      <Image
                        source={{ uri: step.photoPath }}
                        style={styles.stepPhoto}
                        resizeMode="cover"
                      />
                    </Pressable>
                  )}
                  {/* 写真が無い手順はその場で付けられる（2026-08-28・ユーザー要望）。
                      編集フォームまで行かなくてよい。付いたら loadRecipe で反映 */}
                  {isNativePlatform && !step.photoPath && (
                    <PhotoPickerField
                      variant="thumb"
                      value={undefined}
                      onChange={(path) => {
                        if (!path) return;
                        void setStepPhoto(step.id, path).then(() => loadRecipe());
                      }}
                    />
                  )}
                  {step.timerSec != null && (
                    <View style={styles.timerBadge}>
                      <Text style={styles.timerText}>
                        ⏱{' '}
                        {step.timerSec >= 60
                          ? tCount('recipe.detail.stepTimerMinutes', Math.floor(step.timerSec / 60))
                          : tCount('recipe.detail.stepTimerSeconds', step.timerSec)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        <ScrollView style={pageStyle} contentContainerStyle={styles.contentInner}>
          {recipe.description || memos.length > 0 ? (
            <View style={styles.memoList}>
              {recipe.description && <Text style={styles.memoBody}>{recipe.description}</Text>}
              {memos.map((memo) => (
                <View key={memo.id} style={styles.memoCard}>
                  <Text style={styles.memoBody}>{memo.body}</Text>
                  <Text style={styles.memoDate}>{formatDate(memo.createdAt)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.memoContainer}>
              <Text style={styles.memoPlaceholder}>{t('recipe.detail.emptyMemo')}</Text>
            </View>
          )}
        </ScrollView>

        <ScrollView style={pageStyle} contentContainerStyle={styles.contentInner}>
          <View>
            {cookingLogs.length === 0 ? (
              <View style={styles.memoContainer}>
                <Text style={styles.memoPlaceholder}>{t('recipe.detail.emptyHistory')}</Text>
                <Text style={styles.historyHint}>{t('recipe.detail.emptyHistoryHint')}</Text>
              </View>
            ) : (
              cookingLogs.map((log) => {
                const userName = formatProfileDisplayName(log.userName);
                return (
                  <View key={log.id} style={styles.logRow}>
                    <View style={styles.logHeader}>
                      <View style={styles.logUser}>
                        <Avatar name={userName} size={24} />
                        <Text style={styles.logUserName}>{userName}</Text>
                      </View>
                      <Text style={styles.logDate}>{formatDate(log.cookedAt)}</Text>
                    </View>
                    {log.rating != null && (
                      <View style={styles.logStars}>
                        <Stars rating={log.rating} size={12} />
                      </View>
                    )}
                    {log.memo && <Text style={styles.logMemo}>&quot;{log.memo}&quot;</Text>}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </ScrollView>

      <View style={styles.ctaContainer}>
        <PressableScale
          style={styles.shopButton}
          scaleTo={0.97}
          onPress={handleAddMissingToList}
          accessibilityRole="button"
          accessibilityLabel={t('recipe.detail.addMissingLabel')}
        >
          <ShoppingCart size={18} color={Colors.gold} />
        </PressableScale>
        <View ref={cookRef} collapsable={false} style={styles.ctaButtonOuter}>
          <PressableScale
            style={styles.ctaButton}
            scaleTo={0.97}
            onPress={() => router.push(`/(tabs)/recipes/${recipe.id}/cook`)}
          >
            <Text style={styles.ctaText} numberOfLines={1}>
              {t('recipe.detail.startCooking')}
            </Text>
          </PressableScale>
        </View>
        <View ref={logShortcutRef} collapsable={false}>
          <PressableScale
            style={styles.logButton}
            scaleTo={0.97}
            onPress={() => router.push(`/(tabs)/recipes/${recipe.id}/log`)}
            accessibilityRole="button"
            accessibilityLabel={t('recipe.detail.logShortcut')}
          >
            <ClipboardCheck size={18} color={Colors.gold} />
          </PressableScale>
        </View>
      </View>

      <CoachMarkOverlay
        visible={coach.visible}
        step={coach.step}
        index={coach.index}
        total={coach.total}
        onNext={coach.next}
        onSkip={coach.skip}
      />

      <PhotoViewer uri={viewerUri} onClose={() => setViewerUri(null)} />

      <ShareSheet
        visible={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        familyJoined={familyJoined}
        linkShared={webShare != null}
        linkBlocked={webShareBlocked}
        onFamily={() => {
          setShareSheetOpen(false);
          router.push('/(tabs)/family');
        }}
        onLinkSend={() => {
          // OS の共有シート（や権利確認ダイアログ）と重ならないよう先に閉じる
          setShareSheetOpen(false);
          void handleWebShare();
        }}
        onLinkStop={() => {
          setShareSheetOpen(false);
          void handleWebShareStop();
        }}
        onTextSend={() => {
          setShareSheetOpen(false);
          void handleShare();
        }}
      />

      <ShoppingPickSheet
        visible={pickRows !== null}
        rows={pickRows ?? []}
        onCancel={() => setPickRows(null)}
        onConfirm={(selected) => void commitShoppingSelection(selected)}
      />

      <Toast
        message={toastMessage ?? ''}
        visible={toastMessage != null}
        onDismiss={() => setToastMessage(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  hero: {
    height: 140,
    backgroundColor: '#1A1108',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  heroEmoji: { fontSize: 56 },
  heroPhoto: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  heroAiBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(10, 8, 5, 0.75)',
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  heroAiBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.gold, letterSpacing: 0.5 },
  // ヘッダーのボタンは表紙写真の上に重なる。**写真が明るいと見えなくなる**ため
  // （実機で、明るいガレットの写真でメニュー ⋮ が事実上不可視になった）、
  // 半透明の暗い下地を敷く。編集・お店の味に近づける・版履歴はメニューの中にしか
  // 入口がないので、見えないことは導線が無いのと同じ
  heroButton: {
    backgroundColor: 'rgba(10, 8, 5, 0.6)',
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(10, 8, 5, 0.6)',
    borderRadius: 18,
    height: 36,
    paddingLeft: 6,
    paddingRight: 12,
  },
  backText: {
    fontSize: 15,
    fontWeight: '400',
    // 下地を敷いたので、写真の明るさに関係なく読める色にする
    color: Colors.paper,
  },
  menuButton: {
    position: 'absolute',
    top: 50,
    right: 12,
  },
  helpButton: {
    position: 'absolute',
    top: 50,
    right: 56,
  },
  pinButton: {
    position: 'absolute',
    top: 50,
    right: 100,
  },
  menuDropdown: {
    position: 'absolute',
    top: 76,
    right: 16,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 4,
    minWidth: 110,
    zIndex: 10,
    elevation: 12,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
  },
  menuItemDestructive: {
    color: '#FF6B6B',
  },
  meta: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '500',
    color: Colors.paper,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  aiDetailNote: { fontSize: 11, color: Colors.muted, marginBottom: 6 },
  // 表紙の一行より強く見せる（材料と分量の安全に関わる）。警告色は使わない — ブランド外
  aiRecipeNote: {
    fontSize: 11,
    lineHeight: 17,
    color: Colors.paper,
    marginBottom: 8,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderLeftWidth: 2,
    borderLeftColor: Colors.gold,
    backgroundColor: 'rgba(201,161,106,0.07)',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  placeText: {
    color: Colors.goldDim,
    fontSize: 13,
    flexShrink: 1,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  metaText: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  tagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabText: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.muted,
  },
  tabTextActive: {
    color: Colors.gold,
    fontWeight: '500',
  },
  tabUnderline: { height: 2, backgroundColor: Colors.gold, width: '100%', marginTop: 8 },
  content: { flex: 1 },
  contentInner: { padding: 20, paddingBottom: 20 },
  servingsRow: {
    marginBottom: 10,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.goldDim,
    marginTop: 12,
    marginBottom: 6,
    letterSpacing: 1,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // 名前と分量が同じ行にあるので、**名前だけを縮ませて分量は縮ませない**。
    // 既定（flexShrink: 1 が両方に効く）だと、AI が付ける長い材料名
    // （「牛肉（ローストビーフ用薄切り、または牛モモ肉ブロック）」等）で名前が
    // 2 行に折り返し、その上に分量が重なって描かれていた（#222）
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  ingredientName: {
    flex: 1,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
  },
  ingredientAmount: {
    flexShrink: 0,
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '400',
    color: Colors.goldDim,
  },
  addToListButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.gold,
    backgroundColor: '#150F07',
  },
  addToListText: { fontSize: 14, fontWeight: '600', color: Colors.gold },
  stepList: { gap: 14 },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2A1E0E',
    borderWidth: 1,
    borderColor: Colors.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.gold,
  },
  stepContent: { flex: 1 },
  stepBody: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
    lineHeight: 24,
  },
  stepPhotoPress: { width: '100%' },
  stepPhoto: {
    width: '100%',
    height: 140,
    borderRadius: 8,
    marginTop: 8,
    backgroundColor: '#130E08',
  },
  timerBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#1E1509',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  timerText: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.gold,
  },
  memoContainer: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  memoPlaceholder: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  memoList: { gap: 14 },
  memoBody: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.paper,
    lineHeight: 24,
  },
  memoCard: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  memoDate: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  historyHint: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.muted,
    textAlign: 'center',
  },
  logRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 6,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logUserName: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.paper,
  },
  logDate: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  logStars: {
    marginTop: 2,
  },
  logMemo: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.goldDim,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  ctaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  shopButton: {
    width: 52,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logButton: {
    width: 52,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonOuter: {
    flex: 1,
  },
  ctaButton: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.gold,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: Colors.bg,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
});

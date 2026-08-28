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
import { CalendarDays, ChefHat, RefreshCw, ShoppingCart, Sparkles } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors } from '../../src/constants/theme';
import { t } from '../../src/i18n';
import {
  generateMenuPlan,
  getMenuPlan,
  replaceMenuDay,
  type MenuDayView,
  type MenuPlanView,
} from '../../src/services/menu-plan.service';
import { getRecipeList } from '../../src/services/recipe.service';
import { decodeReason } from '../../src/utils/menuPlan';
import { getRecipeEmoji } from '../../src/utils/recipeEmoji';

/** 日数の選択肢（設計 §10.7） */
const DAY_OPTIONS = [2, 3, 5, 7] as const;

/** 保存された `reason` を文言に戻す。往復は `decodeReason` 側でテストしてある */
function reasonText(reason: string): string {
  const { kind, subject } = decodeReason(reason);
  if (kind === 'expiry' && subject) return t('menu.reason.expiry', { name: subject });
  if (kind === 'coverage') return t('menu.reason.coverage', { count: subject });
  if (kind === 'pinned') return t('menu.reason.pinned');
  if (kind === 'few-missing') return t('menu.reason.fewMissing', { count: subject });
  return '';
}

export default function MenuScreen() {
  const router = useRouter();
  const [view, setView] = useState<MenuPlanView | null>(null);
  const [days, setDays] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 日カードの写真（設計 §10.7）。hydrate は heroPhotoUri を入れない —
  // 「画面側で recipe.service から引く」というサービス層のコメントどおり、
  // 一覧と同じ解決（表紙 ?? 最新の調理写真）をここでまとめて引く
  const [heroByRecipe, setHeroByRecipe] = useState<Map<string, string | null>>(new Map());

  const load = useCallback(async () => {
    const [next, list] = await Promise.all([getMenuPlan(), getRecipeList()]);
    setView(next);
    setHeroByRecipe(new Map(list.map((r) => [r.id, r.heroPhotoUri])));
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const build = useCallback(async () => {
    setBusy(true);
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
              heroUri={heroByRecipe.get(day.recipeId) ?? null}
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
  heroUri,
  busy,
  onOpen,
  onSwap,
}: {
  day: MenuDayView;
  heroUri: string | null;
  busy: boolean;
  onOpen: () => void;
  onSwap: () => void;
}) {
  const reason = reasonText(day.reason);
  return (
    <View style={[styles.card, day.doneAt !== null && styles.cardDone]}>
      <Text style={styles.dayLabel}>{t('menu.day.label', { day: day.day })}</Text>
      <View style={styles.dayBody}>
        {/* 写真（設計 §10.7）。無いレシピは一覧（S04）と同じ絵文字の 2 段構え —
            URL 取り込み・手入力のレシピが並んでも歯抜けにならない */}
        {!day.missing && (
          <View style={styles.dayImage}>
            {heroUri ? (
              <Image source={{ uri: heroUri }} style={styles.dayImagePhoto} resizeMode="cover" />
            ) : (
              <Text style={styles.dayEmoji}>{getRecipeEmoji(day.title)}</Text>
            )}
          </View>
        )}
        <View style={styles.dayText}>
          <Text style={styles.dayTitle}>{day.missing ? t('menu.day.missing') : day.title}</Text>
          {day.cookTimeMin !== null ? (
            <Text style={styles.dayMeta}>{t('menu.day.minutes', { count: day.cookTimeMin })}</Text>
          ) : null}
          {reason ? <Text style={styles.dayReason}>{reason}</Text> : null}
        </View>
      </View>
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
  dayBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: Colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dayImagePhoto: { width: '100%', height: '100%' },
  dayEmoji: { fontSize: 26 },
  dayText: { flex: 1 },
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

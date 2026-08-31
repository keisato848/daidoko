/**
 * Now Cooking バー — 調理中セッションがあるとき、タブバーの直上に常駐する pill。
 * どの画面からも 1 タップで料理中モードの続きに戻れる。
 *
 * 音楽アプリの Now Playing バーが原型。競合調査
 * （docs/reviews/cooking-resume-research-2026-08-28.md）では国内アプリに復帰導線は
 * 無く、海外もアプリ内ミニバー方式は確認できなかった — ここが差別化になる。
 *
 * 出さない画面:
 * - 料理中モード自体（戻る先がここ）
 * - タブバーを隠す全画面（撮影・相談）— タブバー前提の位置に浮くバーだけ残ると邪魔
 */
import { usePathname, useRouter } from 'expo-router';
import { ChefHat } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { t } from '../i18n';
import { useCookingSessionStore } from '../stores/cooking-session.store';
import { pathHasAnySegment } from '../utils/routeMatch';

/**
 * タブバーを隠す画面では pill も出さない（(tabs)/_layout の FULLSCREEN_CHILD_ROUTES と対応）。
 * **セグメント一致で見る** — `includes` だと `/cookable`（在庫の作れるレシピ）が
 * `/cook` に当たって、調理直前のいちばん復帰導線が要る画面で pill が消えていた。
 */
const HIDDEN_ROUTE_SEGMENTS = ['/cook', '/import-photo', '/consult'];

export function CookingResumeBar({ bottomOffset }: { bottomOffset: number }) {
  const session = useCookingSessionStore((s) => s.session);
  const router = useRouter();
  const pathname = usePathname();

  if (!session) return null;
  if (pathHasAnySegment(pathname, HIDDEN_ROUTE_SEGMENTS)) return null;

  return (
    <Pressable
      style={[styles.bar, { bottom: bottomOffset + 8 }]}
      onPress={() => router.push(`/(tabs)/recipes/${session.recipeId}/cook`)}
      accessibilityRole="button"
      accessibilityLabel={`${t('recipe.cook.resumeLabel')}: ${session.recipeTitle}`}
    >
      <ChefHat size={16} color={Colors.bg} />
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {session.recipeTitle}
        </Text>
        <Text style={styles.step}>
          {t('recipe.cook.resumeStep', {
            step: session.stepIndex + 1,
            total: session.totalSteps,
          })}
        </Text>
      </View>
      <Text style={styles.action}>{t('recipe.cook.resumeAction')} →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.gold,
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 14,
    // 下の画面より確実に手前に（Android は elevation が z も兼ねる）
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  textBlock: { flex: 1 },
  title: {
    color: Colors.bg,
    fontSize: 13,
    fontWeight: '700',
  },
  step: {
    color: Colors.bg,
    fontSize: 11,
    opacity: 0.75,
  },
  action: {
    color: Colors.bg,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 0,
  },
});

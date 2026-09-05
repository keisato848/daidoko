import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Tabs } from 'expo-router';
import { Home, BookOpen, Plus, Refrigerator, ShoppingCart } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, TAB_BAR_CONTENT_HEIGHT } from '../../src/constants/theme';
import { t } from '../../src/i18n';

/**
 * レシピスタックのうち、タブバーを隠す画面（全画面で集中させたいもの）。
 * `[id]/cook`（料理中モード）は 1.12.3 まで出したままだった — 全画面ステップ表示を
 * 名乗りながら下にタブが残り、集中モードとして中途半端だった
 * （ペルソナレビュー 1.12.2 #14）。誤タップで調理から離脱する事故も防ぐ。
 */
const FULLSCREEN_CHILD_ROUTES = ['import-photo', 'consult', '[id]/cook'];

export default function TabLayout() {
  /**
   * **下の safe-area を足さないとラベルが画面端で切れる。**
   *
   * `tabBarStyle` で `height` を指定すると、React Navigation が本来加える
   * 下インセットぶんが上書きされて消える。結果、ホームインジケータ／
   * ジェスチャーバーの領域までタブバーが食い込む。
   *
   * 日本語のラベル（ホーム・レシピ・追加・在庫・買物）は**ディセンダが無いので
   * 見た目には気づけない**が、英語（Recipes / Pantry / Shopping の p・y・g）は
   * はっきり切れる。Android ではジェスチャーバーの白い横棒が「追加」を貫く。
   * 2026-08-27、App Store 用スクショを英語で撮って初めて露見した。
   */
  const insets = useSafeAreaInsets();
  const tabBarStyle = {
    ...styles.tabBar,
    height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
    paddingBottom: insets.bottom,
  };

  return (
    /*
      backBehavior="initialRoute": タブ切替を戻る履歴に積まない（N1・画面設計 §4-1）。
      既定の履歴逆走だと「ホーム→在庫→買物→戻る戻る戻る」で終了までタブを全逆走し、
      5人中4人のペルソナが「他アプリで見たことがない」と判定した（1.13.0 実機観測 A）。
      他タブでの戻るは常にホームタブへ、ホームでもう一度でアプリ終了。
    */
    <Tabs
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        tabBarStyle,
        tabBarActiveTintColor: Colors.gold,
        tabBarInactiveTintColor: Colors.muted,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('ui.tab.home'),
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={({ route }) => ({
          title: t('ui.tab.recipes'),
          tabBarIcon: ({ color, size }) => <BookOpen size={size} color={color} />,
          // 撮影画面はタブバーを出さない。店内で集中して撮る画面としてノイズになる
          // （`docs/お店の味を再現設計.md` §4.3 問題7）。
          // recipes 配下は入れ子スタックなので、Tabs.Screen の href:null では制御できない。
          // 親タブ側で「いま開いている子ルート」を見て切り替える（React Navigation の定石）
          tabBarStyle: FULLSCREEN_CHILD_ROUTES.includes(getFocusedRouteNameFromRoute(route) ?? '')
            ? { display: 'none' as const }
            : tabBarStyle,
        })}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: t('ui.tab.add'),
          tabBarIcon: ({ color, size }) => (
            <View style={[styles.addButton, { borderColor: color }]}>
              <Plus size={size * 0.8} color={color} />
            </View>
          ),
        }}
      />
      {/*
        在庫はレシート・買い物・作れるレシピの起点なのに、ホームの「買物」→買い物リスト→
        「在庫へ」と 2 段奥にあって使われなかった（Issue #182）。タブに出して 1 タップにする。
        並びは「追加」を中央に保つため ホーム / レシピ / 追加 / 在庫 / 設定。
      */}
      <Tabs.Screen
        name="pantry"
        options={{
          title: t('ui.tab.pantry'),
          tabBarIcon: ({ color, size }) => <Refrigerator size={size} color={color} />,
        }}
      />
      {/*
        買い物リストは**店で片手で開く**画面なのに、入口がホーム最上部の小さなアイコン 1 つ
        （しかも在庫からは戻れない一方通行）だった。在庫を #182 でタブへ出したのと同じ理由で、
        買物もタブへ出す。空いた枠は設定を降ろして作る — 設定は滅多に開かないのに
        下端の一等地を占めていた。設定はホームのヘッダ（歯車）から開く。
        並びは「追加」を中央に保つため ホーム / レシピ / 追加 / 在庫 / 買物。
      */}
      <Tabs.Screen
        name="shopping"
        options={{
          title: t('ui.tab.shopping'),
          tabBarIcon: ({ color, size }) => <ShoppingCart size={size} color={color} />,
        }}
      />
      {/* Non-tab screens within the (tabs) group — hidden from tab bar.
          設定系の階層画面（settings とその子・在庫の作業画面）は 1.13.1 で
          ルート Stack（app/ 直下）へ移した — Tabs の兄弟に置くと戻るがタブ履歴と
          混ざるため（N2・画面設計 §4-1）。ここに残るのは menu と recipes の子だけ */}
      {/* S20 献立（#215）。タブは 5 本のまま — 組む操作は週 1〜2 回で、
          毎日見る「今日の 1 枚」はホームのカードが担う（画面設計「献立導入後の全体導線」）。
          献立は「＜」を持たない準タブ面（ホームのカード・通知が入口）なのでタブ側に残す */}
      <Tabs.Screen name="menu" options={{ href: null }} />
      <Tabs.Screen name="recipes/import-photo" options={{ href: null }} />
      <Tabs.Screen name="recipes/consult" options={{ href: null }} />
      <Tabs.Screen name="recipes/import-ocr" options={{ href: null }} />
      <Tabs.Screen name="recipes/import-share" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.bg,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    paddingTop: 4,
  },
  tabLabel: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2A1E0E',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -10,
  },
});

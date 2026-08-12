import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Tabs } from 'expo-router';
import { Home, BookOpen, Plus, Settings } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Colors } from '../../src/constants/theme';
import { t } from '../../src/i18n';

/** レシピスタックのうち、タブバーを隠す画面（全画面で集中させたいもの）。 */
const FULLSCREEN_CHILD_ROUTES = ['import-photo', 'consult'];

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
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
            : styles.tabBar,
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
      <Tabs.Screen
        name="settings"
        options={{
          title: t('ui.tab.settings'),
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
      {/* Non-tab screens within the (tabs) group — hidden from tab bar */}
      <Tabs.Screen name="family" options={{ href: null }} />
      <Tabs.Screen name="backup" options={{ href: null }} />
      <Tabs.Screen name="licenses" options={{ href: null }} />
      <Tabs.Screen name="ai-key" options={{ href: null }} />
      <Tabs.Screen name="shopping" options={{ href: null }} />
      <Tabs.Screen name="pantry" options={{ href: null }} />
      <Tabs.Screen name="scan-barcode" options={{ href: null }} />
      <Tabs.Screen name="receipt" options={{ href: null }} />
      <Tabs.Screen name="cookable" options={{ href: null }} />
      <Tabs.Screen name="consume-meal" options={{ href: null }} />
      <Tabs.Screen name="name-aliases" options={{ href: null }} />
      <Tabs.Screen name="web-shares" options={{ href: null }} />
      <Tabs.Screen name="recipes/import-photo" options={{ href: null }} />
      <Tabs.Screen name="recipes/consult" options={{ href: null }} />
      <Tabs.Screen name="recipes/import-ocr" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.bg,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: 58,
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

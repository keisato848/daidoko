import { Stack, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../src/constants/theme';
import { useDatabase } from '../src/hooks/useDatabase';
import {
  initAppOpenAds,
  maybeShowAppOpenAdOnForeground,
  noteAppBackgrounded,
} from '../src/services/app-open-ad.service';
import { maybeCreateAutoSnapshot } from '../src/services/backup.service';
import { checkAndNotifyLowStock } from '../src/services/low-stock.service';

export default function RootLayout() {
  const { isReady, error } = useDatabase();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // 起動時に在庫の残量しきい値をチェック（1日1回まとめて通知; P3）
  // + 週次の自動バックアップスナップショット（#79。失敗しても起動は止めない）
  // + アプリ起動広告の初期化（広告有効ビルドのみ・ガード多数 — app-open-ad.service）
  useEffect(() => {
    if (isReady) {
      checkAndNotifyLowStock().catch(() => undefined);
      maybeCreateAutoSnapshot().catch(() => undefined);
      initAppOpenAds().catch(() => undefined);
    }
  }, [isReady]);

  // フォアグラウンド復帰でアプリ起動広告（表示条件は service 側で全て判定）
  useEffect(() => {
    if (!isReady) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') noteAppBackgrounded();
      if (state === 'active') {
        maybeShowAppOpenAdOnForeground(pathnameRef.current).catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [isReady]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>DB Error: {error}</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.gold} size="large" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="recipes/[id]/edit" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 14,
  },
});

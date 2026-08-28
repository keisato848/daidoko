import { getLocales } from 'expo-localization';
import { Stack, useRouter, usePathname } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { DialogHost } from '../src/components/DialogHost';
import { Colors } from '../src/constants/theme';
import { useDatabase } from '../src/hooks/useDatabase';
import { initLocaleFromDevice } from '../src/i18n';
import { isLaunchCameraEnabled } from '../src/services/app-meta.service';
import {
  initAppOpenAds,
  maybeShowAppOpenAdOnForeground,
  noteAppBackgrounded,
} from '../src/services/app-open-ad.service';
import { maybeCreateAutoSnapshot } from '../src/services/backup.service';
import {
  addAllLowStockToShoppingList,
  checkAndNotifyLowStock,
} from '../src/services/low-stock.service';
import { runDailyMenuMaintenance } from '../src/services/menu-plan.service';
import {
  addLowStockTapListener,
  addMenuTapListener,
  addSyncPushListener,
  consumeLowStockLaunchTap,
  consumeMenuLaunchTap,
} from '../src/services/notification.service';
import { initSync, runSync } from '../src/services/sync-runner.service';
import { loadUnitSystem } from '../src/stores/unitSystem.store';
import { decideLaunchDestination } from '../src/utils/launchDestination';

// 端末の言語設定を反映する。**描画前に一度だけ**（モジュール読み込み時）行う。
// i18n 側の既定は ja 固定で、ここを通ったときだけ端末ロケールに切り替わる
initLocaleFromDevice();

export default function RootLayout() {
  const { isReady, error } = useDatabase();
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const handleLowStockTap = useCallback(() => {
    addAllLowStockToShoppingList()
      .then(() => router.push('/(tabs)/shopping'))
      .catch(() => undefined);
  }, [router]);

  const handleMenuTap = useCallback(() => {
    router.push('/(tabs)/menu');
  }, [router]);

  // 起動時に在庫の残量しきい値をチェック（1日1回まとめて通知; P3）
  // + 週次の自動バックアップスナップショット（#79。失敗しても起動は止めない）
  // + アプリ起動広告の初期化（広告有効ビルドのみ・ガード多数 — app-open-ad.service）
  // + 毎日の自動献立モード（#215 A1・既定オフ。内部で pull 完了を待ってから
  //   自動追加するので、initSync() より後に呼んでも fire-and-forget で構わない）
  useEffect(() => {
    if (isReady) {
      // 単位系は保存値 → 無ければ端末の地域。表示のたびに読むのでストアが持つ
      loadUnitSystem(getLocales()[0]?.regionCode).catch(() => undefined);
      checkAndNotifyLowStock().catch(() => undefined);
      maybeCreateAutoSnapshot().catch(() => undefined);
      initAppOpenAds().catch(() => undefined);
      // クラウド同期（家族と共有中の端末だけ動く。未参加なら何もしない）
      initSync();
      runDailyMenuMaintenance().catch(() => undefined);
    }
  }, [isReady]);

  // 残量通知タップ → 確認なしで一括買い物リスト追加（#66②）。
  useEffect(() => {
    if (!isReady) return;
    const sub = addLowStockTapListener(handleLowStockTap);
    return () => sub.remove();
  }, [isReady, handleLowStockTap]);

  // 献立通知タップ（#215 §10.11.4）→ 献立画面へ。
  useEffect(() => {
    if (!isReady) return;
    const sub = addMenuTapListener(handleMenuTap);
    return () => sub.remove();
  }, [isReady, handleMenuTap]);

  // 家族の端末が何か変えた合図（内容を持たない通知）で同期する。
  // 通知が届かなくても起動時とフォアグラウンド復帰の同期で追いつく
  useEffect(() => {
    if (!isReady) return;
    const sub = addSyncPushListener(() => {
      void runSync();
    });
    return () => sub.remove();
  }, [isReady]);

  // 起動時の行き先を **1 回だけ** 決める。
  // 通知タップ（明示的な操作）が最優先、次に「アプリを開いたらすぐ撮影」（R3・既定オフ）。
  // どちらも無ければ通常どおりホーム。cold-start はリスナー登録前なので consume で拾う。
  const launchRoutedRef = useRef(false);
  useEffect(() => {
    if (!isReady || launchRoutedRef.current) return;
    launchRoutedRef.current = true;
    void (async () => {
      const [tappedLowStockNotification, tappedMenuNotification, launchCameraEnabled] =
        await Promise.all([
          consumeLowStockLaunchTap().catch(() => false),
          consumeMenuLaunchTap().catch(() => false),
          isLaunchCameraEnabled().catch(() => false),
        ]);
      const destination = decideLaunchDestination({
        tappedLowStockNotification,
        tappedMenuNotification,
        launchCameraEnabled,
      });
      if (destination === 'low-stock') handleLowStockTap();
      if (destination === 'menu') handleMenuTap();
      // push（replace ではない）ので、戻るでホームに帰れる
      if (destination === 'capture') router.push('/(tabs)/recipes/import-photo');
    })();
  }, [isReady, router, handleLowStockTap, handleMenuTap]);

  // フォアグラウンド復帰でアプリ起動広告（表示条件は service 側で全て判定）
  // + 毎日の自動献立モード（#215 A1・起動時と同じきっかけ・§10.11.1）
  useEffect(() => {
    if (!isReady) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') noteAppBackgrounded();
      if (state === 'active') {
        maybeShowAppOpenAdOnForeground(pathnameRef.current).catch(() => undefined);
        void runSync();
        runDailyMenuMaintenance().catch(() => undefined);
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
    // キーボードの位置・高さを全画面で扱えるようにする土台（`KeyboardAvoider` が使う）。
    // **アプリのルートに 1 つだけ**置く決まりで、これが無いと配下の
    // KeyboardAvoidingView / KeyboardAwareScrollView は黙って何もしない。
    <KeyboardProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="recipes/[id]/edit" options={{ presentation: 'modal' }} />
      </Stack>
      {/*
        アプリのデザインのダイアログ（`docs/画面設計.md` §7）。**アプリに 1 つだけ**置く。
        `Stack` の外に出しているのは、どの画面から出した確認でも同じ場所に描くため
      */}
      <DialogHost />
    </KeyboardProvider>
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

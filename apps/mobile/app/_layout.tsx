import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../src/constants/theme';
import { useDatabase } from '../src/hooks/useDatabase';
import { checkAndNotifyLowStock } from '../src/services/low-stock.service';

export default function RootLayout() {
  const { isReady, error } = useDatabase();

  // 起動時に在庫の残量しきい値をチェック（1日1回まとめて通知; P3）
  useEffect(() => {
    if (isReady) checkAndNotifyLowStock().catch(() => undefined);
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

/**
 * Centered loading indicator for initial list/data fetches
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';

interface LoadingProps {
  message?: string;
}

export function Loading({ message }: LoadingProps) {
  return (
    <View style={styles.container} accessibilityRole="progressbar" testID="loading-indicator">
      <ActivityIndicator size="large" color={Colors.gold} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  message: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.regular,
    color: Colors.paperDim,
    textAlign: 'center',
  },
});

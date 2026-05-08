/**
 * Empty state placeholder for lists
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';

interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon && <Text style={styles.icon}>{icon}</Text>}
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {actionLabel && onAction && (
        <Pressable style={styles.button} onPress={onAction}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 60,
  },
  icon: {
    fontSize: 40,
    marginBottom: 16,
  },
  title: {
    fontSize: 17, // md: 空状態タイトル
    fontWeight: '500',
    color: Colors.paper,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 13, // sm: 空状態メッセージ
    fontWeight: '400',
    color: Colors.paperDim,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.gold,
  },
  buttonText: {
    fontSize: 15, // base: アクションボタン
    fontWeight: '600',
    color: Colors.bg,
  },
});

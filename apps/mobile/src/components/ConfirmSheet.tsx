/**
 * Destructive action confirmation bottom sheet
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { BottomSheet } from './BottomSheet';

interface ConfirmSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}

export function ConfirmSheet({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = '確認',
  destructive = true,
}: ConfirmSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.buttons}>
        <Pressable style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelText}>キャンセル</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmButton, destructive && styles.destructiveButton]}
          onPress={onConfirm}
        >
          <Text style={[styles.confirmText, destructive && styles.destructiveText]}>
            {confirmLabel}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  message: {
    fontSize: 13,
    color: Colors.paperDim,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    color: Colors.paperDim,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    alignItems: 'center',
  },
  destructiveButton: {
    backgroundColor: '#5C2020',
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.bg,
  },
  destructiveText: {
    color: '#FF6B6B',
  },
});

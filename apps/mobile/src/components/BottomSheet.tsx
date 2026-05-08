/**
 * Reusable modal bottom sheet
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          {title && <Text style={styles.title}>{title}</Text>}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.bgOverlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#150F08',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 3,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 14,
    color: Colors.paper,
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
});

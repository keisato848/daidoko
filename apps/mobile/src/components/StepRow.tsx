/**
 * Editable step row for recipe form
 */
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '../constants/theme';

interface StepRowProps {
  index: number;
  body: string;
  timerSec: number | undefined;
  onChangeBody: (value: string) => void;
  onChangeTimer: (value: number | undefined) => void;
  onRemove: () => void;
}

export function StepRow({
  index,
  body,
  timerSec,
  onChangeBody,
  onChangeTimer,
  onRemove,
}: StepRowProps) {
  const timerMin = timerSec != null ? Math.floor(timerSec / 60) : undefined;

  const handleTimerChange = (text: string) => {
    const num = parseInt(text, 10);
    if (isNaN(num) || num <= 0) {
      onChangeTimer(undefined);
    } else {
      onChangeTimer(num * 60);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.stepNumber}>
          <Text style={styles.stepNumberText}>{index + 1}</Text>
        </View>
        <Pressable style={styles.removeButton} onPress={onRemove} hitSlop={8}>
          <Text style={styles.removeText}>×</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.bodyInput}
        value={body}
        onChangeText={onChangeBody}
        placeholder="手順を入力..."
        placeholderTextColor={Colors.muted}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
      <View style={styles.timerRow}>
        <Text style={styles.timerLabel}>⏱ タイマー</Text>
        <TextInput
          style={styles.timerInput}
          value={timerMin != null ? String(timerMin) : ''}
          onChangeText={handleTimerChange}
          placeholder="−"
          placeholderTextColor={Colors.muted}
          keyboardType="numeric"
        />
        <Text style={styles.timerSuffix}>分</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 14,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2A1E0E',
    borderWidth: 1,
    borderColor: Colors.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 13, // sm: ステップ番号
    fontWeight: '500',
    color: Colors.gold,
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    color: '#FF6B6B',
    fontSize: 17, // md: 削除ボタン
    fontWeight: '400',
  },
  bodyInput: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15, // base: 手順テキスト入力
    fontWeight: '400',
    color: Colors.paper,
    minHeight: 64,
    lineHeight: 22,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  timerLabel: {
    fontSize: 13, // sm: タイマーラベル
    fontWeight: '400',
    color: Colors.goldDim,
  },
  timerInput: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 15, // base: タイマー入力値
    fontWeight: '400',
    color: Colors.paper,
    width: 54,
    textAlign: 'center',
  },
  timerSuffix: {
    fontSize: 13, // sm: 単位ラベル
    fontWeight: '400',
    color: Colors.paperDim,
  },
});

/**
 * +/- stepper for numeric values (servings, cook time, etc.)
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';

interface NumberStepperProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

export function NumberStepper({
  label,
  value,
  onChange,
  min = 1,
  max = 999,
  step = 1,
  suffix,
}: NumberStepperProps) {
  const current = value ?? min;

  const decrement = () => {
    const next = current - step;
    onChange(next >= min ? next : undefined);
  };

  const increment = () => {
    const next = value == null ? min : current + step;
    if (next <= max) onChange(next);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          style={[styles.button, value == null && styles.buttonDisabled]}
          onPress={decrement}
          disabled={value == null}
        >
          <Text style={[styles.buttonText, value == null && styles.buttonTextDisabled]}>−</Text>
        </Pressable>
        <Text style={styles.value}>{value != null ? `${value}${suffix ?? ''}` : '−'}</Text>
        <Pressable style={styles.button} onPress={increment}>
          <Text style={styles.buttonText}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13, // sm: ステッパーラベル
    fontWeight: '500',
    color: Colors.paperDim,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 20, // lg: ＋/－ボタン文字
    fontWeight: '400',
    color: Colors.gold,
  },
  buttonTextDisabled: {
    color: Colors.muted,
  },
  value: {
    fontSize: 17, // md: 現在値
    fontWeight: '400',
    color: Colors.paper,
    minWidth: 60,
    textAlign: 'center',
  },
});

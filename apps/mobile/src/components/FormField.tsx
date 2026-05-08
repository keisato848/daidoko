/**
 * Labeled text input with error display
 */
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { Colors } from '../constants/theme';

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string;
  required?: boolean;
}

export function FormField({ label, error, required, style, ...props }: FormFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : undefined, style]}
        placeholderTextColor={Colors.muted}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13, // sm: フォームラベル
    fontWeight: '500',
    color: Colors.paperDim,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  required: {
    color: Colors.gold,
  },
  input: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15, // base: 入力テキスト
    fontWeight: '400',
    color: Colors.paper,
  },
  inputError: {
    borderColor: '#FF6B6B',
  },
  error: {
    fontSize: 12, // xs: エラーメッセージ
    fontWeight: '400',
    color: '#FF6B6B',
    marginTop: 4,
  },
});

/**
 * Editable ingredient row for recipe form
 */
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '../constants/theme';

interface IngredientRowProps {
  name: string;
  amount: string;
  groupLabel: string;
  onChangeName: (value: string) => void;
  onChangeAmount: (value: string) => void;
  onChangeGroup: (value: string) => void;
  onRemove: () => void;
  showGroup?: boolean;
}

export function IngredientRow({
  name,
  amount,
  groupLabel,
  onChangeName,
  onChangeAmount,
  onChangeGroup,
  onRemove,
  showGroup = false,
}: IngredientRowProps) {
  return (
    <View style={styles.container}>
      {showGroup && (
        <TextInput
          style={styles.groupInput}
          value={groupLabel}
          onChangeText={onChangeGroup}
          placeholder="グループ（例: A 調味料）"
          placeholderTextColor={Colors.muted}
        />
      )}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.nameInput]}
          value={name}
          onChangeText={onChangeName}
          placeholder="材料名"
          placeholderTextColor={Colors.muted}
        />
        <TextInput
          style={[styles.input, styles.amountInput]}
          value={amount}
          onChangeText={onChangeAmount}
          placeholder="分量"
          placeholderTextColor={Colors.muted}
        />
        <Pressable style={styles.removeButton} onPress={onRemove} hitSlop={8}>
          <Text style={styles.removeText}>×</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
  },
  groupInput: {
    fontSize: 12, // xs: グループラベル入力
    fontWeight: '400',
    color: Colors.goldDim,
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15, // base: 材料名・分量
    fontWeight: '400',
    color: Colors.paper,
  },
  nameInput: {
    flex: 2,
  },
  amountInput: {
    flex: 1,
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.bgCard,
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
});

import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';

interface TagChipProps {
  label: string;
}

export function TagChip({ label }: TagChipProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  text: {
    fontSize: 12, // xs: タグチップ（詳細画面の表示用）
    fontWeight: '400',
    color: Colors.goldDim,
    letterSpacing: 0.5,
  },
});

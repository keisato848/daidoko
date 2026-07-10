/**
 * Inline expandable info row — a label with an (i) icon that reveals a short
 * explanation on tap. For settings-style facts users need to reference later
 * (storage, deletion, constraints), not first-run coach marks (which are
 * one-shot and disappear after being seen).
 */
import { Info } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';

interface InfoTooltipProps {
  label: string;
  detail: string;
}

export function InfoTooltip({ label, detail }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.row}
        onPress={() => setOpen((prev) => !prev)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${label}の詳細を${open ? '閉じる' : '表示'}`}
      >
        <Text style={styles.label}>{label}</Text>
        <Info size={14} color={Colors.muted} />
      </Pressable>
      {open && <Text style={styles.detail}>{detail}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 13, // sm
    fontWeight: '400',
    color: Colors.paperDim,
  },
  detail: {
    fontSize: 12, // xs
    fontWeight: '400',
    color: Colors.muted,
    lineHeight: 18,
    marginTop: 6,
  },
});

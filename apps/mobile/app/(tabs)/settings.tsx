/**
 * Settings placeholder (v0.1 scope: stub only)
 */
import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '../../src/constants/theme';

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>設定</Text>
      <Text style={styles.sub}>v0.2 で実装予定</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    color: Colors.paper,
    fontSize: 16,
  },
  sub: {
    color: Colors.muted,
    fontSize: 12,
  },
});

/**
 * 「この品目を家族と共有するか」の切り替え（買い物リスト・在庫 — 設計 §5-2）。
 *
 * **家族グループに入っていないあいだは何も描かない。** 使わない人の画面を変えない、
 * というのが §5-2 の決めごとなので、判断をここに閉じ込めて各画面では素直に置くだけにする。
 *
 * 共有をやめると、次の同期で他端末からは消える（自分の端末には残る）。
 */
import { User, Users } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { t } from '../i18n';
import { useSyncStore } from '../stores/sync.store';

interface Props {
  shared: boolean;
  onToggle: (next: boolean) => void;
}

export function SharedToggle({ shared, onToggle }: Props) {
  const joined = useSyncStore((state) => state.joined);
  if (!joined) return null;

  return (
    <Pressable
      onPress={() => onToggle(!shared)}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: shared }}
      accessibilityLabel={shared ? t('pantry.shared.onLabel') : t('pantry.shared.offLabel')}
      style={styles.button}
    >
      <View style={[styles.badge, shared ? styles.badgeOn : styles.badgeOff]}>
        {shared ? <Users size={13} color={Colors.bg} /> : <User size={13} color={Colors.goldDim} />}
        <Text style={[styles.label, shared ? styles.labelOn : styles.labelOff]}>
          {shared ? t('pantry.shared.onBadge') : t('pantry.shared.offBadge')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    marginLeft: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeOn: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  badgeOff: {
    backgroundColor: 'transparent',
    borderColor: Colors.border,
  },
  label: {
    fontSize: 11,
  },
  labelOn: {
    color: Colors.bg,
  },
  labelOff: {
    color: Colors.goldDim,
  },
});

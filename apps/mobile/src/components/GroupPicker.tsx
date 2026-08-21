/**
 * グループを選ぶ・その場で作るシート（v13）。
 *
 * グループは**利用者が自由に名前を付けて束ねる**もの（〇〇の米 / 冷蔵庫 / 災害用備蓄）で、
 * 用途ごとの特別な仕組みは作らない。既存から選ぶのが主で、無ければその場で足せる。
 * **「未設定のまま」を必ず選べる** — 任意の機能なので、使わない選択を塞がない。
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { KeyboardAvoider } from './KeyboardAvoider';
import { Colors } from '../constants/theme';
import { t } from '../i18n';

export interface GroupPickerProps {
  visible: boolean;
  title: string;
  groups: readonly string[];
  /** 現在の値。null = 未設定 */
  value: string | null;
  noneLabel: string;
  newPlaceholder: string;
  createLabel: string;
  onSelect: (group: string | null) => void;
  onClose: () => void;
}

export function GroupPicker({
  visible,
  title,
  groups,
  value,
  noneLabel,
  newPlaceholder,
  createLabel,
  onSelect,
  onClose,
}: GroupPickerProps) {
  const [draft, setDraft] = useState('');

  const choose = (group: string | null) => {
    setDraft('');
    onSelect(group);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Modal の中身は画面本体とは別ツリーなので、ここにも KeyboardAvoider が要る */}
      <KeyboardAvoider style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>

          <Pressable
            accessibilityRole="button"
            style={[styles.row, value == null && styles.rowActive]}
            onPress={() => choose(null)}
          >
            <Text style={[styles.rowText, value == null && styles.rowTextActive]}>{noneLabel}</Text>
          </Pressable>

          {groups.map((group) => (
            <Pressable
              key={group}
              accessibilityRole="button"
              style={[styles.row, value === group && styles.rowActive]}
              onPress={() => choose(group)}
            >
              <Text style={[styles.rowText, value === group && styles.rowTextActive]}>{group}</Text>
            </Pressable>
          ))}

          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={newPlaceholder}
              placeholderTextColor={Colors.muted}
              maxLength={30}
            />
            <Pressable
              accessibilityRole="button"
              style={[styles.createButton, !draft.trim() && styles.createButtonDisabled]}
              disabled={!draft.trim()}
              onPress={() => choose(draft.trim())}
            >
              <Text style={styles.createButtonText}>{createLabel}</Text>
            </Pressable>
          </View>

          <Pressable accessibilityRole="button" style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    gap: 8,
  },
  title: { fontSize: 15, fontWeight: '600', color: Colors.paper, marginBottom: 4 },
  row: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowActive: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  rowText: { fontSize: 14, color: Colors.paper },
  rowTextActive: { color: Colors.bg, fontWeight: '600' },
  createRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.bgInput,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.paper,
  },
  createButton: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: Colors.gold,
  },
  createButtonDisabled: { opacity: 0.4 },
  createButtonText: { fontSize: 13, fontWeight: '600', color: Colors.bg },
  close: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  closeText: { fontSize: 13, color: Colors.muted },
});

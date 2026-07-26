/**
 * 名寄せ辞書のメンテ画面（Issue #66④）— 設定画面「データ」から開く。
 * AIが解決した「表記ゆれ→正規名」キャッシュ（name_aliases）の一覧・編集・削除。
 * 削除した項目は次に同じ表記が出た際に再度AIで解決される。docs/買い物リスト・在庫設計.md §6
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, Pencil, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '../../src/constants/theme';
import {
  deleteAlias,
  getAliasEntries,
  updateAliasCanonical,
  type AliasRecord,
} from '../../src/services/name-alias.service';

export default function NameAliasesScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<AliasRecord[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');

  const refresh = useCallback(() => {
    getAliasEntries()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);
  useFocusEffect(refresh);

  const handleToggleEdit = useCallback((entry: AliasRecord) => {
    setEditId((prev) => (prev === entry.id ? null : entry.id));
    setEditInput(entry.canonical);
  }, []);

  const handleSave = useCallback(
    async (entry: AliasRecord) => {
      setEditId(null);
      if (editInput.trim() && editInput.trim() !== entry.canonical) {
        await updateAliasCanonical(entry.id, editInput.trim()).catch(() => undefined);
        refresh();
      }
    },
    [editInput, refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setEntries((prev) => prev.filter((it) => it.id !== id));
      await deleteAlias(id).catch(() => undefined);
      refresh();
    },
    [refresh],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>名寄せ辞書</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={styles.description}>
        AIが「表記ゆれ→正規名」として覚えた対応を一覧できます。間違って覚えたものは、鉛筆マークで正しい名前に直すか、×で削除してください（削除すると次回また自動で判定されます）。
      </Text>

      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>
            まだ何も覚えていません。{'\n'}
            レシート読み取りや食材の名寄せを使うと、ここに記録されます。
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.sourceName}>{item.sourceNormalized}</Text>
              <Text style={styles.arrow}>→</Text>
              <Text style={styles.canonicalName}>{item.canonical}</Text>
            </View>
            <View style={styles.rowActions}>
              <Pressable
                onPress={() => handleToggleEdit(item)}
                hitSlop={8}
                accessibilityLabel={`${item.sourceNormalized}の正規名を編集`}
              >
                <Pencil size={16} color={editId === item.id ? Colors.gold : Colors.muted} />
              </Pressable>
              <Pressable
                onPress={() => handleDelete(item.id)}
                hitSlop={10}
                accessibilityLabel={`${item.sourceNormalized}を削除`}
              >
                <X size={16} color={Colors.muted} />
              </Pressable>
            </View>
            {editId === item.id && (
              <View style={styles.editor}>
                <TextInput
                  style={styles.editInput}
                  value={editInput}
                  onChangeText={setEditInput}
                  placeholder="正しい名前"
                  placeholderTextColor={Colors.muted}
                  maxLength={50}
                  autoFocus
                />
                <Pressable
                  style={styles.editSave}
                  onPress={() => handleSave(item)}
                  accessibilityLabel="正規名を保存"
                >
                  <Text style={styles.editSaveText}>保存</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 58,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '500', color: Colors.paper },
  headerSpacer: { width: 36 },
  description: {
    fontSize: 13,
    color: Colors.paperDim,
    lineHeight: 19,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  listContent: { paddingHorizontal: 20, paddingBottom: 24 },
  empty: { color: Colors.muted, textAlign: 'center', marginTop: 48, lineHeight: 22, fontSize: 14 },
  row: {
    position: 'relative',
    paddingVertical: 12,
    paddingRight: 60,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowActions: {
    position: 'absolute',
    right: 0,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  sourceName: { fontSize: 15, color: Colors.paperDim, flexShrink: 1 },
  arrow: { fontSize: 13, color: Colors.muted },
  canonicalName: { fontSize: 15, color: Colors.paper, fontWeight: '500', flexShrink: 1 },
  editor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
  },
  editInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: Colors.paper,
  },
  editSave: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: Colors.gold,
  },
  editSaveText: { fontSize: 13, color: Colors.bg, fontWeight: '600' },
});

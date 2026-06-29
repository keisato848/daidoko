/**
 * 買い物リスト（集約・永続）— ホーム右上のカートから開く。
 * 手動追加・チェック（永続）・削除・チェック済み一括削除。レシピからの追加は
 * レシピ詳細の「材料を買い物リストに追加」から。docs/買い物リスト・在庫設計.md §5.1
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Check, Package, Plus, Trash2, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '../../src/constants/theme';
import { moveCheckedShoppingItemsToPantry } from '../../src/services/pantry.service';
import {
  addShoppingItem,
  clearCheckedShoppingItems,
  getShoppingItems,
  removeShoppingItem,
  setShoppingItemChecked,
} from '../../src/services/shopping-list.service';
import type { ShoppingItem } from '../../src/services/types';

export default function ShoppingListScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [input, setInput] = useState('');

  const refresh = useCallback(() => {
    getShoppingItems()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  useFocusEffect(refresh);

  const handleAdd = useCallback(async () => {
    const name = input.trim();
    if (!name) return;
    setInput('');
    await addShoppingItem(name).catch(() => undefined);
    refresh();
  }, [input, refresh]);

  const handleToggle = useCallback(
    async (item: ShoppingItem) => {
      // optimistic
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, checked: !it.checked } : it)),
      );
      await setShoppingItemChecked(item.id, !item.checked).catch(() => undefined);
      refresh();
    },
    [refresh],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      await removeShoppingItem(id).catch(() => undefined);
      refresh();
    },
    [refresh],
  );

  const handleClearChecked = useCallback(async () => {
    await clearCheckedShoppingItems().catch(() => undefined);
    refresh();
  }, [refresh]);

  const handleMoveToPantry = useCallback(async () => {
    await moveCheckedShoppingItemsToPantry().catch(() => undefined);
    refresh();
  }, [refresh]);

  const checkedCount = items.filter((it) => it.checked).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>買い物リスト</Text>
        <Pressable
          onPress={() => router.push('/(tabs)/pantry')}
          hitSlop={10}
          accessibilityLabel="在庫"
        >
          <Text style={styles.headerLink}>在庫</Text>
        </Pressable>
      </View>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={input}
          onChangeText={setInput}
          placeholder="品目を追加（例: 牛乳）"
          placeholderTextColor={Colors.muted}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
          maxLength={50}
        />
        <Pressable
          style={[styles.addButton, !input.trim() && styles.addButtonDisabled]}
          onPress={handleAdd}
          disabled={!input.trim()}
          accessibilityLabel="追加"
        >
          <Plus size={20} color={Colors.bg} />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>買い物リストは空です。{'\n'}品目を追加してください。</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => handleToggle(item)} hitSlop={6}>
              <View style={[styles.checkbox, item.checked && styles.checkboxOn]}>
                {item.checked && <Check size={14} color={Colors.bg} />}
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.itemName, item.checked && styles.itemNameChecked]}>
                  {item.name}
                </Text>
                {item.amount ? <Text style={styles.itemAmount}>{item.amount}</Text> : null}
              </View>
            </Pressable>
            <Pressable onPress={() => handleRemove(item.id)} hitSlop={10} accessibilityLabel="削除">
              <X size={16} color={Colors.muted} />
            </Pressable>
          </View>
        )}
      />

      {checkedCount > 0 && (
        <View style={styles.footer}>
          <Pressable style={styles.pantryButton} onPress={handleMoveToPantry}>
            <Package size={16} color={Colors.gold} />
            <Text style={styles.pantryButtonText}>在庫に入れる（{checkedCount}）</Text>
          </Pressable>
          <Pressable
            style={styles.clearButton}
            onPress={handleClearChecked}
            accessibilityLabel="チェック済みを削除"
          >
            <Trash2 size={16} color={Colors.muted} />
            <Text style={styles.clearText}>削除</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 15, fontWeight: '500', color: Colors.paper, letterSpacing: 0.5 },
  headerLink: { fontSize: 13, color: Colors.gold },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.paper,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: { opacity: 0.45 },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 2 },
  empty: { color: Colors.muted, textAlign: 'center', marginTop: 48, lineHeight: 22, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  rowText: { flex: 1, gap: 2 },
  itemName: { fontSize: 15, color: Colors.paper },
  itemNameChecked: { color: Colors.muted, textDecorationLine: 'line-through' },
  itemAmount: { fontSize: 12, color: Colors.paperDim },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  pantryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.gold,
    backgroundColor: '#150F07',
  },
  pantryButtonText: { fontSize: 14, fontWeight: '600', color: Colors.gold },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  clearText: { fontSize: 13, color: Colors.muted },
});

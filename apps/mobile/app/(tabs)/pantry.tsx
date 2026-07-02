/**
 * 在庫（パントリー, P2）— 買い物リスト画面のヘッダから開く。
 * 家の在庫を数量×単位で管理。追加・数量増減・削除。
 * 行のベルからしきい値を設定すると、残量低下でローカル通知（P3）。
 * docs/買い物リスト・在庫設計.md §5.2 / §5.5
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Bell, ChefHat, Minus, Plus, Receipt, ScanLine, Utensils, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '../../src/constants/theme';
import { checkAndNotifyLowStock } from '../../src/services/low-stock.service';
import { ensureNotificationPermission } from '../../src/services/notification.service';
import {
  addPantryItem,
  getPantryItems,
  removePantryItem,
  updatePantryItem,
} from '../../src/services/pantry.service';
import type { PantryItem } from '../../src/services/types';

export default function PantryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<PantryItem[]>([]);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [thresholdEditId, setThresholdEditId] = useState<string | null>(null);
  const [thresholdInput, setThresholdInput] = useState('');

  const refresh = useCallback(() => {
    getPantryItems()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  useFocusEffect(refresh);

  const handleAdd = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const quantity = qty.trim() ? Number(qty.trim()) : null;
    setName('');
    setQty('');
    setUnit('');
    await addPantryItem(trimmed, {
      quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
      unit: unit.trim() || null,
    }).catch(() => undefined);
    refresh();
  }, [name, qty, unit, refresh]);

  const handleAdjust = useCallback(
    async (item: PantryItem, delta: number) => {
      const next = Math.max(0, (item.quantity ?? 0) + delta);
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, quantity: next } : it)));
      await updatePantryItem(item.id, { quantity: next }).catch(() => undefined);
      refresh();
      if (delta < 0) checkAndNotifyLowStock().catch(() => undefined);
    },
    [refresh],
  );

  const handleToggleThresholdEdit = useCallback((item: PantryItem) => {
    setThresholdEditId((prev) => (prev === item.id ? null : item.id));
    setThresholdInput(item.lowStockThreshold != null ? String(item.lowStockThreshold) : '');
  }, []);

  const handleSaveThreshold = useCallback(
    async (item: PantryItem) => {
      const parsed = thresholdInput.trim() ? Number(thresholdInput.trim()) : null;
      const value = parsed != null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      setThresholdEditId(null);
      if (value != null) ensureNotificationPermission().catch(() => undefined);
      await updatePantryItem(item.id, { lowStockThreshold: value }).catch(() => undefined);
      refresh();
      checkAndNotifyLowStock().catch(() => undefined);
    },
    [thresholdInput, refresh],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      await removePantryItem(id).catch(() => undefined);
      refresh();
    },
    [refresh],
  );

  const isLow = (it: PantryItem) =>
    it.quantity != null && it.lowStockThreshold != null && it.quantity <= it.lowStockThreshold;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>在庫</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/(tabs)/consume-meal')}
            hitSlop={8}
            accessibilityLabel="食べた分を在庫から減らす"
            style={styles.headerScan}
          >
            <Utensils size={18} color={Colors.gold} />
            <Text style={styles.headerScanText}>食べた</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/receipt')}
            hitSlop={8}
            accessibilityLabel="レシートから追加"
            style={styles.headerScan}
          >
            <Receipt size={18} color={Colors.gold} />
            <Text style={styles.headerScanText}>レシート</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/scan-barcode')}
            hitSlop={8}
            accessibilityLabel="バーコードでスキャン"
            style={styles.headerScan}
          >
            <ScanLine size={18} color={Colors.gold} />
            <Text style={styles.headerScanText}>スキャン</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.addRow}>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="食材を追加（例: 玉ねぎ）"
          placeholderTextColor={Colors.muted}
          maxLength={50}
        />
        <TextInput
          style={styles.qtyInput}
          value={qty}
          onChangeText={setQty}
          placeholder="数"
          placeholderTextColor={Colors.muted}
          keyboardType="numeric"
          maxLength={6}
        />
        <TextInput
          style={styles.unitInput}
          value={unit}
          onChangeText={setUnit}
          placeholder="単位"
          placeholderTextColor={Colors.muted}
          maxLength={6}
        />
        <Pressable
          style={[styles.addButton, !name.trim() && styles.addButtonDisabled]}
          onPress={handleAdd}
          disabled={!name.trim()}
          accessibilityLabel="追加"
        >
          <Plus size={20} color={Colors.bg} />
        </Pressable>
      </View>

      {items.length > 0 && (
        <Pressable style={styles.cookableButton} onPress={() => router.push('/(tabs)/cookable')}>
          <ChefHat size={16} color={Colors.gold} />
          <Text style={styles.cookableText}>この在庫で作れるレシピ</Text>
        </Pressable>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>在庫は空です。{'\n'}食材を追加してください。</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.rowWrap}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.itemName}>{item.name}</Text>
                <View style={styles.badgeRow}>
                  {isLow(item) && <Text style={styles.lowBadge}>残りわずか</Text>}
                  {item.lowStockThreshold != null && (
                    <Text style={styles.thresholdBadge}>通知 ≤{item.lowStockThreshold}</Text>
                  )}
                </View>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => handleAdjust(item, -1)}
                  hitSlop={8}
                  accessibilityLabel="減らす"
                >
                  <Minus size={16} color={Colors.goldDim} />
                </Pressable>
                <Text style={styles.qtyText}>
                  {item.quantity ?? '—'}
                  {item.unit ? ` ${item.unit}` : ''}
                </Text>
                <Pressable
                  onPress={() => handleAdjust(item, 1)}
                  hitSlop={8}
                  accessibilityLabel="増やす"
                >
                  <Plus size={16} color={Colors.goldDim} />
                </Pressable>
              </View>
              <Pressable
                onPress={() => handleToggleThresholdEdit(item)}
                hitSlop={8}
                accessibilityLabel="残量通知のしきい値を設定"
              >
                <Bell
                  size={16}
                  color={item.lowStockThreshold != null ? Colors.gold : Colors.muted}
                />
              </Pressable>
              <Pressable
                onPress={() => handleRemove(item.id)}
                hitSlop={10}
                accessibilityLabel="削除"
              >
                <X size={16} color={Colors.muted} />
              </Pressable>
            </View>
            {thresholdEditId === item.id && (
              <View style={styles.thresholdEditor}>
                <Text style={styles.thresholdLabel}>残りいくつ以下で通知する？</Text>
                <TextInput
                  style={styles.thresholdInput}
                  value={thresholdInput}
                  onChangeText={setThresholdInput}
                  placeholder="例: 1"
                  placeholderTextColor={Colors.muted}
                  keyboardType="numeric"
                  maxLength={6}
                  autoFocus
                />
                <Pressable
                  style={styles.thresholdSave}
                  onPress={() => handleSaveThreshold(item)}
                  accessibilityLabel="しきい値を保存"
                >
                  <Text style={styles.thresholdSaveText}>
                    {thresholdInput.trim() ? '保存' : 'クリア'}
                  </Text>
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
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 15, fontWeight: '500', color: Colors.paper, letterSpacing: 0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerScan: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerScanText: { fontSize: 13, color: Colors.gold },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  nameInput: {
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
  qtyInput: {
    width: 46,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.paper,
    textAlign: 'center',
  },
  unitInput: {
    width: 56,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.paper,
    textAlign: 'center',
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
  cookableButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#150F07',
  },
  cookableText: { fontSize: 14, color: Colors.gold, fontWeight: '500' },
  listContent: { paddingHorizontal: 20, paddingBottom: 24 },
  empty: { color: Colors.muted, textAlign: 'center', marginTop: 48, lineHeight: 22, fontSize: 14 },
  rowWrap: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  rowText: { flex: 1, gap: 2 },
  badgeRow: { flexDirection: 'row', gap: 8 },
  itemName: { fontSize: 15, color: Colors.paper },
  lowBadge: { fontSize: 11, color: '#C97A4A' },
  thresholdBadge: { fontSize: 11, color: Colors.goldDim },
  thresholdEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12,
    paddingLeft: 4,
  },
  thresholdLabel: { flex: 1, fontSize: 12, color: Colors.muted },
  thresholdInput: {
    width: 64,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: '#130E08',
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    color: Colors.paper,
    textAlign: 'center',
  },
  thresholdSave: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: Colors.gold,
  },
  thresholdSaveText: { fontSize: 13, color: Colors.bg, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyText: { fontSize: 14, color: Colors.paperDim, minWidth: 48, textAlign: 'center' },
});

/**
 * 買い物リスト（集約・永続）— ホーム右上のカートから開く。
 * 手動追加・タップで即座に在庫へ（#66③）・削除。レシピからの追加は
 * レシピ詳細の「足りない材料を買い物リストに追加」から。docs/買い物リスト・在庫設計.md §5.1
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Plus, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CoachMarkOverlay } from '../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../src/components/HelpButton';
import { Toast } from '../../src/components/Toast';
import { Colors } from '../../src/constants/theme';
import { t } from '../../src/i18n';
import { useCoachMarks } from '../../src/hooks/useCoachMarks';
import { moveShoppingItemToPantry } from '../../src/services/pantry.service';
import {
  addShoppingItem,
  getShoppingItems,
  removeShoppingItem,
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

  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  // タップ＝買った、で即座に在庫へ移す（チェック→ボタン押下の2ステップを解消; #66③）
  const handleBuy = useCallback(
    async (item: ShoppingItem) => {
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      const moved = await moveShoppingItemToPantry(item).catch(() => false);
      if (moved) {
        setToastMessage(t('pantry.shopping.movedToPantry', { name: item.name }));
        setToastVisible(true);
      }
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

  // 初回利用ガイド（コーチマーク）
  const pantryLinkRef = useRef<View>(null);
  const coach = useCoachMarks('shopping', [
    {
      key: 'pantry',
      title: t('pantry.shopping.coach.linkTitle'),
      text: t('pantry.shopping.coach.linkText'),
      ref: pantryLinkRef,
    },
    {
      key: 'move',
      title: t('pantry.shopping.coach.moveTitle'),
      text: t('pantry.shopping.coach.moveText'),
    },
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel={t('common.close')}
        >
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('pantry.shopping.title')}</Text>
        <View style={styles.headerActions}>
          <HelpButton onPress={coach.show} />
          <Pressable
            ref={pantryLinkRef}
            collapsable={false}
            onPress={() => router.push('/(tabs)/pantry')}
            hitSlop={10}
            accessibilityLabel={t('pantry.title')}
          >
            <Text style={styles.headerLink}>{t('pantry.title')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={input}
          onChangeText={setInput}
          placeholder={t('pantry.shopping.addPlaceholder')}
          placeholderTextColor={Colors.muted}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
          maxLength={50}
        />
        <Pressable
          style={[styles.addButton, !input.trim() && styles.addButtonDisabled]}
          onPress={handleAdd}
          disabled={!input.trim()}
          accessibilityLabel={t('common.add')}
        >
          <Plus size={20} color={Colors.bg} />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>{t('pantry.shopping.empty')}</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              style={styles.rowMain}
              onPress={() => handleBuy(item)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('pantry.shopping.buyLabel', { name: item.name })}
            >
              <View style={styles.checkbox} />
              <View style={styles.rowText}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.amount ? <Text style={styles.itemAmount}>{item.amount}</Text> : null}
              </View>
            </Pressable>
            <Pressable
              onPress={() => handleRemove(item.id)}
              hitSlop={10}
              accessibilityLabel={t('common.delete')}
            >
              <X size={16} color={Colors.muted} />
            </Pressable>
          </View>
        )}
      />

      <Toast
        message={toastMessage}
        visible={toastVisible}
        onDismiss={() => setToastVisible(false)}
      />

      <CoachMarkOverlay
        visible={coach.visible}
        step={coach.step}
        index={coach.index}
        total={coach.total}
        onNext={coach.next}
        onSkip={coach.skip}
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
  headerLink: { fontSize: 13, color: Colors.gold },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
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
  rowText: { flex: 1, gap: 2 },
  itemName: { fontSize: 15, color: Colors.paper },
  itemAmount: { fontSize: 12, color: Colors.paperDim },
});

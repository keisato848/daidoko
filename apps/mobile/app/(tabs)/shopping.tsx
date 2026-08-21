/**
 * 買い物リスト（集約・永続）— ホーム右上のカートから開く。
 * 手動追加・タップで即座に在庫へ（#66③）・削除。レシピからの追加は
 * レシピ詳細の「足りない材料を買い物リストに追加」から。docs/買い物リスト・在庫設計.md §5.1
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Check, Plus, Store, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AdBanner } from '../../src/components/AdBanner';
import { GroupChips } from '../../src/components/GroupChips';
import { GroupPicker } from '../../src/components/GroupPicker';
import { CoachMarkOverlay } from '../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../src/components/HelpButton';
import { Toast } from '../../src/components/Toast';
import { KeyboardAvoider } from '../../src/components/KeyboardAvoider';
import { Colors } from '../../src/constants/theme';
import { t } from '../../src/i18n';
import { useCoachMarks } from '../../src/hooks/useCoachMarks';
import { moveShoppingItemToPantry, UNGROUPED } from '../../src/services/pantry.service';
import { getShoppingStoreGroups } from '../../src/services/store-group.service';
import {
  addShoppingItem,
  setShoppingItemChecked,
  setShoppingItemStore,
  getShoppingItems,
  removeShoppingItem,
} from '../../src/services/shopping-list.service';
import type { ShoppingItem } from '../../src/services/types';

export default function ShoppingListScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [input, setInput] = useState('');
  /** 絞り込み。null = すべて、UNGROUPED = 未設定 */
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  /** 追加行で選んでいる買う場所 */
  const [addStore, setAddStore] = useState<string | null>(null);
  const [storePickerFor, setStorePickerFor] = useState<'add' | string | null>(null);
  /**
   * 選べる買う場所。**リストに出ている品から作るだけでは足りない** —
   * レシートで「この店で買うもの = スーパー」と覚えさせても、まだその場所の品が
   * 1 つも無いと候補に出てこない（実機で踏んだ 2026-08-21）。対応表も混ぜる。
   */
  const [knownStores, setKnownStores] = useState<string[]>([]);

  const refresh = useCallback(() => {
    getShoppingItems()
      .then(setItems)
      .catch(() => setItems([]));
    getShoppingStoreGroups()
      .then(setKnownStores)
      .catch(() => setKnownStores([]));
  }, []);
  useFocusEffect(refresh);

  const handleAdd = useCallback(async () => {
    const name = input.trim();
    if (!name) return;
    setInput('');
    await addShoppingItem(name, undefined, { storeGroup: addStore }).catch(() => undefined);
    refresh();
  }, [input, addStore, refresh]);

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

  /** レシート消し込みの取り消し。誤照合をそのままにすると買い忘れる */
  const handleUncheck = useCallback(
    async (item: ShoppingItem) => {
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, checked: false, checkedBy: null } : it)),
      );
      await setShoppingItemChecked(item.id, false).catch(() => undefined);
      refresh();
    },
    [refresh],
  );

  const handleChangeStore = useCallback(
    async (id: string, group: string | null) => {
      setStorePickerFor(null);
      await setShoppingItemStore(id, group).catch(() => undefined);
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

  // **チップは「いま並んでいる品の買う場所」だけ。** 品が 1 つも無い場所のチップを出しても
  // 押した先が空になるだけで、絞り込みの役に立たない。
  // 作りかけの買う場所（addStore）だけは混ぜる — シートで作った直後はまだ品が無いので、
  // 混ぜないと作った先が消えてしまう
  const stores = [
    ...new Set([
      ...items.map((it) => it.storeGroup).filter((g): g is string => !!g),
      ...(addStore ? [addStore] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  // **選ぶときは覚えている場所も全部出す**（レシートで覚えた店の対応先を含む）
  const storeChoices = [...new Set([...knownStores, ...stores])].sort((a, b) => a.localeCompare(b));
  const visible = items.filter((it) => {
    if (storeFilter == null) return true;
    if (storeFilter === UNGROUPED) return it.storeGroup == null;
    return it.storeGroup === storeFilter;
  });

  return (
    <KeyboardAvoider style={styles.container}>
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

      {storeChoices.length > 0 && (
        <Pressable
          style={styles.addStoreRow}
          onPress={() => setStorePickerFor('add')}
          accessibilityLabel={t('pantry.shopping.storeGroup.pickerTitle')}
        >
          <Store size={13} color={Colors.muted} />
          <Text style={styles.addStoreText} numberOfLines={1}>
            {t('pantry.shopping.storeGroup.label')}:{' '}
            {addStore ?? t('pantry.shopping.storeGroup.ungrouped')}
          </Text>
        </Pressable>
      )}

      <GroupChips
        groups={stores}
        selected={storeFilter}
        onSelect={(group) => {
          setStoreFilter(group);
          // 絞り込み中に足した品がその場から消えないよう、追加先も合わせる
          setAddStore(group === UNGROUPED ? null : group);
        }}
        allLabel={t('pantry.shopping.storeGroup.all')}
        ungroupedLabel={t('pantry.shopping.storeGroup.ungrouped')}
        ungroupedValue={UNGROUPED}
      />

      <FlatList
        keyboardShouldPersistTaps="handled"
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>{t('pantry.shopping.empty')}</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              style={styles.rowMain}
              /* チェック済み（レシートで消し込んだ行）はタップで取り消す。
                 そのまま「買った」に流すと、在庫へ二重に積んでしまう */
              onPress={() => (item.checked ? handleUncheck(item) : handleBuy(item))}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityState={{ checked: item.checked }}
              accessibilityLabel={
                item.checked
                  ? t('pantry.shopping.uncheckLabel', { name: item.name })
                  : t('pantry.shopping.buyLabel', { name: item.name })
              }
            >
              <View style={[styles.checkbox, item.checked && styles.checkboxOn]}>
                {item.checked && <Check size={14} color={Colors.bg} />}
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.itemName, item.checked && styles.itemNameChecked]}>
                  {item.name}
                </Text>
                <View style={styles.rowBadges}>
                  {item.amount ? <Text style={styles.itemAmount}>{item.amount}</Text> : null}
                  {item.storeGroup != null && (
                    <Text style={styles.storeBadge} numberOfLines={1}>
                      {item.storeGroup}
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
            <Pressable
              onPress={() => setStorePickerFor(item.id)}
              hitSlop={8}
              accessibilityLabel={t('pantry.shopping.storeGroup.editLabel')}
            >
              <Store size={16} color={item.storeGroup != null ? Colors.gold : Colors.muted} />
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

      <GroupPicker
        visible={storePickerFor != null}
        title={t('pantry.shopping.storeGroup.pickerTitle')}
        groups={storeChoices}
        value={
          storePickerFor === 'add'
            ? addStore
            : (items.find((it) => it.id === storePickerFor)?.storeGroup ?? null)
        }
        noneLabel={t('pantry.shopping.storeGroup.none')}
        newPlaceholder={t('pantry.shopping.storeGroup.newPlaceholder')}
        createLabel={t('pantry.group.create')}
        onSelect={(group) => {
          if (storePickerFor === 'add') {
            setAddStore(group);
            setStorePickerFor(null);
            return;
          }
          if (storePickerFor) handleChangeStore(storePickerFor, group);
          else setStorePickerFor(null);
        }}
        onClose={() => setStorePickerFor(null)}
      />

      <Toast
        message={toastMessage}
        visible={toastVisible}
        onDismiss={() => setToastVisible(false)}
      />

      <AdBanner />
      <CoachMarkOverlay
        visible={coach.visible}
        step={coach.step}
        index={coach.index}
        total={coach.total}
        onNext={coach.next}
        onSkip={coach.skip}
      />
    </KeyboardAvoider>
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
  checkboxOn: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  itemName: { fontSize: 15, color: Colors.paper },
  itemNameChecked: { color: Colors.muted, textDecorationLine: 'line-through' },
  rowBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  itemAmount: { fontSize: 12, color: Colors.paperDim },
  storeBadge: { fontSize: 11, color: Colors.goldDim, maxWidth: 120 },
  addStoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  addStoreText: { fontSize: 12, color: Colors.muted, flexShrink: 1 },
});

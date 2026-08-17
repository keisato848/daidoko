/**
 * レシピ帖の編集（S4 — docs/Web共有設計.md §7）。
 *
 * 題名・収録レシピの編集と、公開設定（パスコード4桁・有効期限）を担う。
 * 共有済みの帖は「更新を反映」で **同じリンクのまま** サーバー側を差し替える
 * （PATCH — 配ったリンクを生かすのが S4 の目的）。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ChevronLeft, Plus, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '../../src/components/BottomSheet';
import { KeyboardAwareScroll } from '../../src/components/KeyboardAwareScroll';
import { Colors } from '../../src/constants/theme';
import { t } from '../../src/i18n';
import {
  getRecipeBook,
  renameRecipeBook,
  revokeSharedBook,
  setBookRecipes,
  shareRecipeBook,
  type RecipeBookDetail,
  type ShareAccessOptions,
} from '../../src/services/recipe-book.service';
import { getRecipeList } from '../../src/services/recipe.service';
import type { RecipeListItem } from '../../src/services/types';

const EXPIRY_OPTIONS = [null, 7, 30] as const;

export default function BookEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [book, setBook] = useState<RecipeBookDetail | null>(null);
  const [title, setTitle] = useState('');
  const [passcodeOn, setPasscodeOn] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<7 | 30 | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allRecipes, setAllRecipes] = useState<RecipeListItem[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    const loaded = await getRecipeBook(id).catch(() => null);
    setBook(loaded);
    if (loaded) {
      setTitle(loaded.title);
      setPasscodeOn(loaded.passcode != null);
      setPasscode(loaded.passcode ?? '');
      setExpiresInDays(loaded.expiresAt != null ? 30 : null);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const saveTitle = useCallback(async () => {
    if (!book || title.trim() === '' || title.trim() === book.title) return;
    await renameRecipeBook(book.id, title.trim()).catch(() => undefined);
    await load();
  }, [book, title, load]);

  const removeRecipe = useCallback(
    async (recipeId: string) => {
      if (!book) return;
      const next = book.items.map((i) => i.recipeId).filter((r) => r !== recipeId);
      await setBookRecipes(book.id, next).catch(() => undefined);
      await load();
    },
    [book, load],
  );

  const openPicker = useCallback(async () => {
    setAllRecipes(await getRecipeList().catch(() => []));
    setPickerOpen(true);
  }, []);

  const toggleRecipe = useCallback(
    async (recipeId: string) => {
      if (!book) return;
      const current = book.items.map((i) => i.recipeId);
      const next = current.includes(recipeId)
        ? current.filter((r) => r !== recipeId)
        : [...current, recipeId];
      await setBookRecipes(book.id, next).catch(() => undefined);
      await load();
    },
    [book, load],
  );

  const accessOptions = useCallback((): ShareAccessOptions | null => {
    if (passcodeOn && !/^\d{4}$/.test(passcode)) {
      Alert.alert(t('settings.book.title'), t('settings.book.passcodeInvalid'));
      return null;
    }
    return { passcode: passcodeOn ? passcode : null, expiresInDays };
  }, [passcodeOn, passcode, expiresInDays]);

  /** 共有（未共有 → 発行 / 共有済み → 同じリンクのまま反映） */
  const handleShare = useCallback(() => {
    if (!book || busy) return;
    const access = accessOptions();
    if (!access) return;
    const shareable = book.items.filter((i) => !i.excluded).length;
    if (shareable === 0) {
      Alert.alert(t('settings.book.title'), t('recipe.list.bookShare.allExcluded'));
      return;
    }
    const publish = async () => {
      setBusy(true);
      try {
        await saveTitle();
        await shareRecipeBook(book.id, access);
        const updated = await getRecipeBook(book.id);
        await load();
        if (updated?.shareUrl && book.shareUrl == null) {
          try {
            await Share.share({ message: `${updated.title}\n${updated.shareUrl}` });
          } catch {
            // キャンセルは無視
          }
        } else {
          Alert.alert(t('settings.book.title'), t('settings.book.updated'));
        }
      } catch {
        Alert.alert(t('settings.book.title'), t('recipe.list.bookShare.failed'));
      } finally {
        setBusy(false);
      }
    };
    if (book.shareUrl == null) {
      // 初回のみ attestation（自分で作成した内容の確認 — docs/Web共有設計.md §2-2）
      Alert.alert(t('recipe.list.bookShare.title'), t('recipe.list.bookShare.attestNote'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('recipe.list.bookShare.publish'), onPress: () => void publish() },
      ]);
    } else {
      void publish();
    }
  }, [book, busy, accessOptions, saveTitle, load]);

  const handleStop = useCallback(() => {
    if (!book) return;
    Alert.alert(t('settings.webShares.stopTitle'), t('settings.webShares.stopConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.webShares.stopAction'),
        style: 'destructive',
        onPress: () => {
          void revokeSharedBook(book.id)
            .then(load)
            .catch(() =>
              Alert.alert(t('settings.webShares.stopTitle'), t('settings.webShares.stopFailed')),
            );
        },
      },
    ]);
  }, [book, load]);

  if (!book) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
            <ChevronLeft size={20} color={Colors.goldDim} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('settings.book.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>
      </SafeAreaView>
    );
  }

  const inBook = new Set(book.items.map((i) => i.recipeId));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.book.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>
      {/* 題名・パスコードの入力欄より下に「共有する」ボタンがあるので包む */}
      <View style={styles.fill}>
        <KeyboardAwareScroll
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text style={styles.label}>{t('settings.book.name')}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            onBlur={() => void saveTitle()}
            maxLength={100}
            placeholderTextColor={Colors.muted}
          />

          <View style={styles.sectionHead}>
            <Text style={styles.label}>{t('settings.book.recipes')}</Text>
            <Pressable style={styles.addBtn} onPress={() => void openPicker()} hitSlop={6}>
              <Plus size={16} color={Colors.gold} />
              <Text style={styles.addBtnText}>{t('settings.book.addRecipes')}</Text>
            </Pressable>
          </View>
          {book.items.map((item) => (
            <View key={item.recipeId} style={styles.itemRow}>
              <Text
                style={[styles.itemTitle, item.excluded && styles.itemExcluded]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              {item.excluded && (
                <Text style={styles.excludedTag}>{t('settings.book.excludedTag')}</Text>
              )}
              <Pressable onPress={() => void removeRecipe(item.recipeId)} hitSlop={8}>
                <X size={16} color={Colors.muted} />
              </Pressable>
            </View>
          ))}
          {book.items.length === 0 && (
            <Text style={styles.emptyItems}>{t('settings.book.noRecipes')}</Text>
          )}

          {/* 公開の強度（S4-2）。人単位の権限は持てない — リンクの強度だけ */}
          <Text style={[styles.label, styles.sectionGap]}>{t('settings.book.accessTitle')}</Text>
          <Pressable style={styles.optionRow} onPress={() => setPasscodeOn((v) => !v)}>
            <View style={[styles.checkbox, passcodeOn && styles.checkboxOn]}>
              {passcodeOn && <Check size={12} color={Colors.bg} />}
            </View>
            <Text style={styles.optionLabel}>{t('settings.book.passcodeLabel')}</Text>
          </Pressable>
          {passcodeOn && (
            <TextInput
              style={[styles.input, styles.passcodeInput]}
              value={passcode}
              onChangeText={(v) => setPasscode(v.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="0000"
              placeholderTextColor={Colors.muted}
            />
          )}
          <View style={styles.expiryRow}>
            {EXPIRY_OPTIONS.map((option) => (
              <Pressable
                key={String(option)}
                style={[styles.expiryChip, expiresInDays === option && styles.expiryChipOn]}
                onPress={() => setExpiresInDays(option)}
              >
                <Text
                  style={[
                    styles.expiryChipText,
                    expiresInDays === option && styles.expiryChipTextOn,
                  ]}
                >
                  {option === null
                    ? t('settings.book.expiryNone')
                    : t('settings.book.expiryDays', { days: option })}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.shareBtn, busy && styles.btnDisabled]}
            onPress={handleShare}
            disabled={busy}
          >
            <Text style={styles.shareBtnText}>
              {busy
                ? t('recipe.list.bookShare.publishing')
                : book.shareUrl == null
                  ? t('settings.book.shareNow')
                  : t('settings.book.applyUpdate')}
            </Text>
          </Pressable>
          {book.shareUrl != null && (
            <>
              <Text style={styles.sharedNote}>{t('settings.book.sharedNote')}</Text>
              <Pressable style={styles.stopBtn} onPress={handleStop}>
                <Text style={styles.stopBtnText}>{t('settings.webShares.stopAction')}</Text>
              </Pressable>
            </>
          )}
        </KeyboardAwareScroll>
      </View>

      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('settings.book.addRecipes')}
      >
        <ScrollView style={styles.pickerList}>
          {allRecipes.map((recipe) => (
            <Pressable
              key={recipe.id}
              style={styles.pickerRow}
              onPress={() => void toggleRecipe(recipe.id)}
            >
              <View style={[styles.checkbox, inBook.has(recipe.id) && styles.checkboxOn]}>
                {inBook.has(recipe.id) && <Check size={12} color={Colors.bg} />}
              </View>
              <Text style={styles.pickerTitle} numberOfLines={1}>
                {recipe.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  backButton: { padding: 8 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '500',
    color: Colors.paper,
  },
  headerSpacer: { width: 36 },
  body: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.paperDim, marginBottom: 8 },
  sectionGap: { marginTop: 24 },
  input: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    color: Colors.paper,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  addBtnText: { fontSize: 13, fontWeight: '600', color: Colors.gold },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  itemTitle: { flex: 1, fontSize: 14, color: Colors.paper },
  itemExcluded: { color: Colors.muted },
  excludedTag: { fontSize: 11, color: Colors.muted },
  emptyItems: { fontSize: 13, color: Colors.muted, paddingVertical: 12 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  optionLabel: { fontSize: 14, color: Colors.paper },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  passcodeInput: { letterSpacing: 8, textAlign: 'center', width: 120 },
  expiryRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 20 },
  expiryChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  expiryChipOn: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  expiryChipText: { fontSize: 13, color: Colors.paperDim },
  expiryChipTextOn: { color: Colors.bg, fontWeight: '600' },
  shareBtn: {
    backgroundColor: Colors.gold,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  shareBtnText: { fontSize: 15, fontWeight: '600', color: Colors.bg },
  btnDisabled: { opacity: 0.5 },
  sharedNote: { fontSize: 12, color: Colors.paperDim, marginTop: 12, lineHeight: 18 },
  stopBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  stopBtnText: { fontSize: 14, color: '#E08A7A', fontWeight: '600' },
  pickerList: { maxHeight: 420 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickerTitle: { flex: 1, fontSize: 14, color: Colors.paper },
});

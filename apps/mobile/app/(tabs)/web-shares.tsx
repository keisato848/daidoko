/**
 * レシピ帖の管理（設定 → データ → レシピ帖）。S4 — docs/Web共有設計.md §7。
 *
 * 帖はローカルの実体。ここは一覧＋共有リンクの送付・停止だけを受け持ち、
 * 中身の編集・公開設定（パスコード・期限）は book-edit 画面が担う。
 * S2（app_meta 時代）の共有はレガシーとして表示し、停止のみできる。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { BookOpen, ChevronLeft, Share2, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import {
  deleteRecipeBook,
  getRecipeBooks,
  migrateLegacyWebShareBooks,
  revokeSharedBook,
  type RecipeBookListItem,
} from '../../src/services/recipe-book.service';

export default function WebSharesScreen() {
  const router = useRouter();
  const [books, setBooks] = useState<RecipeBookListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    await migrateLegacyWebShareBooks().catch(() => undefined);
    setBooks(await getRecipeBooks().catch(() => []));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleSend = async (book: RecipeBookListItem) => {
    if (!book.shareUrl) return;
    try {
      await Share.share({ message: `${book.title}\n${book.shareUrl}` });
    } catch {
      // キャンセルは無視
    }
  };

  const handleStop = (book: RecipeBookListItem) => {
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
  };

  const handleDelete = (book: RecipeBookListItem) => {
    Alert.alert(t('settings.webShares.deleteTitle'), t('settings.webShares.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void deleteRecipeBook(book.id)
            .then(load)
            .catch(() =>
              Alert.alert(t('settings.webShares.deleteTitle'), t('settings.webShares.stopFailed')),
            );
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.webShares.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <FlatList
        data={books}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <BookOpen size={32} color={Colors.muted} />
              <Text style={styles.emptyTitle}>{t('settings.webShares.emptyTitle')}</Text>
              <Text style={styles.emptyBody}>{t('settings.webShares.emptyBody')}</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            disabled={item.isLegacyShare}
            onPress={() => router.push({ pathname: '/(tabs)/book-edit', params: { id: item.id } })}
          >
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.cardMeta}>
                {item.isLegacyShare
                  ? t('settings.webShares.legacyNote')
                  : tCount('settings.webShares.recipeCount', item.recipeCount)}
                {item.shareUrl != null && ` · ${t('settings.webShares.shared')}`}
                {item.passcode != null && ` · ${t('settings.webShares.passcodeOn')}`}
              </Text>
            </View>
            {item.shareUrl != null && (
              <Pressable
                onPress={() => void handleSend(item)}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel={t('settings.webShares.send')}
              >
                <Share2 size={18} color={Colors.gold} />
              </Pressable>
            )}
            {item.shareUrl != null ? (
              <Pressable
                onPress={() => handleStop(item)}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel={t('settings.webShares.stopAction')}
              >
                <Trash2 size={18} color={Colors.muted} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => handleDelete(item)}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel={t('common.delete')}
              >
                <Trash2 size={18} color={Colors.muted} />
              </Pressable>
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
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
  list: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.paper },
  emptyBody: { fontSize: 13, color: Colors.paperDim, textAlign: 'center', lineHeight: 20 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: Colors.paper },
  cardMeta: { fontSize: 12, color: Colors.paperDim },
  iconBtn: { padding: 6 },
});

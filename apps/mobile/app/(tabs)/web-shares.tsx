/**
 * Web 共有の管理（設定 → データ）。公開中のレシピ帖の一覧・再共有・停止。
 * 単品レシピの共有は各レシピ詳細のメニューから管理する（ここには出さない —
 * 端末内の全レシピを走査せずに一覧できる形で持っているのは帖だけ）。
 * docs/Web共有設計.md S2。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { BookOpen, ChevronLeft, Share2, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../src/components/EmptyState';
import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import {
  getWebShareBooks,
  revokeWebShareBook,
  type WebShareBookRecord,
} from '../../src/services/web-share.service';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export default function WebSharesScreen() {
  const router = useRouter();
  const [books, setBooks] = useState<WebShareBookRecord[]>([]);

  const load = useCallback(async () => {
    setBooks(await getWebShareBooks());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleSend = async (book: WebShareBookRecord) => {
    try {
      await Share.share({ message: `${book.title}\n${book.url}` });
    } catch {
      // 共有シートのキャンセルは無視
    }
  };

  const handleStop = (book: WebShareBookRecord) => {
    Alert.alert(t('settings.webShares.stopTitle'), t('settings.webShares.stopConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.webShares.stopAction'),
        style: 'destructive',
        onPress: async () => {
          try {
            await revokeWebShareBook(book.slug);
            await load();
          } catch {
            Alert.alert(t('settings.webShares.stopTitle'), t('settings.webShares.stopFailed'));
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.paper} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.webShares.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={books}
        keyExtractor={(item) => item.slug}
        contentContainerStyle={books.length === 0 ? styles.listEmpty : styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="📖"
            title={t('settings.webShares.emptyTitle')}
            message={t('settings.webShares.emptyMessage')}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardIcon}>
              <BookOpen size={18} color={Colors.gold} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.cardMeta}>
                {`${tCount('settings.webShares.recipeCount', item.recipeCount)} · ${formatDate(item.sharedAt)}`}
              </Text>
            </View>
            <Pressable
              style={styles.cardBtn}
              onPress={() => void handleSend(item)}
              accessibilityLabel={t('settings.webShares.send')}
            >
              <Share2 size={17} color={Colors.gold} />
            </Pressable>
            <Pressable
              style={styles.cardBtn}
              onPress={() => handleStop(item)}
              accessibilityLabel={t('settings.webShares.stopAction')}
            >
              <Trash2 size={17} color={Colors.muted} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    width: 76,
  },
  backText: {
    fontSize: 14,
    color: Colors.paper,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: Colors.paper,
  },
  headerSpacer: {
    width: 76,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.paper,
  },
  cardMeta: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  cardBtn: {
    padding: 8,
  },
});

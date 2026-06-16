/**
 * Cooking-photo Gallery view (利用フロー §5)
 * Grid of all cooking-log photos, newest first. Tap a photo to open its recipe.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../src/components/EmptyState';
import { Loading } from '../src/components/Loading';
import { Colors, Typography } from '../src/constants/theme';
import { getTimeline } from '../src/services/timeline.service';
import type { TimelineEntry } from '../src/services/types';
import { flattenGalleryPhotos } from '../src/utils/gallery';

const COLUMNS = 3;

export default function GalleryScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setEntries(await getTimeline());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const photos = useMemo(() => flattenGalleryPhotos(entries), [entries]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>ギャラリー</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <Loading message="写真を読み込んでいます" />
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          numColumns={COLUMNS}
          contentContainerStyle={photos.length === 0 ? styles.emptyContainer : styles.grid}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              style={styles.cell}
              onPress={() => {
                if (item.recipeId) router.push(`/(tabs)/recipes/${item.recipeId}`);
              }}
            >
              <Image source={{ uri: item.uri }} style={styles.photo} />
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="🖼"
              title="まだ写真がありません"
              message="調理を記録するときに写真を添えると、ここに料理の記録が並びます。"
            />
          }
        />
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
  headerTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.paper,
    letterSpacing: 0.5,
  },
  headerSpacer: { width: 20 },
  grid: {
    padding: 2,
  },
  emptyContainer: {
    flexGrow: 1,
  },
  cell: {
    flex: 1 / COLUMNS,
    aspectRatio: 1,
    padding: 2,
  },
  photo: {
    flex: 1,
    borderRadius: 4,
    backgroundColor: '#1A1108',
  },
});

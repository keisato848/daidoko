/**
 * 在庫で作れるレシピ（P4）— 在庫画面から開く。
 * 各レシピの在庫充足率（在庫にある材料 / 全材料）でランキング表示。
 * docs/買い物リスト・在庫設計.md §5.4
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../../src/constants/theme';
import { getCookableRecipes, type CookableRecipe } from '../../src/services/cookable.service';

export default function CookableScreen() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<CookableRecipe[]>([]);

  const refresh = useCallback(() => {
    getCookableRecipes()
      .then(setRecipes)
      .catch(() => setRecipes([]));
  }, []);
  useFocusEffect(refresh);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>在庫で作れる</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={recipes}
        keyExtractor={(item) => item.recipeId}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>
            レシピと在庫を登録すると、{'\n'}作れるレシピが分かります。
          </Text>
        }
        renderItem={({ item }) => {
          const full = item.total > 0 && item.inStock === item.total;
          return (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/(tabs)/recipes/${item.recipeId}`)}
            >
              <View style={styles.rowTop}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.fraction, full && styles.fractionFull]}>
                  {full ? '作れる' : `${item.inStock}/${item.total}`}
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.round(item.coverage * 100)}%` }]} />
              </View>
              {!full && item.missing.length > 0 && (
                <Text style={styles.missing} numberOfLines={1}>
                  あと{item.missing.length}品: {item.missing.slice(0, 4).join('、')}
                </Text>
              )}
            </Pressable>
          );
        }}
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
  headerSpacer: { width: 20 },
  listContent: { paddingHorizontal: 20, paddingVertical: 8 },
  empty: { color: Colors.muted, textAlign: 'center', marginTop: 48, lineHeight: 22, fontSize: 14 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontSize: 15, color: Colors.paper },
  fraction: { fontSize: 13, color: Colors.paperDim },
  fractionFull: { color: Colors.gold, fontWeight: '600' },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: '#2A2114', overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: Colors.gold },
  missing: { fontSize: 12, color: Colors.muted },
});

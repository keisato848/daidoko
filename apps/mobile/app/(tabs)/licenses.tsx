/**
 * OSS license information screen.
 */
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LICENSE_ITEMS } from '../../src/constants/licenses';
import { Colors } from '../../src/constants/theme';

export default function LicensesScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>ライセンス情報</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryTitle}>オープンソースライセンス</Text>
          <Text style={styles.summaryText}>
            だいどこは以下の OSS
            パッケージを利用しています。各パッケージの著作権表示と完全なライセンス本文は配布元のパッケージに従います。
          </Text>
        </View>

        {LICENSE_ITEMS.map((item) => (
          <View key={item.packageName} style={styles.licenseRow}>
            <View style={styles.licenseHeader}>
              <Text style={styles.packageName}>{item.packageName}</Text>
              <View style={styles.licenseBadge}>
                <Text style={styles.licenseBadgeText}>{item.license}</Text>
              </View>
            </View>
            <Text style={styles.purpose}>{item.purpose}</Text>
          </View>
        ))}
      </ScrollView>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: Colors.paper,
  },
  headerSpacer: { width: 36 },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 12,
  },
  summaryBox: {
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.bgCard,
    gap: 8,
    marginBottom: 4,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.paper,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
    lineHeight: 20,
  },
  licenseRow: {
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.bgCard,
    gap: 8,
  },
  licenseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  packageName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.paper,
  },
  licenseBadge: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.goldDim,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  licenseBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.gold,
  },
  purpose: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
    lineHeight: 19,
  },
});

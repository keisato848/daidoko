/**
 * Local backup / restore screen.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, DatabaseBackup, RotateCcw } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Toast } from '../../src/components/Toast';
import { Colors } from '../../src/constants/theme';
import {
  createLocalBackup,
  listLocalBackups,
  pickLatestBackup,
  restoreLatestLocalBackup,
  type BackupFileSummary,
} from '../../src/services/backup.service';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return '日時不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function BackupScreen() {
  const router = useRouter();
  const [backups, setBackups] = useState<BackupFileSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const latest = pickLatestBackup(backups);

  const refresh = useCallback(async () => {
    setBackups(await listLocalBackups());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh().catch((error) => {
        const message =
          error instanceof Error ? error.message : 'バックアップ一覧を取得できませんでした';
        setToastMessage(message);
      });
    }, [refresh]),
  );

  const handleCreate = useCallback(async () => {
    setBusy(true);
    try {
      const result = await createLocalBackup();
      await refresh();
      setToastMessage(`バックアップを作成しました (${formatSize(result.sizeBytes)})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'バックアップ作成に失敗しました';
      Alert.alert('バックアップできませんでした', message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleRestore = useCallback(() => {
    if (!latest) {
      Alert.alert('復元できません', 'バックアップがまだありません。');
      return;
    }

    Alert.alert(
      '最新バックアップから復元',
      `${formatDate(latest.exportedAt)} のバックアップで現在の端末内データを置き換えます。よろしいですか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '復元する',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void restoreLatestLocalBackup()
              .then((result) => {
                setToastMessage(`復元しました: ${result.fileName}`);
                return refresh();
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : '復元に失敗しました';
                Alert.alert('復元できませんでした', message);
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }, [latest, refresh]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>バックアップ・復元</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>最新バックアップ</Text>
          <Text style={styles.summaryTitle}>
            {latest ? formatDate(latest.exportedAt) : '未作成'}
          </Text>
          <Text style={styles.summaryMeta}>
            {latest
              ? `${latest.fileName} / ${formatSize(latest.sizeBytes)}`
              : 'この端末内に保存します'}
          </Text>
        </View>

        <View style={styles.actionGroup}>
          <Pressable
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={busy}
          >
            <DatabaseBackup size={18} color={Colors.bg} />
            <Text style={styles.primaryButtonText}>
              {busy ? '処理中...' : 'バックアップを作成'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, (!latest || busy) && styles.buttonDisabled]}
            onPress={handleRestore}
            disabled={!latest || busy}
          >
            <RotateCcw size={18} color={Colors.gold} />
            <Text style={styles.secondaryButtonText}>最新バックアップから復元</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>保存済みバックアップ</Text>
          {backups.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>バックアップはまだありません</Text>
            </View>
          ) : (
            backups.map((backup) => (
              <View key={backup.uri} style={styles.backupRow}>
                <Text style={styles.backupName} numberOfLines={1}>
                  {backup.fileName}
                </Text>
                <Text style={styles.backupMeta}>
                  {formatDate(backup.exportedAt)} / {formatSize(backup.sizeBytes)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Toast
        message={toastMessage ?? ''}
        visible={toastMessage != null}
        onDismiss={() => setToastMessage(null)}
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
    gap: 18,
  },
  summaryCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.bgCard,
    padding: 18,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 1,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: Colors.paper,
  },
  summaryMeta: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  actionGroup: {
    gap: 12,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.bg,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.goldDim,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.gold,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 1.5,
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.paperDim,
  },
  backupRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 14,
    backgroundColor: Colors.bgCard,
    gap: 4,
  },
  backupName: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.paper,
  },
  backupMeta: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.paperDim,
  },
});

/**
 * Local backup / restore screen.
 */
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  ChevronLeft,
  DatabaseBackup,
  Download,
  FolderOutput,
  RotateCcw,
  Share2,
  Upload,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Toast } from '../../src/components/Toast';
import { Colors } from '../../src/constants/theme';
import {
  AUTO_SNAPSHOT_KEEP,
  chooseSafBackupDirectory,
  clearSafBackupDirectory,
  createMigrationBackupPackage,
  createLocalBackup,
  exportFileToSafDirectory,
  getLastBackupExportAt,
  getSafBackupDirectory,
  listMigrationBackupPackages,
  listLocalBackups,
  markBackupExported,
  pickLatestBackup,
  restoreMigrationBackupPackage,
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

/** 最後の外部退避の表示（未実施 / N日前）。30日超は警告扱い。 */
function describeLastExport(iso: string | null): { text: string; warn: boolean } {
  if (!iso) return { text: '外部への退避はまだ実施されていません', warn: true };
  const elapsedDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (elapsedDays <= 0) return { text: '最後の外部退避: 今日', warn: false };
  return { text: `最後の外部退避: ${elapsedDays}日前`, warn: elapsedDays > 30 };
}

export default function BackupScreen() {
  const router = useRouter();
  const [backups, setBackups] = useState<BackupFileSummary[]>([]);
  const [migrationBackups, setMigrationBackups] = useState<BackupFileSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [safDirectory, setSafDirectory] = useState<string | null>(null);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  const latest = pickLatestBackup(backups);
  const latestMigration = pickLatestBackup(migrationBackups);
  const lastExport = describeLastExport(lastExportAt);

  const refresh = useCallback(async () => {
    const [localBackups, migrationPackages, safDir, exportedAt] = await Promise.all([
      listLocalBackups(),
      listMigrationBackupPackages(),
      getSafBackupDirectory(),
      getLastBackupExportAt(),
    ]);
    setBackups(localBackups);
    setMigrationBackups(migrationPackages);
    setSafDirectory(safDir);
    setLastExportAt(exportedAt);
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

  const handleCreateMigration = useCallback(async () => {
    setBusy(true);
    try {
      const result = await createMigrationBackupPackage();
      // 外部退避先が設定済みなら自動でコピーする
      let exportedNote = '';
      try {
        if (await exportFileToSafDirectory(result.uri, result.fileName, 'application/zip')) {
          exportedNote = ' / 保存先フォルダへ書き出し済み';
        }
      } catch {
        exportedNote = ' / 保存先フォルダへの書き出しに失敗（保存先を再選択してください）';
      }
      await refresh();
      setToastMessage(
        `移行ファイルを作成しました (${formatSize(result.sizeBytes)} / 写真${result.photoCount}枚)${exportedNote}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '移行ファイル作成に失敗しました';
      Alert.alert('移行ファイルを作成できませんでした', message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleShareMigration = useCallback(async () => {
    if (!latestMigration) {
      Alert.alert('共有できません', '移行ファイルがまだありません。');
      return;
    }

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert('共有できません', 'この端末では共有シートを利用できません。');
        return;
      }

      await Sharing.shareAsync(latestMigration.uri, {
        dialogTitle: 'だいどこの移行バックアップを共有',
        mimeType: 'application/zip',
        UTI: 'public.zip',
      });
      // 共有シートを開いて戻ってきたら退避扱い（送信の成否までは OS から取得できない）
      await markBackupExported();
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : '移行ファイル共有に失敗しました';
      Alert.alert('共有できませんでした', message);
    }
  }, [latestMigration, refresh]);

  const handleChooseSafDirectory = useCallback(async () => {
    try {
      const directoryUri = await chooseSafBackupDirectory();
      if (directoryUri) {
        await refresh();
        setToastMessage('保存先フォルダを設定しました（以後の自動スナップショットも書き出します）');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存先を選択できませんでした';
      Alert.alert('保存先を選択できませんでした', message);
    }
  }, [refresh]);

  const handleClearSafDirectory = useCallback(async () => {
    await clearSafBackupDirectory();
    await refresh();
    setToastMessage('保存先フォルダを解除しました');
  }, [refresh]);

  const handleImportMigration = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: [
          'application/zip',
          'application/octet-stream',
          'application/x-zip-compressed',
          '*/*',
        ],
      });
      if (picked.canceled || picked.assets.length === 0) return;

      const asset = picked.assets[0];
      Alert.alert(
        '移行ファイルから復元',
        `${asset.name} で現在の端末内データを置き換えます。よろしいですか？`,
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '復元する',
            style: 'destructive',
            onPress: () => {
              setBusy(true);
              void restoreMigrationBackupPackage(asset.uri)
                .then((result) => {
                  setToastMessage(
                    `移行ファイルから復元しました (写真${result.restoredPhotoCount}枚)`,
                  );
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '移行ファイルを選択できませんでした';
      Alert.alert('移行ファイルを選択できませんでした', message);
    }
  }, [refresh]);

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
              : `週1回自動で作成し、最新${AUTO_SNAPSHOT_KEEP}件を保持します`}
          </Text>
          <Text style={styles.summaryNote}>
            端末内（アプリ領域）に保存します — アンインストールで消えるため、大切なデータは下の
            移行ファイルの共有か保存先フォルダへの書き出しで外部にも退避してください
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

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>機種変更バックアップ</Text>
          <Text style={styles.summaryTitle}>
            {latestMigration ? formatDate(latestMigration.exportedAt) : '未作成'}
          </Text>
          <Text style={styles.summaryMeta}>
            {latestMigration
              ? `${latestMigration.fileName} / ${formatSize(latestMigration.sizeBytes)}`
              : 'すべての写真（調理記録・表紙・手順）を含む移行ファイルを作成します'}
          </Text>
          <Text style={[styles.summaryNote, lastExport.warn && styles.summaryNoteWarn]}>
            {lastExport.text}
          </Text>
        </View>

        <View style={styles.actionGroup}>
          <Pressable
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            onPress={handleCreateMigration}
            disabled={busy}
          >
            <Download size={18} color={Colors.bg} />
            <Text style={styles.primaryButtonText}>移行ファイルを作成</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, (!latestMigration || busy) && styles.buttonDisabled]}
            onPress={handleShareMigration}
            disabled={!latestMigration || busy}
          >
            <Share2 size={18} color={Colors.gold} />
            <Text style={styles.secondaryButtonText}>最新移行ファイルを共有</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, busy && styles.buttonDisabled]}
            onPress={handleImportMigration}
            disabled={busy}
          >
            <Upload size={18} color={Colors.gold} />
            <Text style={styles.secondaryButtonText}>移行ファイルから復元</Text>
          </Pressable>
        </View>

        {Platform.OS === 'android' ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>外部の保存先フォルダ</Text>
            <Text style={styles.summaryTitle}>{safDirectory ? '設定済み' : '未設定'}</Text>
            <Text style={styles.summaryMeta}>
              Google ドライブ等のフォルダを選ぶと、移行ファイルと週次の自動スナップショットを
              自動で書き出します（アンインストールしても残ります）
            </Text>
            <View style={styles.safButtonRow}>
              <Pressable
                style={[styles.secondaryButton, styles.safButton, busy && styles.buttonDisabled]}
                onPress={handleChooseSafDirectory}
                disabled={busy}
              >
                <FolderOutput size={18} color={Colors.gold} />
                <Text style={styles.secondaryButtonText}>
                  {safDirectory ? '保存先を変更' : '保存先フォルダを選ぶ'}
                </Text>
              </Pressable>
              {safDirectory != null && (
                <Pressable
                  style={[styles.secondaryButton, styles.safButton, busy && styles.buttonDisabled]}
                  onPress={handleClearSafDirectory}
                  disabled={busy}
                >
                  <Text style={styles.secondaryButtonText}>解除</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>iCloud バックアップ</Text>
            <Text style={styles.summaryMeta}>
              iOS では端末の iCloud バックアップにアプリのデータ（レシピ・写真）が自動で含まれます
            </Text>
          </View>
        )}

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
  summaryNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.muted,
    lineHeight: 17,
  },
  summaryNoteWarn: {
    color: '#D9A05B',
  },
  safButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  safButton: {
    flex: 1,
    minHeight: 44,
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

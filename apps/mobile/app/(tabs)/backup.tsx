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
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Toast } from '../../src/components/Toast';
import { Colors } from '../../src/constants/theme';
import { t, tCount } from '../../src/i18n';
import { formatDateTime } from '../../src/i18n/format';
import { dialog } from '../../src/services/dialog.service';
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
import { onLocalDataReplaced } from '../../src/services/sync-runner.service';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return t('backup.unknownDate');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDateTime(date);
}

/** 最後の外部退避の表示（未実施 / N日前）。30日超は警告扱い。 */
function describeLastExport(iso: string | null): { text: string; warn: boolean } {
  if (!iso) return { text: t('backup.lastExport.never'), warn: true };
  const elapsedDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (elapsedDays <= 0) return { text: t('backup.lastExport.today'), warn: false };
  return {
    text: tCount('backup.lastExport.daysAgo', elapsedDays),
    warn: elapsedDays > 30,
  };
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
        const message = error instanceof Error ? error.message : t('backup.listFailed');
        setToastMessage(message);
      });
    }, [refresh]),
  );

  const handleCreate = useCallback(async () => {
    setBusy(true);
    try {
      const result = await createLocalBackup();
      await refresh();
      setToastMessage(t('backup.create.done', { size: formatSize(result.sizeBytes) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('backup.create.failed');
      void dialog.alert({ title: t('backup.create.failedTitle'), message });
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleRestore = useCallback(async () => {
    if (!latest) {
      void dialog.alert({
        title: t('backup.restore.unavailableTitle'),
        message: t('backup.restore.noBackup'),
      });
      return;
    }

    const confirmed = await dialog.confirm({
      title: t('backup.restore.title'),
      message: t('backup.restore.confirm', { date: formatDate(latest.exportedAt) }),
      confirmLabel: t('backup.restore.confirmAction'),
      destructive: true,
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const result = await restoreLatestLocalBackup();
      setToastMessage(t('backup.restore.done', { name: result.fileName }));
      // 復元でローカルが丸ごと入れ替わった。同期のカーソルを戻して
      // サーバーと取り直す（どちらが残るかは LWW が決める）
      await onLocalDataReplaced().catch(() => undefined);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('backup.restore.failed');
      void dialog.alert({ title: t('backup.restore.failedTitle'), message });
    } finally {
      setBusy(false);
    }
  }, [latest, refresh]);

  const handleCreateMigration = useCallback(async () => {
    setBusy(true);
    try {
      const result = await createMigrationBackupPackage();
      // 外部退避先が設定済みなら自動でコピーする
      let exportedNote = '';
      try {
        if (await exportFileToSafDirectory(result.uri, result.fileName, 'application/zip')) {
          exportedNote = t('backup.migration.exportedNote');
        }
      } catch {
        exportedNote = t('backup.migration.exportFailedNote');
      }
      await refresh();
      setToastMessage(
        tCount('backup.migration.created', result.photoCount, {
          size: formatSize(result.sizeBytes),
          note: exportedNote,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : t('backup.migration.createFailed');
      void dialog.alert({ title: t('backup.migration.createFailedTitle'), message });
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleShareMigration = useCallback(async () => {
    if (!latestMigration) {
      void dialog.alert({
        title: t('backup.share.unavailableTitle'),
        message: t('backup.share.noFile'),
      });
      return;
    }

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        void dialog.alert({
          title: t('backup.share.unavailableTitle'),
          message: t('backup.share.notSupported'),
        });
        return;
      }

      await Sharing.shareAsync(latestMigration.uri, {
        dialogTitle: t('backup.share.dialogTitle'),
        mimeType: 'application/zip',
        UTI: 'public.zip',
      });
      // 共有シートを開いて戻ってきたら退避扱い（送信の成否までは OS から取得できない）
      await markBackupExported();
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('backup.share.failed');
      void dialog.alert({ title: t('backup.share.failedTitle'), message });
    }
  }, [latestMigration, refresh]);

  const handleChooseSafDirectory = useCallback(async () => {
    try {
      const directoryUri = await chooseSafBackupDirectory();
      if (directoryUri) {
        await refresh();
        setToastMessage(t('backup.saf.set'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('backup.saf.chooseFailed');
      void dialog.alert({ title: t('backup.saf.chooseFailed'), message });
    }
  }, [refresh]);

  const handleClearSafDirectory = useCallback(async () => {
    await clearSafBackupDirectory();
    await refresh();
    setToastMessage(t('backup.saf.cleared'));
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
      const confirmed = await dialog.confirm({
        title: t('backup.migration.importTitle'),
        message: t('backup.migration.importConfirm', { name: asset.name }),
        confirmLabel: t('backup.restore.confirmAction'),
        destructive: true,
      });
      if (!confirmed) return;

      setBusy(true);
      try {
        const result = await restoreMigrationBackupPackage(asset.uri);
        setToastMessage(tCount('backup.migration.imported', result.restoredPhotoCount));
        // 復元でローカルが丸ごと入れ替わった。同期のカーソルを戻して
        // サーバーと取り直す（どちらが残るかは LWW が決める）
        await onLocalDataReplaced().catch(() => undefined);
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : t('backup.restore.failed');
        void dialog.alert({ title: t('backup.restore.failedTitle'), message });
      } finally {
        setBusy(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('backup.migration.pickFailed');
      void dialog.alert({ title: t('backup.migration.pickFailed'), message });
    }
  }, [refresh]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={20} color={Colors.goldDim} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('backup.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t('backup.summary.latestLabel')}</Text>
          <Text style={styles.summaryTitle}>
            {latest ? formatDate(latest.exportedAt) : t('backup.summary.none')}
          </Text>
          <Text style={styles.summaryMeta}>
            {latest
              ? `${latest.fileName} / ${formatSize(latest.sizeBytes)}`
              : tCount('backup.summary.autoNote', AUTO_SNAPSHOT_KEEP)}
          </Text>
          <Text style={styles.summaryNote}>{t('backup.summary.localNote')}</Text>
        </View>

        <View style={styles.actionGroup}>
          <Pressable
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={busy}
          >
            <DatabaseBackup size={18} color={Colors.bg} />
            <Text style={styles.primaryButtonText}>
              {busy ? t('backup.busy') : t('backup.create.action')}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, (!latest || busy) && styles.buttonDisabled]}
            onPress={handleRestore}
            disabled={!latest || busy}
          >
            <RotateCcw size={18} color={Colors.gold} />
            <Text style={styles.secondaryButtonText}>{t('backup.restore.action')}</Text>
          </Pressable>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t('backup.migration.label')}</Text>
          <Text style={styles.summaryTitle}>
            {latestMigration ? formatDate(latestMigration.exportedAt) : t('backup.summary.none')}
          </Text>
          <Text style={styles.summaryMeta}>
            {latestMigration
              ? `${latestMigration.fileName} / ${formatSize(latestMigration.sizeBytes)}`
              : t('backup.migration.note')}
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
            <Text style={styles.primaryButtonText}>{t('backup.migration.createAction')}</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, (!latestMigration || busy) && styles.buttonDisabled]}
            onPress={handleShareMigration}
            disabled={!latestMigration || busy}
          >
            <Share2 size={18} color={Colors.gold} />
            <Text style={styles.secondaryButtonText}>{t('backup.migration.shareAction')}</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, busy && styles.buttonDisabled]}
            onPress={handleImportMigration}
            disabled={busy}
          >
            <Upload size={18} color={Colors.gold} />
            <Text style={styles.secondaryButtonText}>{t('backup.migration.importAction')}</Text>
          </Pressable>
        </View>

        {Platform.OS === 'android' ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t('backup.saf.label')}</Text>
            <Text style={styles.summaryTitle}>
              {safDirectory ? t('backup.saf.configured') : t('backup.saf.notConfigured')}
            </Text>
            <Text style={styles.summaryMeta}>{t('backup.saf.note')}</Text>
            <View style={styles.safButtonRow}>
              <Pressable
                style={[styles.secondaryButton, styles.safButton, busy && styles.buttonDisabled]}
                onPress={handleChooseSafDirectory}
                disabled={busy}
              >
                <FolderOutput size={18} color={Colors.gold} />
                <Text style={styles.secondaryButtonText}>
                  {safDirectory ? t('backup.saf.change') : t('backup.saf.choose')}
                </Text>
              </Pressable>
              {safDirectory != null && (
                <Pressable
                  style={[styles.secondaryButton, styles.safButton, busy && styles.buttonDisabled]}
                  onPress={handleClearSafDirectory}
                  disabled={busy}
                >
                  <Text style={styles.secondaryButtonText}>{t('backup.saf.clear')}</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{t('backup.icloud.label')}</Text>
            <Text style={styles.summaryMeta}>{t('backup.icloud.note')}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('backup.saved.title')}</Text>
          {backups.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{t('backup.saved.empty')}</Text>
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

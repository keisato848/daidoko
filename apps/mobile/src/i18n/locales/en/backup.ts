import type ja from '../ja/backup';

const backup: typeof ja = {
  title: 'Backup & restore',
  unknownDate: 'Date unknown',
  listFailed: "We couldn't load your backups",
  busy: 'Working…',

  lastExport: {
    never: 'You haven’t saved a copy outside the app yet',
    today: 'Last saved outside the app: today',
    daysAgo: {
      one: 'Last saved outside the app: {{count}} day ago',
      other: 'Last saved outside the app: {{count}} days ago',
    },
  },

  summary: {
    latestLabel: 'Latest backup',
    none: 'None yet',
    autoNote: {
      one: 'Created automatically once a week; the most recent {{count}} is kept',
      other: 'Created automatically once a week; the most recent {{count}} are kept',
    },
    localNote:
      'Stored inside the app on this device — it is deleted if you uninstall. For anything you care about, also keep a copy outside the app by sharing a transfer file or writing to a folder below.',
  },

  create: {
    action: 'Create a backup',
    done: 'Backup created ({{size}})',
    failed: 'Creating the backup failed',
    failedTitle: "Couldn't back up",
  },

  restore: {
    action: 'Restore from latest backup',
    confirmAction: 'Restore',
    unavailableTitle: "Can't restore",
    noBackup: 'There are no backups yet.',
    title: 'Restore from latest backup',
    confirm: {
      text: 'This will replace all data on this device with the backup from {{date}}. Continue?',
      intent:
        'MUST convey that the current on-device data will be REPLACED (not merged, not added to), ' +
        'and MUST name which backup will replace it. MUST NOT be softened to "restore" alone — ' +
        'the user must understand the current data is lost.',
    },
    done: 'Restored: {{name}}',
    failed: 'Restoring failed',
    failedTitle: "Couldn't restore",
  },

  migration: {
    label: 'Transfer to a new phone',
    note: 'Creates a transfer file that includes every photo (cooking records, covers and steps)',
    createAction: 'Create transfer file',
    shareAction: 'Share latest transfer file',
    importAction: 'Restore from transfer file',
    exportedNote: ' / written to your chosen folder',
    exportFailedNote: " / couldn't write to your chosen folder (pick the folder again)",
    created: {
      one: 'Transfer file created ({{size}} / {{count}} photo){{note}}',
      other: 'Transfer file created ({{size}} / {{count}} photos){{note}}',
    },
    createFailed: 'Creating the transfer file failed',
    createFailedTitle: "Couldn't create the transfer file",
    importTitle: 'Restore from transfer file',
    importConfirm: {
      text: 'This will replace all data on this device with {{name}}. Continue?',
      intent:
        'MUST convey that the current on-device data will be REPLACED (not merged), and MUST name ' +
        'the file that replaces it. MUST NOT be softened — the current data is lost.',
    },
    imported: {
      one: 'Restored from transfer file ({{count}} photo)',
      other: 'Restored from transfer file ({{count}} photos)',
    },
    pickFailed: "Couldn't open that transfer file",
  },

  share: {
    unavailableTitle: "Can't share",
    noFile: 'There are no transfer files yet.',
    notSupported: 'Sharing is not available on this device.',
    dialogTitle: 'Share DAIDOKO transfer backup',
    failed: 'Sharing the transfer file failed',
    failedTitle: "Couldn't share",
  },

  saf: {
    label: 'Folder outside the app',
    configured: 'Set',
    notConfigured: 'Not set',
    note: 'Choose a folder (Google Drive works) and transfer files plus the weekly automatic snapshots are written there. They survive uninstalling the app.',
    choose: 'Choose a folder',
    change: 'Change folder',
    clear: 'Clear',
    set: 'Folder set — automatic snapshots will be written there from now on',
    chooseFailed: "Couldn't choose that folder",
    cleared: 'Folder cleared',
  },

  icloud: {
    label: 'iCloud backup',
    note: 'On iOS, your recipes and photos are included automatically in the device’s iCloud backup',
  },

  saved: {
    title: 'Saved backups',
    empty: 'No backups yet',
  },

  invalid: {
    notNative: 'Backup and restore are only available in the mobile app',
    noStorage: "We couldn't access file storage",
    format: 'That backup file is not in a valid format',
    unsupportedFormat: 'That backup format is not supported',
    exportedAt: 'The backup date is invalid',
    tables: 'The backup tables are invalid',
    tableRows: 'The backup contents for {{table}} are invalid',
    photoEntry: 'A photo backup entry is invalid',
    photoPath: 'A photo backup path is invalid',
    photoId: 'A photo backup ID is invalid',
    photoFileName: 'A photo backup file name is invalid',
    photoOriginalPath: 'A photo backup source path is invalid',
    recipePhotoEntry: 'A recipe photo backup entry is invalid',
    recipePhotoKind: 'A recipe photo backup type is invalid',
    recipePhotoPath: 'A recipe photo backup path is invalid',
    recipePhotoId: 'A recipe photo backup ID is invalid',
    recipePhotoFileName: 'A recipe photo backup file name is invalid',
    recipePhotoOriginalPath: 'A recipe photo backup source path is invalid',
    migrationFormat: 'That transfer file format is not supported',
    migrationExportedAt: 'The transfer file date is invalid',
    migrationData: 'The transfer file data is invalid',
    photoList: 'The photo backup list is invalid',
    recipePhotoList: 'The recipe photo backup list is invalid',
    base64: 'The Base64 data is invalid',
    manifestMissing: 'The transfer file has no manifest',
    nothingToRestore: 'There is no backup to restore',
  },
};

export default backup;

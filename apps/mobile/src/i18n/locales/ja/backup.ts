/**
 * バックアップ・復元画面。
 *
 * 復元は**端末内のデータを丸ごと置き換える**。取り消せないので、
 * 確認文はどれも A 階層。
 */
import type { CriticalMessage, PluralMessage } from '../../types';

const backup = {
  title: 'バックアップ・復元',
  unknownDate: '日時不明',
  listFailed: 'バックアップ一覧を取得できませんでした',
  busy: '処理中...',

  /** 外部退避の督促。30日を超えると警告表示に変わる。 */
  lastExport: {
    never: '外部への退避はまだ実施されていません',
    today: '最後の外部退避: 今日',
    daysAgo: {
      one: '最後の外部退避: {{count}}日前',
      other: '最後の外部退避: {{count}}日前',
    } satisfies PluralMessage,
  },

  summary: {
    latestLabel: '最新バックアップ',
    none: '未作成',
    autoNote: {
      one: '週1回自動で作成し、最新{{count}}件を保持します',
      other: '週1回自動で作成し、最新{{count}}件を保持します',
    } satisfies PluralMessage,
    localNote:
      '端末内（アプリ領域）に保存します — アンインストールで消えるため、大切なデータは下の移行ファイルの共有か保存先フォルダへの書き出しで外部にも退避してください',
  },

  create: {
    action: 'バックアップを作成',
    done: 'バックアップを作成しました ({{size}})',
    failed: 'バックアップ作成に失敗しました',
    failedTitle: 'バックアップできませんでした',
  },

  restore: {
    action: '最新バックアップから復元',
    confirmAction: '復元する',
    unavailableTitle: '復元できません',
    noBackup: 'バックアップがまだありません。',
    title: '最新バックアップから復元',
    /** **現在のデータを消す**確認。弱めると事故になる。 */
    confirm: {
      text: '{{date}} のバックアップで現在の端末内データを置き換えます。よろしいですか？',
      intent:
        'MUST convey that the current on-device data will be REPLACED (not merged, not added to), ' +
        'and MUST name which backup will replace it. MUST NOT be softened to "restore" alone — ' +
        'the user must understand the current data is lost.',
    } satisfies CriticalMessage,
    done: '復元しました: {{name}}',
    failed: '復元に失敗しました',
    failedTitle: '復元できませんでした',
  },

  migration: {
    label: '機種変更バックアップ',
    note: 'すべての写真（調理記録・表紙・手順）を含む移行ファイルを作成します',
    createAction: '移行ファイルを作成',
    shareAction: '最新移行ファイルを共有',
    importAction: '移行ファイルから復元',
    exportedNote: ' / 保存先フォルダへ書き出し済み',
    exportFailedNote: ' / 保存先フォルダへの書き出しに失敗（保存先を再選択してください）',
    created: {
      one: '移行ファイルを作成しました ({{size}} / 写真{{count}}枚){{note}}',
      other: '移行ファイルを作成しました ({{size}} / 写真{{count}}枚){{note}}',
    } satisfies PluralMessage,
    createFailed: '移行ファイル作成に失敗しました',
    createFailedTitle: '移行ファイルを作成できませんでした',
    importTitle: '移行ファイルから復元',
    /** 移行ファイルからの復元も、現在のデータを置き換える。 */
    importConfirm: {
      text: '{{name}} で現在の端末内データを置き換えます。よろしいですか？',
      intent:
        'MUST convey that the current on-device data will be REPLACED (not merged), and MUST name ' +
        'the file that replaces it. MUST NOT be softened — the current data is lost.',
    } satisfies CriticalMessage,
    imported: {
      one: '移行ファイルから復元しました (写真{{count}}枚)',
      other: '移行ファイルから復元しました (写真{{count}}枚)',
    } satisfies PluralMessage,
    pickFailed: '移行ファイルを選択できませんでした',
  },

  share: {
    unavailableTitle: '共有できません',
    noFile: '移行ファイルがまだありません。',
    notSupported: 'この端末では共有シートを利用できません。',
    dialogTitle: 'だいどこの移行バックアップを共有',
    failed: '移行ファイル共有に失敗しました',
    failedTitle: '共有できませんでした',
  },

  /** Android の保存先フォルダ（SAF）。iOS には無い。 */
  saf: {
    label: '外部の保存先フォルダ',
    configured: '設定済み',
    notConfigured: '未設定',
    note: 'Google ドライブ等のフォルダを選ぶと、移行ファイルと週次の自動スナップショットを自動で書き出します（アンインストールしても残ります）',
    choose: '保存先フォルダを選ぶ',
    change: '保存先を変更',
    clear: '解除',
    set: '保存先フォルダを設定しました（以後の自動スナップショットも書き出します）',
    chooseFailed: '保存先を選択できませんでした',
    cleared: '保存先フォルダを解除しました',
  },

  icloud: {
    label: 'iCloud バックアップ',
    note: 'iOS では端末の iCloud バックアップにアプリのデータ（レシピ・写真）が自動で含まれます',
  },

  saved: {
    title: '保存済みバックアップ',
    empty: 'バックアップはまだありません',
  },

  /**
   * ファイルの検証で出る失敗。**C 階層**（意味が多少ずれても、
   * ユーザーの取れる行動は「別のファイルを試す／問い合わせる」で変わらない）。
   * ただし英語ロケールで日本語を出さないために辞書へは載せる。
   */
  invalid: {
    notNative: 'バックアップ・復元はネイティブアプリでのみ利用できます',
    noStorage: 'ファイル保存領域を取得できませんでした',
    format: 'バックアップ形式が不正です',
    unsupportedFormat: '対応していないバックアップ形式です',
    exportedAt: 'バックアップ日時が不正です',
    tables: 'バックアップテーブルが不正です',
    tableRows: '{{table}} のバックアップ内容が不正です',
    photoEntry: '写真バックアップ情報が不正です',
    photoPath: '写真バックアップのパスが不正です',
    photoId: '写真バックアップのIDが不正です',
    photoFileName: '写真バックアップのファイル名が不正です',
    photoOriginalPath: '写真バックアップの元パスが不正です',
    recipePhotoEntry: 'レシピ写真バックアップ情報が不正です',
    recipePhotoKind: 'レシピ写真バックアップの種別が不正です',
    recipePhotoPath: 'レシピ写真バックアップのパスが不正です',
    recipePhotoId: 'レシピ写真バックアップのIDが不正です',
    recipePhotoFileName: 'レシピ写真バックアップのファイル名が不正です',
    recipePhotoOriginalPath: 'レシピ写真バックアップの元パスが不正です',
    migrationFormat: '対応していない移行バックアップ形式です',
    migrationExportedAt: '移行バックアップ日時が不正です',
    migrationData: '移行バックアップのデータが不正です',
    photoList: '写真バックアップ一覧が不正です',
    recipePhotoList: 'レシピ写真バックアップ一覧が不正です',
    base64: 'Base64 データが不正です',
    manifestMissing: '移行バックアップの manifest が見つかりません',
    nothingToRestore: '復元できるバックアップがありません',
  },
};

export default backup;

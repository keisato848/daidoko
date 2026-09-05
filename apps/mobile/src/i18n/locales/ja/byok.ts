/**
 * 自分の AI キー（BYOK）。
 *
 * この画面の説明文は**どこにデータが行くか**の説明そのものなので、
 * 保存場所・送信先・削除方法・移行の扱いは A 階層。
 */
import type { CriticalMessage } from '../../types';

const byok = {
  title: '自分のAIキー',
  heading: '自分の Gemini API',
  lead: 'キーを入れると、写真からのレシピづくりが回数無制限になります（サーバーを介さず、あなたのキーで直接実行）。',
  billingNote:
    'キーは端末内に暗号化して保存され、Google 以外には送信されません。料金はあなたの Google アカウントに課金されます。',
  /** イメージ生成（画像モデル）は Free tier が無いため、課金が有効なキーが必須（設計 §1）。 */
  imageBillingNote:
    'レシピの「AIでイメージをつくる」は画像モデルを使うため、課金が有効なキーでないと使えません（テキストのみのレシピづくりは無料枠のキーでも動きます）。',

  inputPlaceholderNew: 'AIza... から始まるキーを貼り付け',
  inputPlaceholderReplace: '新しいキーで上書きする場合は貼り付け',
  save: '保存する',
  remove: '保存したキーを削除',
  howTo: 'キーの取得方法（Google AI Studio）',

  invalidTitle: 'お知らせ',
  invalidBody: 'APIキーの形式が正しくないようです。貼り付け直してください。',
  savedTitle: '保存しました',
  savedBody: '自分のキーで、写真からのレシピづくりが無制限になりました。',
  saveFailedTitle: 'お知らせ',
  saveFailedBody: 'キーを保存できませんでした。',
  removeTitle: 'キーを削除',
  removeConfirm: '保存したAPIキーを削除しますか？',

  detail: {
    storageTitle: '保存場所',
    /** どこに置くかの説明。**キーという機微情報の扱いの説明**なので弱められない。 */
    storage: {
      text: '端末のセキュアな保管領域（Android は Keystore、iPhone は Keychain）に暗号化して保存します。だいどこのサーバーには一切送信されません。',
      intent:
        'MUST state that the key is stored encrypted in the OS secure store AND that it is NEVER ' +
        "sent to this app's own server. Both halves are load-bearing: the user is deciding " +
        'whether to trust the app with a billable credential.',
    } satisfies CriticalMessage,

    destinationTitle: '送信先',
    destination: {
      text: 'キーを保存すると、写真からのレシピづくりは端末から Google の Gemini に直接送信されます（だいどこのサーバーは経由しません）。料金はキーを発行した Google アカウントに直接課金されます。',
      intent:
        'MUST state where requests go (directly to Google, bypassing this app’s server) AND that ' +
        'the user’s own Google account is billed. Dropping the billing half hides a real cost.',
    } satisfies CriticalMessage,

    removalTitle: '削除方法',
    removal:
      '上の「保存したキーを削除」でいつでも削除できます。アプリをアンインストールした場合も、端末の保管領域ごと自動的に削除されます。',

    migrationTitle: '機種変更・バックアップについて',
    /** 移行ファイルに入らないことは**意図的**。知らないと新端末で困る。 */
    migration: {
      text: 'このキーはバックアップ・機種変更用の移行ファイルには含まれません（意図的な設計です）。新しい端末では、この画面でキーを貼り付け直してください。',
      intent:
        'MUST state that the key is NOT included in backups or transfer files, and that the user ' +
        'must paste it again on a new device. Without this, the user discovers it only after ' +
        'migrating and finding the feature broken.',
    } satisfies CriticalMessage,

    supportedTitle: '対応しているキー',
    supported:
      '現在は Google の Gemini API キーのみに対応しています。他社（OpenAI・Claude など）のキーは使用できません。',
  },
};

export default byok;

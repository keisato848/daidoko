/**
 * 家族グループ（S16）。
 */
import type { PluralMessage } from '../../types';

const family = {
  title: '家族グループ',
  memberCount: {
    one: '{{count}}人のメンバー',
    other: '{{count}}人のメンバー',
  } satisfies PluralMessage,

  role: {
    owner: 'オーナー',
    member: 'メンバー',
  },

  profileSection: 'プロフィール',
  displayNamePlaceholder: '表示名を入力',
  groupNamePlaceholder: 'グループ名',

  membersSection: 'メンバー',
  you: ' (あなた)',
  memberNamePlaceholder: 'メンバー名',
  removeTitle: 'メンバーを削除',
  removeConfirm: '{{name}} をグループから削除しますか？',

  inviteSection: '招待コード',
  share: '共有',
  rotate: '更新',
  shareMessage:
    'だいどこの家族グループ「{{name}}」に招待します。\n招待コード: {{code}}\nhttps://daidoko.app/join',
  shareTitle: 'だいどこ 招待コード',

  joinSection: 'コードで参加',
  joinPlaceholder: '招待コード',
  alreadyMemberTitle: '参加済み',
  alreadyMemberBody: '{{name}} に参加しています。',
  joinedTitle: '参加しました',
  joinedBody: '{{name}} に参加しました。',

  saveFailed: '保存に失敗しました',
  saveFailedTitle: '確認してください',

  /** 既定のグループ名（初回に作られる）。 */
  defaultGroupName: 'わたしの台所',
  noProfile: 'プロフィール未設定',

  /** 入力の検証。数値は文に埋めず {{max}} で渡す（§3-4）。 */
  validation: {
    displayNameTooLong: '表示名は32文字以内で入力してください',
    groupNameRequired: 'グループ名を入力してください',
    groupNameTooLong: 'グループ名は40文字以内で入力してください',
    memberNameRequired: 'メンバー名を入力してください',
    memberNameTooLong: 'メンバー名は32文字以内で入力してください',
    cannotRemoveOwner: 'オーナーは削除できません',
    inviteCodeRequired: '招待コードを入力してください',
    inviteCodeNotFound: '招待コードが見つかりません',
  },

  /**
   * クラウド共有（同期 S0 — docs/クラウド同期設計.md §2）。
   * 同意文言は「何が共有されるか」を明記する（参加の瞬間が同意の瞬間 — §5-2）。
   * エラーは SyncError のコード別に人間の言葉へ写す（生のエラーを出さない — #202）。
   */
  sync: {
    section: '家族と共有（クラウド同期）',
    errorTitle: '共有でエラーが起きました',
    introNone:
      '共有グループを作るか、家族の招待コードで参加すると、レシピ・レシピ帖・買い物リスト・在庫がグループの端末どうしで自動的に同期されます。',
    consentTitle: '共有を始めますか？',
    consentBody:
      'グループの端末と、レシピ・レシピ帖・買い物リスト・在庫が共有されます。買い物リストと在庫は品目ごとに「自分だけ」にもできます。やめたいときはいつでも離脱できます。',
    create: '共有グループを作る',
    joinPlaceholder: '招待コード（8桁）',
    join: '参加',
    joinedTitle: '参加しました',
    joinedBody: '家族の共有グループに参加しました。',
    createdTitle: 'グループを作りました',
    createdBody: '招待コードを家族に伝えると、同じグループに参加できます。',
    inviteLabel: '招待コード（24時間有効）',
    inviteExpires: '有効期限: {{when}}',
    shareMessage:
      'だいどこの家族共有に招待します。アプリの「家族グループ」でこのコードを入力してください: {{code}}',
    memberCountLabel: {
      one: '共有中の端末: {{count}}台',
      other: '共有中の端末: {{count}}台',
    } satisfies PluralMessage,
    ownerBadge: 'このグループの作成者です',
    leave: 'このグループから離脱',
    leaveConfirmTitle: 'グループから離脱しますか？',
    leaveConfirmBody:
      'この端末が共有から外れます。端末の中のデータはそのまま残ります。もう一度参加するには招待コードが必要です。',
    deleteGroup: '共有グループを削除',
    deleteConfirmTitle: '共有グループを削除しますか？',
    deleteConfirmBody:
      'サーバー上の共有データがすべて消え、全端末で共有が止まります。各端末の中のデータは残ります。この操作は取り消せません。',
    offlineJoined: '共有グループに参加中です（オンラインになると詳細を表示します）。',
    retry: '再読み込み',
    unavailable: '共有機能はサーバーの準備中です。アプリの他の機能は通常どおり使えます。',
    error: {
      inviteInvalid: '招待コードが違います。入力し直してください。',
      inviteExpired:
        '招待コードの期限が切れています。グループの作成者に再発行してもらってください。',
      groupFull: 'このグループは満員です（最大10台）。',
      rateLimited: '試行回数が多すぎます。しばらくしてからお試しください。',
      ownerOnly: 'この操作はグループの作成者のみ行えます。',
      authInvalid:
        'グループが見つかりませんでした（削除された可能性があります）。未参加に戻りました。',
      alreadyJoined: 'すでに共有グループに参加しています。',
      network: '通信できませんでした。電波の良い場所でもう一度お試しください。',
      server: 'サーバーでエラーが発生しました。しばらくしてからお試しください。',
    },
  },
};

export default family;

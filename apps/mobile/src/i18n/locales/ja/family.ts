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
};

export default family;

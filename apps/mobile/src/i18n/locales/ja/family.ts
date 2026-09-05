/**
 * 家族グループ（S16）。
 */
import type { CriticalMessage, PluralMessage } from '../../types';

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
    // リンクをタップするとだいどこが開いて参加確認へ進む（§2-2b）。コードは手入力の逃げ道
    shareMessage:
      'だいどこの家族共有に招待します。このリンクを開くと参加できます:\n{{url}}\n\n開けないときは、アプリの「家族グループ」でこのコードを入力してください: {{code}}',
    inviteLinkTitle: '家族共有への招待',
    inviteLinkAlreadyJoined:
      'この端末はすでに共有グループに参加しています。別のグループに入るには、先に今のグループから離脱してください。',
    memberCountLabel: {
      one: '共有中の端末: {{count}}台',
      other: '共有中の端末: {{count}}台',
    } satisfies PluralMessage,
    ownerBadge: 'このグループの作成者です',
    /** 端末一覧（#209）。名前は無い — 「この端末」と「最終同期」だけで見分ける */
    devices: {
      label: '共有中の端末',
      self: 'この端末',
      other: '端末 {{index}}',
      ownerMark: '（作成者）',
      lastSeen: '最終同期: {{when}}',
      justNow: 'たった今',
      today: '今日',
      daysAgo: {
        one: '{{count}}日前',
        other: '{{count}}日前',
      } satisfies PluralMessage,
      evict: '外す',
      evictTitle: 'この端末を外しますか？',
      evictBody:
        '最終同期が{{when}}の端末を共有から外します。外した端末のデータは残りますが、同期は止まります。招待コードは新しく発行されます（外した端末は同じコードで戻れません）。',
    },
    /**
     * 多グループ（G-2b — docs/共有設計.md §5-4）。用語は「グループを作る/参加/切替」。
     * 範囲の説明には**誰に何が見えるかを必ず 1 行**入れる（§3-2 の流儀）。
     */
    groups: {
      section: '共有グループ',
      /** 既存の（無名の）主グループの表示名。§12-4: 既存グループはそのまま「家族」になる */
      primaryName: '家族グループ',
      unnamedName: '名前のないグループ',
      currentMark: 'いま見ているグループ',
      scopeAll: '全部を共有',
      scopeRecipes: 'レシピだけ共有',
      memberCount: {
        one: 'メンバー {{count}}人',
        other: 'メンバー {{count}}人',
      } satisfies PluralMessage,
      switched: '「{{name}}」に切り替えました。新しく作るレシピや品目はこのグループに入ります。',
      /** 切替に失敗しても黙らない（P5 — 切り替わったつもりで別グループに書き込む事故を防ぐ） */
      switchFailed: '切り替えられませんでした。通信環境を確認して、もう一度お試しください。',
      invite: '招待',
      create: '新しいグループを作る',
      createTitle: '新しいグループ',
      createNote:
        '相手ごとに共有の範囲を分けたいときに作ります。ふだんは今のグループのままで足ります。',
      namePlaceholder: 'グループ名（例: 娘と）',
      scopeLabel: '共有する範囲',
      scopeAllTitle: '全部',
      scopeAllDesc: 'レシピ・レシピ帖・買い物リスト・在庫が、このグループのメンバーに見えます。',
      scopeRecipesTitle: 'レシピだけ',
      scopeRecipesDesc:
        'レシピとレシピ帖だけがメンバーに見えます。買い物リストと在庫は見えません。',
      createSubmit: '作る',
      createdTitle: 'グループを作りました',
      createdBody:
        '「{{name}}」を作りました。招待コード: {{code}}\n参加した人に見えるのは、これからこのグループに入れたものだけです。',
      joinPlaceholder: '招待コードで別のグループに参加',
      /**
       * 参加の確認（G6）。参加リクエストの応答で分かったグループ名・範囲・人数を
       * 見せてから確定する。「やめる」で即座に取り消される（まだ何も共有されていない）
       */
      joinConfirmTitle: '「{{name}}」に参加しますか？',
      joinConfirmBodyAll: 'このグループでは レシピ・レシピ帖・買い物リスト・在庫 が共有されます。',
      joinConfirmBodyRecipes:
        'このグループでは レシピ・レシピ帖だけ が共有されます。買い物リストと在庫は共有されません。',
      joinKeep: '参加する',
      joinCancel: 'やめる',
      joinCanceled: '参加を取り消しました。',
      joinedAdditional: '「{{name}}」に参加しました。',
    },
    leave: 'このグループから離脱',
    leaveConfirmTitle: 'グループから離脱しますか？',
    leaveConfirmBody:
      'この端末が共有から外れます。端末の中のデータはそのまま残ります。もう一度参加するには招待コードが必要です。',
    deleteGroup: '共有グループを削除',
    deleteConfirmTitle: '共有グループを削除しますか？',
    /**
     * 取り消せない削除を、この文だけを読んで決める。**消える範囲を広く書かない。**
     * 消えるのは同期用サーバーのグループだけで（`apps/server/src/lib/sync-store.ts`
     * の `deleteGroup`）、Web共有のページは別のストアに残る
     * （`apps/server/src/lib/share-store.ts`）。「サーバー上の共有データがすべて消える」
     * と書いていた頃は、公開したページが残っていることに気づけなかった。A 階層。
     */
    deleteConfirmBody: {
      text: 'クラウド同期の共有データが消え、全端末で共有が止まります。各端末の中のデータは残ります。Web共有で公開したページはこの操作では消えません — レシピ1品はそのレシピの詳細のメニューから、レシピ帖は設定の「レシピ帖」から、それぞれ別に停止してください。この操作は取り消せません。',
      intent:
        'MUST scope the erasure to the SYNC server only, and MUST say that web-shared pages ' +
        'SURVIVE this and have to be stopped separately — a single shared recipe from its own ' +
        'detail menu, and a shared recipe book from Settings. The user decides an irreversible ' +
        'deletion from this text alone; implying it removes everything on the server would leave ' +
        'published pages online without them knowing, and naming only one of the two stop paths ' +
        'would leave the other kind of page stuck online too.',
    } satisfies CriticalMessage,
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

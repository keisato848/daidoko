/**
 * レシピまわりの文言（詳細・作成・取り込み・お店の味を再現）。
 */
import type { CriticalMessage, CriticalPluralMessage, PluralMessage } from '../../types';

const recipe = {
  /** S05 レシピ詳細。 */
  detail: {
    loading: 'レシピを読み込んでいます',
    notFoundTitle: 'レシピが見つかりません',
    notFoundMessage: '削除されたか、参照できないレシピです。',
    backToList: 'レシピ一覧へ戻る',

    tab: {
      ingredients: '材料',
      steps: '手順',
      memo: 'メモ',
      history: '履歴',
    },

    servingsValue: {
      one: '{{count}}人前',
      other: '{{count}}人前',
    } satisfies PluralMessage,
    cookTimeValue: {
      one: '{{count}}分',
      other: '{{count}}分',
    } satisfies PluralMessage,
    servingsSuffix: '人前',

    stepTimerMinutes: {
      one: '{{count}}分',
      other: '{{count}}分',
    } satisfies PluralMessage,
    stepTimerSeconds: {
      one: '{{count}}秒',
      other: '{{count}}秒',
    } satisfies PluralMessage,

    menuLabel: 'メニュー（編集・お店の味に近づける・版履歴）',
    menu: {
      refine: 'お店の味に近づける',
      edit: '編集',
      share: '共有',
      revisions: '版履歴',
    },

    pinAdd: '再現したいに追加',
    pinRemove: '再現したいから外す',

    deleteTitle: 'レシピを削除',
    /** 1件削除。取り消せないので A 階層。 */
    deleteConfirm: {
      text: 'このレシピを削除しますか？',
      intent:
        'MUST make clear the recipe will be deleted. This is a destructive, irreversible action ' +
        'confirmed only by this dialog.',
    } satisfies CriticalMessage,
    deleteFailedTitle: '削除に失敗しました',
    deleteFailedBody: '時間をおいて再度お試しください。',

    shoppingTitle: '買い物リスト',
    shoppingAdded: {
      one: '足りない{{count}}件を買い物リストに追加しました',
      other: '足りない{{count}}件を買い物リストに追加しました',
    } satisfies PluralMessage,
    shoppingNothingMissing: 'すべて在庫にあります',
    addMissingLabel: '足りない材料を買い物リストに追加',

    emptyMemo: 'メモはまだありません',
    emptyHistory: 'まだ調理記録がありません',
    emptyHistoryHint: '調理完了後に「記録する」で評価・メモを残せます',

    startCooking: '調理開始',
    logShortcut: '作った記録をつける',

    coach: {
      cookTitle: '調理開始',
      cookText:
        '全画面で手順を1つずつ表示します。タイマー・画面スリープ防止つきで料理に集中できます。',
      logTitle: '作ったら記録して、味を近づける',
      logText:
        '評価・メモ・写真をここから記録できます。感想を書くと、右上のメニューの「お店の味に近づける」でレシピを調整できます。',
    },
  },

  /** S04 レシピ一覧（蔵書庫）。 */
  list: {
    loading: 'レシピを読み込んでいます',
    search: 'レシピを探す',
    sort: '並び替え',
    sortBy: {
      recent: '新着順',
      cookCount: 'よく作る順',
      rating: '評価が高い順',
      cookTime: '調理時間が短い順',
      name: '名前順',
    },
    filterAll: 'すべて',
    countSuffix: {
      one: '{{count}}件',
      other: '{{count}}件',
    } satisfies PluralMessage,
    ingredientHitNote: '（食材名でヒットあり）',

    selectCount: {
      one: '{{count}}件選択中',
      other: '{{count}}件選択中',
    } satisfies PluralMessage,
    selectAll: 'すべて選択',

    deleteTitle: 'レシピを削除',
    /** 一括削除。件数と「取り消せない」の両方が要る。 */
    deleteConfirm: {
      one: {
        text: '{{count}}件のレシピを削除しますか？この操作は取り消せません。',
        intent:
          'MUST state that the deletion CANNOT be undone and MUST state how many recipes are ' +
          'affected. MUST NOT soften "cannot be undone".',
      },
      other: {
        text: '{{count}}件のレシピを削除しますか？この操作は取り消せません。',
        intent:
          'MUST state that the deletion CANNOT be undone and MUST state how many recipes are ' +
          'affected. MUST NOT soften "cannot be undone".',
      },
    } satisfies CriticalPluralMessage,

    emptyTitle: 'まだレシピがありません',
    emptyMessage: 'URL・写真・手動入力でレシピを追加すると、ここに蔵書として並びます。',
    emptyAction: 'レシピを追加',
    noMatchTitle: '条件に合うレシピが見つかりません',
    noMatchMessage: '検索キーワードやフィルターを変えてお試しください。',
    addLabel: 'レシピを追加',

    coach: {
      searchTitle: 'レシピを探す',
      searchText: 'レシピ名だけでなく、タグや食材名（例: 卵）でも検索できます。',
      addTitle: 'レシピを増やすには',
      addText:
        '下の「追加」タブから、手入力・URL取り込み・写真からのAI作成でレシピを登録できます。',
    },
  },

  /** S12 写真からレシピ（主役の入口）。 */
  photo: {
    title: '写真からレシピをつくろう',
    tabLabel: '写真からレシピ',
    description:
      '料理の写真をえらぶだけで、材料・分量・手順をAIが考えてレシピの下書きをつくります。お店の名前や味の感想をひとこと添えると、より近い仕上がりになります。',
    processing: '写真からレシピをつくっています...',

    confidence: {
      high: 'バッチリ読み取れました',
      medium: 'だいたい読み取れました',
      low: 'ざっくり読み取りました',
    },

    /** 送信先の開示。**書かないと不当な収集になる**ので A 階層。 */
    disclosure: {
      text: '写真は解析のためサーバー（AI 提供元）に送信されます。保存はされません。',
      intent:
        'MUST state BOTH that the photo LEAVES the device to a third-party AI provider AND that ' +
        'it is not retained. This is the disclosure the user relies on before sending a photo; ' +
        'dropping either half misrepresents what happens to their data.',
    } satisfies CriticalMessage,

    offlineNotice: 'インターネットにつながっていると、写真からレシピをつくれます',

    quotaRemaining: {
      one: '今日の無料作成：あと {{count}} 回 ・ 使い放題にする',
      other: '今日の無料作成：あと {{count}} 回 ・ 使い放題にする',
    } satisfies PluralMessage,
    unlimitedByok: '自分のAIキー・使い放題',
    unlimitedPremium: 'プレミアム・使い放題',

    placeNamePlaceholder: 'お店の名前（任意）',
    formTitle: 'できたレシピを確認・編集',

    savedAndPinned: 'レシピを保存し、再現したいに追加しました',
    saved: 'レシピを保存しました',

    webTitle: '写真からのレシピづくりはアプリでつかえます',
    webDescription:
      '写真からの下書き作成はスマホアプリ（iOS / Android）でお使いいただけます。\n\nWeb ブラウザからお使いの場合は、手動入力をご利用ください。',
    manualLabel: '代わりに手動入力する',
    manualAction: '手動で入力する',
    clearImage: '画像をクリア',

    commentTitle: 'ひとことコメント（任意）',
    commentHint: 'お店の名前や味の感想を書くと、より近いレシピになります。',
    commentPlaceholder: '例: ○○屋の麻婆豆腐。しびれ強め',
    commentCancel: 'やめる',
    commentConfirm: 'レシピをつくる',
  },

  refine: {
    /** 差分の見出し・バッジ。 */
    title: 'お店の味に近づける',
    summaryLabel: 'AI が直したところ',
    diffMeta: 'レシピ情報',
    badge: {
      added: '追加',
      removed: '削除',
      changed: '変更',
    },

    /**
     * R2 の注意書き。**AI が材料を増やすことがある経路**なので、
     * 写真レシピより強い確認を求める。
     */
    caution: {
      text: 'AIが調整した内容です。材料が追加されることがあります。アレルギーのある方は、保存前に材料をすべてご確認ください。',
      intent:
        'MUST warn that the AI MAY HAVE ADDED ingredients, and MUST tell the user to check every ' +
        'ingredient before saving. The app does NOT detect allergens — this sentence is the only ' +
        'warning. MUST NOT be softened to a generic "AI-generated" note.',
    } satisfies CriticalMessage,

    noticeNoChange:
      'レシピに変更はありませんでした。感想をもう少し具体的に書くと直せることがあります。',

    feedbackLabel: '作ってみてどうだった？',
    feedbackPlaceholder: 'お店のよりかなり甘かった。とろみも足りない気がする...',
    feedbackHint: '味の方向（甘い・辛い・濃い・薄い）を書くほど直しやすくなります。',

    photoLabel: '作った料理の写真（任意）',
    photoHint: '焼き色・とろみ・色の濃さは、言葉より写真の方が正確に伝わります。',
    targetLabel: 'お店の写真を目標にします',
    targetHint: '「お店で食べた」記録から自動で添えます',

    retry: 'やり直す',
    saveThis: 'この内容で保存',
    processing: 'AIが調整中...',
    start: 'AIで近づける',
    updated: 'レシピを更新しました',

    notFound: 'レシピが見つかりませんでした',
    genericFailed: 'レシピを調整できませんでした。もう一度お試しください。',
    saveFailedTitle: '保存できませんでした',
    saveFailedBody: 'レシピを保存できませんでした',

    /**
     * R2 の差分プレビューの保証文。**AI が黙って書き換えないことの保証**であり、
     * 弱まると説明が嘘になる（§6-2）。
     */
    diffGuarantee: {
      text: 'ここに出ていない材料・手順は変わっていません。内容を確認してから保存してください。',
      intent:
        'MUST convey an absolute guarantee: anything NOT shown in the diff is unchanged. ' +
        'MUST NOT be softened to a probability ("may not have changed", "should be unchanged") — ' +
        'this sentence is the reason the diff preview exists as a safety check.',
    } satisfies CriticalMessage,

    /**
     * 感想から変更点を読み取れなかったとき。**失敗ではなく入力不足**なので、
     * 再試行を促すのではなく「何を書けばよいか」を伝える（R2 の設計判断）。
     */
    noChange: {
      text: '感想から、何をどう変えればよいか読み取れませんでした。「甘すぎた」「もっと辛く」のように、味の方向を書いてみてください。',
      intent:
        'MUST tell the user WHAT TO WRITE next (a taste direction), with examples. ' +
        'MUST NOT be a bare "try again" — retrying the same text cannot succeed. ' +
        'This is an input-insufficiency message, not an error.',
    } satisfies CriticalMessage,

    failed: 'レシピを調整できませんでした',
    convertFailed: '調整結果をレシピに変換できませんでした',
    done: 'レシピを調整しました。',
  },
};

export default recipe;

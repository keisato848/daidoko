/**
 * レシピの取り込み（テキスト / 文字入り画像 / URL）。
 *
 * 写真からの AI 生成は `recipe.photo` にある（主役の入口なので分けている）。
 */
import type { CriticalMessage, PluralMessage } from '../../types';

const recipeImport = {
  /** 共有リンクをアプリで開いたとき（#198） */
  share: {
    title: '共有されたレシピを取り込む',
    loading: '共有ページを読み込んでいます',
    recipeLead: '家族から共有されたレシピです。内容を確認して保存してください。',
    bookLead: {
      one: 'レシピ帖に{{count}}品あります。まとめて保存できます。',
      other: 'レシピ帖に{{count}}品あります。まとめて保存できます。',
    } satisfies PluralMessage,
    ingredientCount: {
      one: '材料 {{count}}',
      other: '材料 {{count}}',
    } satisfies PluralMessage,
    passcodeLead:
      'このレシピ帖はパスコードで守られています。共有した人から聞いた6桁を入力してください。',
    unlock: '開く',
    save: '保存する',
    saveAll: {
      one: '{{count}}品を保存',
      other: '{{count}}品を保存',
    } satisfies PluralMessage,
    saving: '保存中…',
    saved: '保存しました',
    savedCount: {
      one: '{{count}}品を保存しました',
      other: '{{count}}品を保存しました',
    } satisfies PluralMessage,
    backToLibrary: 'レシピ一覧へ戻る',
    error: {
      notFound:
        'この共有ページは見つかりませんでした（共有が停止されたか、期限が切れた可能性があります）。',
      wrong: 'パスコードが違います。',
      locked: '試行回数が多すぎます。しばらくしてからお試しください。',
      network: '通信できませんでした。電波の良い場所でもう一度お試しください。',
      server: '読み込めませんでした。しばらくしてからお試しください。',
    },
  },
  formTitle: 'レシピを確認・編集',
  saved: 'レシピを保存しました',

  /** テキストを貼り付けて解析。 */
  text: {
    title: 'テキストから作成',
    heading: 'レシピ本文を貼り付け',
    copyPrompt: 'AI用指示をコピー',
    copied: 'AI用指示をコピーしました',
    parsing: '解析中...',
    parse: '解析して確認',
    /**
     * 入力欄の見本。**訳ではなく作り直し**でよい（対象言語で自然な料理と
     * 書式にする）。ここが日本語のままだと、英語の利用者は何を貼ればよいか
     * 分からない。
     */
    samplePlaceholder: [
      '肉じゃが',
      '4人分',
      '材料',
      'じゃがいも 3個',
      '玉ねぎ 1個',
      '牛こま肉 200g',
      '作り方',
      '1. 材料を切る',
      '2. 肉を炒めて野菜を加える',
      '3. 煮汁を入れて煮込む',
    ].join('\n'),

    confidence: {
      high: '解析できました',
      medium: '一部を確認してください',
      low: '入力を補ってください',
    },
    normalized: {
      gemmaNative: '端末内AIで補正しました',
      localHeuristic: '補正して解析しました',
    },
  },

  /** 文字入り画像から読み取り（Android のみ）。 */
  ocr: {
    title: '文字入り画像から読み取り',
    heading: '文字入り画像を読み取り',
    lead: 'レシピ本・手書きメモ・切り抜きの文字を端末内で読み取り、材料・手順の下書きを作成します。',
    formTitle: '読み取り結果を確認・編集',
    reading: '端末内で読み取っています...',
    providerUnavailable: 'このビルドでは Android OCR provider を初期化できませんでした',
    // provider が **渡されていない**（呼び出し側の設定漏れ）。初期化失敗とは別
    providerNotConfigured: 'クライアントOCR providerが設定されていません',
    failed: 'OCR 処理に失敗しました',
    clearImage: '画像をクリア',

    accuracy: {
      high: '読み取り精度: 高',
      medium: '読み取り精度: 中',
      low: '読み取り精度: 低',
    },

    webTitle: '文字読み取りはネイティブアプリ専用です',
    webDescription:
      'カメラ文字認識は Android アプリで先行対応中です。\n\nWeb ブラウザからお使いの場合は、手動入力をご利用ください。',
    manualLabel: '代わりに手動入力する',
    manualAction: '手動で入力する',

    appliedToForm: '画像内の文字を読み取り、入力フォームに反映しました',
    readButUnconvertible: '画像内の文字は読めましたが、レシピ入力形式に変換できませんでした',
    tooLittleText: '画像内の文字量が少ないため、画像ラベルから下書きしました',
    skipped: '画像内テキストの読み取りをスキップしました',
    skippedWithReason: '画像内テキストの読み取りをスキップしました: {{reason}}',
    tooLittleTextRetry: 'テキストが少なすぎます。より鮮明な画像で試してください。',
    missingRequiredFields: 'レシピとして必要な項目を読み取れませんでした',

    // 端末内の画像ラベル推定（クラウド推論が使えないときの控え）が付ける注意書き
    labelUncertain: '写真だけでは分量・加熱時間・隠れた調味料を確定できません',
    labelGenericDraft: '料理名を特定できなかったため、汎用の下書きにしました',
    labelSummary: '画像ラベル: {{labels}}',
  },

  /**
   * 紙面（レシピ本・食品パッケージ・手書きメモ）に**書かれている**レシピの読み取り。
   * 端末内 OCR から AI に置き換えた（`docs/レシピ推論の評価設計.md` §10）。
   */
  page: {
    title: '文字入り画像から読み取り',
    heading: 'レシピが載っている紙面を読み取り',
    lead: 'レシピ本・食品パッケージ・手書きメモに書かれている材料と作り方を、AI が読み取って下書きにします。',
    formTitle: '読み取り結果を確認・編集',
    reading: '紙面を読み取っています...',

    /** 表と裏で 1 つのレシピになることを、**撮る前に**伝える */
    multiHint: '材料の面と作り方の面が分かれているときは、続けて撮ってください（{{max}} 枚まで）。',
    /** 実行ボタン。何が起きるかを動詞で書く */
    read: '読み取る',
    /** 裏面だけを撮ると料理名が無いのは普通。責めずに何をすればよいかだけ伝える */
    titleMissing: '料理名は読み取れませんでした。入力してください',
    addMore: '追加',
    removePage: 'この写真を外す',
    /** 上限に達したとき。追加タイルの代わりに出す */
    limitReached: { one: '{{count}} 枚まで', other: '{{count}} 枚まで' } satisfies PluralMessage,

    /**
     * 送信先の開示。**書かないと不当な収集になる**ので A 階層。
     * 端末内 OCR のときは不要だったが、AI に寄せたので必須になった。
     */
    disclosure: {
      text: '写真は読み取りのためサーバー（AI 提供元）に送信されます。保存はされません。',
      intent:
        'MUST state BOTH that the photo LEAVES the device to a third-party AI provider AND that ' +
        'it is not retained. This is the disclosure the user relies on before sending a photo; ' +
        'dropping either half misrepresents what happens to their data.',
    } satisfies CriticalMessage,

    failed: '紙面を読み取れませんでした。時間をおいてお試しください。',
    notFound: 'レシピを読み取れませんでした。材料と作り方が書かれた面を撮ってお試しください。',
    offlineNotice: 'インターネットにつながっていると、紙面からレシピをつくれます',
  },

  /** 作りたいものを相談してレシピにする。写真からレシピと違い、まだ料理が無いときの入口。 */
  consult: {
    title: '相談しながらつくる',
    heading: '相談しながら、作るものを決める',
    lead: 'こんなの作りたい、と話しかけてください。AI が人数や時間を聞きながら、レシピの下書きにしていきます。',
    placeholder: '例: 週末に子どもと作れる、鶏むねの何か',
    send: '送る',
    thinking: '考えています…',
    usePantry: '在庫を考慮する',
    usePantryOn: '手元の在庫を一緒に送ります',
    usePantryOff: '在庫は送りません',
    draftReady: '下書きができました',
    // ready はモデルの自己申告で当てにならないことがある。どちらでもカードは開ける
    draftInProgress: '相談中の下書き',
    openDraft: '下書きを確認して保存',
    emptyReply: 'うまく聞き取れなかったみたいです。作りたいものを、ひとことで教えてください。',
    confirmTitle: '下書きを確認・保存',
    restart: '最初からやり直す',
    restartConfirm: 'これまでの会話と下書きを消して、最初からやり直しますか？',
    disclaimer: 'アレルギーの有無は判定できません。材料はご自身で確認してください。',

    /** 写真を添えて相談する（冷蔵庫の中身・食材・参考にしたい料理）。 */
    attachPhoto: '写真を添える',
    attachedPhoto: '添えた写真',
    removePhoto: 'この写真を外す',
    photoHint: '冷蔵庫の中身や、参考にしたい料理の写真を添えられます',
    /**
     * 送信先の開示。**常に出す**。
     * 以前は写真を添えたときだけ出していたが、この機能は写真が無くても毎回
     * 会話・作りかけの下書き・（在庫を考慮するときは）材料名を送っている
     * （`recipe-consult.provider.ts`）。写真だけを言うと、文字だけの相談では
     * 1 行も出ず、送っていることを隠すことになる。
     */
    disclosure: {
      text: '会話の内容と作りかけの下書き（在庫を考慮するときは材料名、写真を添えたときは写真も）が、返事をつくるためサーバー（AI 提供元）に送信されます。保存はされません。',
      intent:
        'MUST name what leaves the device on EVERY turn: the conversation and the draft recipe — ' +
        'not only attached photos. Pantry names and photos are conditional and MUST be marked as ' +
        'such. MUST also state it goes to a third-party AI provider and is not retained. This ' +
        'line is shown even with no photo attached; a photo-only wording hides the text that is ' +
        'always sent.',
    } satisfies CriticalMessage,
    firstMessage:
      '何を作りましょうか。「あっさりした麺類」「冷蔵庫の鶏むねを使いたい」など、ざっくりで大丈夫です。',
  },

  /** レシピサイトの URL から取り込み。 */
  url: {
    title: 'URLから取り込み',
    heading: 'レシピページのURLを貼り付けてください',
    /**
     * 対応サイトの例。**訳ではなく対象国のサイト名に差し替える**。
     * 日本のサイト名を英語圏に出しても意味がない。
     */
    supportedSites:
      '対応サイト: クラシル・デリッシュキッチン・Nadia など JSON-LD 対応のレシピサイト',
    importing: 'レシピを取り込んでいます...',
    submit: '取り込む',
    sourceLabel: '取り込み元:',
    required: 'URLを入力してください',
    mustBeHttp: 'URLはhttpまたはhttpsで始めてください',
    tooLong: 'URLが長すぎます',
    failed: '取り込みに失敗しました',
    saved: 'レシピを保存しました！',
  },
};

export default recipeImport;

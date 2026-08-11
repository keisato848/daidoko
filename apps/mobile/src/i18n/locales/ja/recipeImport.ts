/**
 * レシピの取り込み（テキスト / 文字入り画像 / URL）。
 *
 * 写真からの AI 生成は `recipe.photo` にある（主役の入口なので分けている）。
 */
const recipeImport = {
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

  /** 作りたいものを相談してレシピにする。写真からレシピと違い、まだ料理が無いときの入口。 */
  consult: {
    title: 'おたまに相談',
    heading: 'おたまと話しながら決める',
    lead: '台所うさぎの「おたま」が相談相手です。こんなの作りたい、と話しかけてください。人数や時間を聞きながら、レシピの下書きにしていきます。',
    placeholder: '例: 週末に子どもと作れる、鶏むねの何か',
    send: '送る',
    thinking: 'おたまが考えています…',
    usePantry: '在庫を考慮する',
    usePantryOn: '手元の在庫を一緒に送ります',
    usePantryOff: '在庫は送りません',
    draftReady: '下書きができました',
    // ready はモデルの自己申告で当てにならないことがある。どちらでもカードは開ける
    draftInProgress: 'おたまの下書き',
    openDraft: '下書きを確認して保存',
    emptyReply: 'うまく聞き取れなかったみたいです。作りたいものを、ひとことで教えてください。',
    confirmTitle: '下書きを確認・保存',
    restart: '最初からやり直す',
    restartConfirm: 'おたまとの会話と下書きを消して、最初からやり直しますか？',
    disclaimer: 'アレルギーの有無は判定できません。材料はご自身で確認してください。',
    firstMessage:
      'こんにちは、おたまです。何を作りましょうか。「あっさりした麺類」「冷蔵庫の鶏むねを使いたい」など、ざっくりで大丈夫です。',
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

/**
 * 在庫・買い物リスト・レシート・食事写真。
 * 設計は `docs/買い物リスト・在庫設計.md`。
 */
import type { CriticalMessage, PluralMessage } from '../../types';

const pantry = {
  title: '在庫',
  /**
   * 個人 / 家族の切り替え（v15・設計 §5-2）。
   * **グループに入っていないあいだは画面に出さない** — 使わない人の見た目を変えない。
   */
  shared: {
    onLabel: '家族と共有中。タップで自分だけにする',
    offLabel: '自分だけ。タップで家族と共有する',
    onBadge: '家族',
    offBadge: '自分',
    /** 参加直後に一度だけ聞く */
    askTitle: 'いまの買い物リストと在庫も共有しますか？',
    // ボタンの文言（共有する / 自分だけにする）と揃える。「はい/いいえ」と書くと
    // 画面のどのボタンのことか分からない
    askBody:
      '「共有する」を選ぶと、いまある品目が家族の端末にも表示されます。「自分だけにする」を選ぶと、いまの品目は自分だけのままで、これから追加するものが共有されます。あとから品目ごとに変えられます。',
    askYes: '共有する',
    askNo: '自分だけにする',
  },

  empty: '在庫は空です。食材を追加してください。',

  addPlaceholder: '食材を追加（例: 玉ねぎ）',
  quantityLabel: '数',
  unitLabel: '単位',

  action: {
    consumeMeal: '食べた',
    consumeMealLabel: '食べた分を在庫から減らす',
    receipt: 'レシート',
    receiptLabel: 'レシートから追加',
    scan: 'スキャン',
    scanLabel: 'バーコードでスキャン',
    cookable: 'この在庫で作れるレシピ',
    decrease: '減らす',
    increase: '増やす',
  },

  lowStockBadge: '残りわずか',
  thresholdBadge: '通知 ≤',
  thresholdSet: '残量通知のしきい値を設定',
  /** 置き場所・用途のグループ（v13）。任意 — 使わない人はそのまま使える */
  group: {
    all: 'すべて',
    ungrouped: '未設定',
    label: '置き場所',
    /** グループを選ぶ・作る シート */
    pickerTitle: '置き場所を選ぶ',
    none: '未設定のまま',
    newPlaceholder: '新しい置き場所（例: 冷蔵庫）',
    create: '追加',
    editLabel: '置き場所と賞味期限を編集',
  },

  /** 賞味期限（v13）。**任意入力**で、通知で追い立てない */
  expiry: {
    label: '賞味期限',
    placeholder: '2026-09-30',
    clear: '消す',
    /** 一覧の行に出す短い表示 */
    on: '期限 {{date}}',
    invalid: '日付は 2026-09-30 の形式で入力してください。',
  },

  thresholdTitle: '残りいくつ以下で通知する？',
  thresholdPlaceholder: '例: 1',
  thresholdSaveLabel: 'しきい値を保存',
  thresholdClear: 'クリア',

  coach: {
    addTitle: '在庫のいれ方いろいろ',
    addText:
      'バーコードの「スキャン」、「レシート」の読み取りで素早く登録。「食べた」は食事の写真から使った分を減らします。',
    notifyTitle: '残量通知',
    notifyText:
      '品目のベルから「残りいくつ以下で通知するか」を設定すると、少なくなったときにお知らせします。',
    cookableTitle: 'この在庫で作れるレシピ',
    cookableText: '在庫と各レシピの材料を照合して、いま作れるレシピを充足率順に表示します。',
  },

  /** 買い物リスト。 */
  shopping: {
    title: '買い物リスト',
    empty: '買い物リストは空です。品目を追加してください。',
    addPlaceholder: '品目を追加（例: 牛乳）',
    movedToPantry: '{{name}} を在庫に入れました',
    /**
     * 買う場所のグループ（v13）。**在庫の置き場所とは別物** — こちらは
     * 「スーパーで買うもの / ドラッグストアで買うもの」の仕分け。任意。
     */
    storeGroup: {
      all: 'すべて',
      ungrouped: '未設定',
      label: '買う場所',
      pickerTitle: '買う場所を選ぶ',
      none: '未設定のまま',
      newPlaceholder: '新しい買う場所（例: スーパー）',
      editLabel: '買う場所を変える',
    },
    buyLabel: '{{name}}を買った（在庫に入れる）',
    uncheckLabel: '{{name}}のチェックを外す',
    /** 自動献立モードが足した行（§10.11.2）。タップで由来レシピを開く */
    menuBadge: '献立から',
    menuBadgeLabel: '献立から追加。タップでレシピを開く',
    coach: {
      linkTitle: '在庫とつながっています',
      linkText:
        '家にある食材は「在庫」で管理。レシピの足りない材料だけをこのリストに追加することもできます。',
      moveTitle: '買った→在庫へ',
      moveText: 'タップするだけで、その品目が在庫へ移ります（分量も自動で読み取り）。',
    },
  },

  /** 食事の写真から在庫を減らす（実験的）。 */
  consumeMeal: {
    title: '食べた分を在庫から',
    analyzing: '食事を解析しています',
    lead: '食事の写真を撮ると、使った食材を推定して在庫を減らせます（実験的）。',
    capture: '食事を撮影',
    // 写真レシピと**同じ生涯枠**（getFreemiumStatus().remaining）を表示している。
    // 「今日の」と書くと明日また使えると誤解させるので、期間を示す語は入れない
    quotaRemaining: {
      one: '無料解析: 残り {{count}} 回',
      other: '無料解析: 残り {{count}} 回',
    } satisfies PluralMessage,
    // **料理名を文に差し込まない。** 日本語は「〜で使った」で繋がるが、
    // 英語は語順が変わるので文ごと分ける
    resultWithDish:
      '「{{dish}}」で使った食材のうち、在庫にあるものです。\n減らすものを選んで確定してください。',
    resultWithoutDish:
      'この食事で使った食材のうち、在庫にあるものです。\n減らすものを選んで確定してください。',
    retry: 'やり直す',
    confirm: {
      one: '在庫を減らす（{{count}}）',
      other: '在庫を減らす（{{count}}）',
    } satisfies PluralMessage,
    noMatch: '「{{dish}}」と推定しましたが、在庫に該当する食材がありませんでした。',
    notRecognized: '料理を認識できませんでした。明るく正面から撮り直してください。',
    failed: '解析に失敗しました',
  },

  /** レシートから在庫へ一括追加。 */
  receipt: {
    title: 'レシートから在庫に追加',
    reading: 'レシートを読み取っています',
    lead: 'レシートを撮影／選択すると、品目を読み取って在庫に一括追加できます。',
    capture: 'レシートを撮影',
    /** 送信先の開示。**書かないと不当な収集になる**ので A 階層。 */
    disclosure: {
      text: '読み取りにはクラウド AI を使用します。写真は解析のためだけに送信され、保存されません。',
      intent:
        'MUST state BOTH that the photo LEAVES the device to a cloud AI AND that it is not ' +
        'retained. Receipts carry purchase history; dropping either half misrepresents what ' +
        'happens to that data.',
    } satisfies CriticalMessage,
    /**
     * 端末内OCRが使える端末での開示。送るのは文字だけだが、**読めなければ写真を送る**。
     * その条件を落とすと「写真は出ない」と読めてしまう。
     */
    disclosureOnDevice: {
      text: 'この端末では文字の読み取りを端末内で行い、その文字だけをクラウド AI へ送って品目に整えます。写真は端末から出ません。文字を読み取れなかったときだけ写真を送信します（解析のためだけで、保存されません）。',
      intent:
        'MUST state ALL THREE: only the TEXT leaves the device on the normal path, the photo ' +
        'stays on the device on that path, AND the photo IS sent when the on-device read ' +
        'fails. Dropping the fallback makes this read as "the photo never leaves", which is ' +
        'false. Receipts carry purchase history.',
    } satisfies CriticalMessage,
    resultHint:
      '読み取った品目です。不要な行のチェックを外し、名前・数量・単位を直して追加してください。数量が空欄のものは「数量未管理」で在庫に入ります。',
    quantityPlaceholder: '数量',
    quantityLabel: '数量（空欄なら数量未管理）',
    unitPlaceholder: '単位',
    unitLabel: '単位（例: 個・g）',
    exclude: '除外',
    include: '含める',
    retry: 'やり直す',
    confirm: {
      one: '在庫に追加（{{count}}）',
      other: '在庫に追加（{{count}}）',
    } satisfies PluralMessage,
    /** 買い物リストの消し込み（v13）。**先に見せてから**やる — 黙って消すと誤照合に気づけない */
    checkOff: {
      one: '買い物リストの {{count}} 件を消し込みます',
      other: '買い物リストの {{count}} 件を消し込みます',
    } satisfies PluralMessage,
    checkedOff: {
      one: '買い物リストの {{count}} 件にチェックを付けました',
      other: '買い物リストの {{count}} 件にチェックを付けました',
    } satisfies PluralMessage,
    /** 店名 → 買い物グループ の対応（初めての店のときだけ聞く） */
    storeGroupTitle: '{{store}} で買うものは？',
    storeGroupLabel: '買う場所',
    storeGroupUnset: '未設定',
    notRecognized: 'レシートを認識できませんでした。レシート全体が写るように撮り直してください。',
    noItems: 'レシートから品目を読み取れませんでした。明るく正面から撮り直してください。',
    failed: '読み取りに失敗しました',
  },

  /** バーコードのスキャン。 */
  scan: {
    added: '「{{name}}」を在庫に追加しました',
    permissionNeeded: 'バーコードを読み取るにはカメラの許可が必要です。',
    grantCamera: 'カメラを許可',
    newProduct: '新しい商品',
    namePlaceholder: '商品名（例: 牛乳）',
    unitPlaceholder: '単位（任意, 例: 本）',
    addAndRemember: '在庫に追加して記憶',
    guide: '商品のバーコードを枠に合わせてください',
  },

  /** 在庫で作れるレシピ。 */
  cookable: {
    title: '在庫で作れる',
    matching: 'AI で在庫名を照合中…',
    watchAd: '広告を見て照合',
    watchAdRemaining: {
      one: 'AI照合の残り {{count}} 件 — 広告を見て照合',
      other: 'AI照合の残り {{count}} 件 — 広告を見て照合',
    } satisfies PluralMessage,
    empty: 'レシピと在庫を登録すると、作れるレシピが分かります。',
    ready: '作れる',
    missing: {
      one: 'あと{{count}}品: ',
      other: 'あと{{count}}品: ',
    } satisfies PluralMessage,
  },

  /** 名寄せ辞書のメンテナンス。 */
  aliases: {
    title: '名寄せ辞書',
    lead: 'AIが「表記ゆれ→正規名」として覚えた対応を一覧できます。間違って覚えたものは、鉛筆マークで正しい名前に直すか、×で削除してください（削除すると次回また自動で判定されます）。',
    emptyTitle: 'まだ何も覚えていません。',
    emptyBody: 'レシート読み取りや食材の名寄せを使うと、ここに記録されます。',
    editLabel: '{{name}}の正規名を編集',
    deleteLabel: '{{name}}を削除',
    canonicalLabel: '正しい名前',
    saveLabel: '正規名を保存',
  },
};

export default pantry;

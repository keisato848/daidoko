/**
 * 複数の画面で使う語彙。**同じ日本語なら同じキー**にする。
 *
 * ここに置く条件は「文脈が変わっても訳が同じ」であること。
 * 例えば「完了」は完了ボタン（Done）と完了状態（Completed）で英語が変わるので、
 * common に置かず画面側で持つ。**日本語が同形なだけの語を畳まない。**
 */
const common = {
  save: '保存',
  saving: '保存中...',
  cancel: 'キャンセル',
  close: '閉じる',
  delete: '削除',
  add: '追加',
  edit: '編集',
  back: '戻る',
  next: '次へ',
  retry: 'もう一度',
  ok: 'OK',

  // レシピの構成要素。見出しとしても項目名としても同じ訳になる
  ingredients: '材料',
  steps: '手順',
  note: 'メモ',
  servings: '人数',
  cookTime: '調理時間',

  // 写真まわり。3 画面（レシピ・調理記録・在庫）で同じ選択肢を出す
  takePhoto: 'カメラで撮影',
  pickFromGallery: 'ギャラリーから選ぶ',
  deletePhoto: '写真を削除',
  photoAddFailed: '写真を追加できませんでした',

  /** 連続撮影（1 枚撮るたびに続けるか聞く。上限 1 の画面では出ない） */
  captureMore: {
    title: '続けて撮りますか？',
    message: {
      one: 'あと {{count}} 枚追加できます。',
      other: 'あと {{count}} 枚追加できます。',
    },
    more: '続けて撮る',
    done: 'これで完了',
  },

  /** 語を並べるときの区切り。英語は読点ではなくカンマ＋空白。 */
  listSeparator: '・',

  all: 'すべて',
  unknown: '不明',
};

export default common;

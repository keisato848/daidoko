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

  all: 'すべて',
  unknown: '不明',
};

export default common;

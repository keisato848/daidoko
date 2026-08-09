/**
 * 調理記録の語彙。**複数画面で同じ語を出す**ので common ではなくここに置く
 * （ホームのバッジ・写真取り込みの選択・詳細の履歴が同じ語を使う）。
 */
import type { PluralMessage } from '../../types';

const log = {
  /** 体験の種類（v9・`docs/お店の味を再現設計.md` §3）。 */
  kind: {
    eatenOut: 'お店で食べた',
    cooked: '家で作った',
  },

  /** レシピに紐づかない記録の表示名。 */
  freeform: 'フリー記録',

  /** S07 調理を記録する。 */
  form: {
    title: '調理を記録する',
    skip: 'スキップ',
    congrats: 'お疲れさまでした！',
    congratsSub: '今日の料理を記録しておきましょう',

    photoSection: '写真',
    photoLimitTitle: '写真を追加できません',
    photoLimit: {
      one: '写真は{{count}}枚まで追加できます。',
      other: '写真は{{count}}枚まで追加できます。',
    } satisfies PluralMessage,
    addFromCamera: 'カメラで写真を追加',
    addFromGallery: 'ギャラリーから写真を追加',
    photoCount: '{{current}} / {{max}} 枚',

    ratingSection: '評価',
    // 数値キーにすると型からキーを取り出せない（keyof T & string に載らない）
    rating: {
      star1: '改善の余地あり',
      star2: 'まあまあ',
      star3: '良かった',
      star4: 'とても良かった',
      star5: '最高！',
    },

    memoSection: 'メモ（任意）',
    memoPlaceholder: 'アレンジ・気づき・次回への覚書...',

    submit: '記録する',
    saved: '記録しました！',
    saveFailedTitle: '保存できませんでした',
    saveFailedBody: '記録を保存できませんでした',

    /** 感想を書いた直後の導線（R2 / Issue #113）。 */
    refinePromptTitle: 'レシピに反映しますか？',
    refinePromptBody: 'いま書いた感想をもとに、AI がレシピをお店の味に近づけます。',
    refineLater: 'あとで',
    refineNow: '近づける',
  },
};

export default log;

/**
 * S01 ホーム（タイムライン）。
 */
import type { CriticalPluralMessage, PluralMessage } from '../../types';

const home = {
  filter: {
    week: '今週',
    month: '今月',
    all: 'すべて',
  },

  loading: '調理記録を読み込んでいます',

  /** ヘッダーのアイコン。ラベル＝画面に出る短い語、a11y＝読み上げ用の完全な語。 */
  action: {
    calendarLabel: '暦',
    calendar: 'カレンダー',
    galleryLabel: '写真',
    gallery: 'ギャラリー',
    shoppingLabel: '買物',
    shopping: '買い物リスト',
    helpLabel: '使い方',
  },

  /** 複数選択モード。 */
  select: {
    count: { one: '{{count}}件選択中', other: '{{count}}件選択中' } satisfies PluralMessage,
    all: 'すべて選択',
  },

  /** 一括削除。**取り消せない操作**なので確認文は A 階層。 */
  delete: {
    title: '調理ログを削除',
    confirm: {
      one: {
        text: '{{count}}件の調理ログを削除しますか？この操作は取り消せません。',
        intent:
          'MUST state that the deletion CANNOT be undone, and MUST state how many records ' +
          'are affected. MUST NOT soften "cannot be undone" — the user has no other warning.',
      },
      other: {
        text: '{{count}}件の調理ログを削除しますか？この操作は取り消せません。',
        intent:
          'MUST state that the deletion CANNOT be undone, and MUST state how many records ' +
          'are affected. MUST NOT soften "cannot be undone" — the user has no other warning.',
      },
    } satisfies CriticalPluralMessage,
  },

  /** 主役への直行ボタン（`docs/お店の味を再現設計.md` §4.3 問題2）。 */
  // まだ料理が無いときの入口。撮る（料理がある）と対になる
  consult: 'AIと相談しながらつくる',
  /** 在庫ループの入口。在庫に何か入っているときだけ出す */
  cookable: '在庫で作れるレシピ',
  capture: 'お店の料理を撮る',

  /** 作りたいリストの棚。データは pinned_at のまま、呼び名だけ再現ループに寄せた。 */
  wantTitle: '再現したい',

  /**
   * 空のときの表示。**初回の第一印象であり最大の広告面**なので、
   * 「まだありません」ではなく主役を語る（§4.3 問題5）。
   *
   * 期間フィルタごとに文を分けているのは、`${期間}の記録がありません` のように
   * ラベルを差し込むと英語が壊れるため（「Week's records not found」になる）。
   */
  empty: {
    allTitle: 'お店で食べたあの味、撮っておきませんか',
    allMessage:
      '写真を1枚撮るだけで、AIが家で作れるレシピにします。作ったあとの感想で、お店の味に近づけていけます。',
    weekTitle: '今週の記録がありません',
    monthTitle: '今月の記録がありません',
    filteredMessage: '別の期間を選ぶか、新しく記録を追加してみましょう。',
  },

  /** 初回利用ガイド（コーチマーク）。 */
  coach: {
    fabTitle: '記録もレシピもここから',
    fabText:
      '作った料理の記録や、レシピの追加（写真からAI作成・AIと相談・URL取り込み・手入力）は「＋」から始めます。',
    cartTitle: '買い物リストと在庫',
    cartText:
      '買い物リスト・家の在庫・レシート読み取り・「この在庫で作れるレシピ」はこのカートから。',
  },
};

export default home;

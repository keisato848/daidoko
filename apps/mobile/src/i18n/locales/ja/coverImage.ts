/**
 * レシピ「イメージ」の AI 生成（docs/レシピ表紙AI生成設計.md）。
 *
 * **画面では「表紙」と言わない**（設計冒頭の利用者決定）。
 * 「イメージ」「AI プレビュー」と呼ぶ。内部名（`coverPhotoPath`・`cover-image`）を
 * そのまま画面文言に持ち込まないこと。
 */
import type { CriticalMessage } from '../../types';

const coverImage = {
  /** PhotoPickerField（cover variant）の第 3 アクション。 */
  action: 'AIでイメージをつくる',
  /** タイトル未入力で押せないときの理由（トーストではなく静的な添え書き）。 */
  actionDisabledHint: '料理名を入力すると使えます',
  /**
   * 押せる状態のときにボタンの近くへ出す添え書き。**枠は「採用」ではなく「生成」に対して
   * 消費する**（プレビューで［やめる］を押しても戻らない・設計 §3）ので、押す前に伝える。
   */
  actionHint: '生成のたびに無料枠を1枚つかいます',
  /**
   * 送信先の開示。**書かないと不当な収集になる**ので A 階層。
   * `actionHint` は枠の話であって送信の話ではないので、別の 1 行として出す。
   * 送るのは料理名・材料名・タグだけ（`cover-image.provider.ts`）— 写真は送らない。
   */
  actionDisclosure: {
    text: '料理名・材料名・タグをサーバー（AI 提供元）に送信します。写真は送りません。',
    intent:
      'MUST name the three things that leave the device (dish name, ingredient names, tags) AND ' +
      'MUST say photos are NOT sent — this sits beside a photo picker, so silence reads as ' +
      '"my photos go too". MUST NOT be merged into the free-credit hint, which is about quota.',
  } satisfies CriticalMessage,
  generating: 'イメージを作っています…',

  /**
   * プレビューシートの見出し。**AI が作ったものだと必ず伝える**（安全・信頼に関わる —
   * ここを弱めると「本物の写真」だと誤解されたまま採用されてしまう）。
   */
  previewNotice: {
    text: 'AIが作ったイメージです。実際の仕上がりとは異なります。',
    intent:
      'MUST make clear this image was AI-generated and MUST warn the actual dish may look ' +
      'different. This is the only label the user sees before adopting it as the recipe cover — ' +
      'softening it into a generic caption risks the image being mistaken for a real photo.',
  } satisfies CriticalMessage,
  useThis: 'このイメージにする',
  retry: '作り直す（1回ぶん使います）',
  cancel: 'やめる',
  report: '報告する',

  /** 一覧カード・詳細ヘッダの小さなバッジ。 */
  badge: 'AI',
  /** 詳細画面、バッジの下に添える 1 行。 */
  detailNote: 'AIが作ったイメージです。実物とは異なります。',

  /** 枠切れ時に、その場で広告視聴を持ちかけるダイアログ（写真レシピ等の ai.adGate とは別勘定）。 */
  adGate: {
    title: '今月の無料枠を使い切りました',
    body: '短い広告を見ると、イメージ生成をもう1回使えます（貯めずにその場で1回だけ）。',
    watch: '広告を見る',
  },

  error: {
    failed: 'イメージの生成に失敗しました。もう一度お試しください。',
  },
};

export default coverImage;

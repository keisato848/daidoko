export const meta = {
  name: 'persona-review',
  description:
    'ストアスクショ列を 5 人のペルソナ（軽量モデル）が初見レビュー — 摩擦・文言・課金導線の定性評価を和集合で返す',
  whenToUse:
    'リリースごと、スクショ確定後・提出前に。「使い勝手が伝わるか」「課金導線のどこで価値が伝わっていないか」を機械的に点検したいとき。課金意向の予測には使わない（それは Play/AdMob の実指標で見る）。',
  phases: [
    { title: 'Review', detail: '5 ペルソナが並列で初見レビュー' },
    { title: 'Synthesize', detail: '和集合 → 既知の設計判断と突合 → レポート' },
  ],
};

/**
 * args:
 *   version: '1.12.2'            … レポートの見出しに使う
 *   jaDir:   'docs/store/google-play/phone-screenshots'      … 日本語スクショのディレクトリ
 *   enDir:   'docs/store/google-play/phone-screenshots-en'   … 英語スクショのディレクトリ
 *
 * ペルソナの人格は .claude/agents/persona-*.md（model: sonnet）。
 * ここでは評価タスクと出力形だけを与える。
 */

const REVIEW = {
  type: 'object',
  required: ['first_impression', 'friction', 'copy_issues', 'monetization', 'praise'],
  properties: {
    first_impression: {
      type: 'string',
      description: '最初の 1 枚（掲載順の先頭）を見た瞬間の反応。2 文以内',
    },
    friction: {
      type: 'array',
      description: '引っかかった点。無ければ空配列',
      items: {
        type: 'object',
        required: ['screen', 'issue', 'severity'],
        properties: {
          screen: { type: 'string', description: 'ファイル名（例 04-cooking-mode.png）' },
          issue: { type: 'string' },
          severity: {
            type: 'string',
            description: 'high=離脱しかねない / mid=印象を下げる / low=気になる程度',
          },
          suggestion: { type: 'string' },
        },
      },
    },
    copy_issues: {
      type: 'array',
      description: '誤解する・通じない文言。無ければ空配列',
      items: {
        type: 'object',
        required: ['screen', 'text', 'misreading'],
        properties: {
          screen: { type: 'string' },
          text: { type: 'string', description: '問題の文言そのもの' },
          misreading: { type: 'string', description: 'この人物がどう誤読・困惑するか' },
        },
      },
    },
    monetization: {
      type: 'object',
      required: ['value_understood', 'reaction'],
      properties: {
        value_understood: {
          type: 'boolean',
          description: '無料枠と「使い放題にする」の価値・仕組みが画面から伝わったか',
        },
        reaction: {
          type: 'string',
          description: '課金・広告の気配への正直な反応。「払うか」ではなく感じ方',
        },
        irritation_risk: { type: 'string', description: '不快に転びうる条件があれば' },
      },
    },
    abandon_risk: {
      type: 'object',
      description: 'この人物が離脱しそうな画面。無ければ省略',
      properties: {
        screen: { type: 'string' },
        reason: { type: 'string' },
      },
    },
    praise: {
      type: 'array',
      items: { type: 'string' },
      description: '本当に良いと感じた点だけ。無ければ空配列',
    },
  },
};

/** ペルソナと見せるスクショ列の対応。emma だけ英語掲載を見る。 */
const PERSONAS = [
  { agent: 'persona-hina', label: 'ひな(初心者)', dirKey: 'jaDir' },
  { agent: 'persona-takeshi', label: 'たけし(共働き親)', dirKey: 'jaDir' },
  { agent: 'persona-misa', label: 'みさ(コレクター)', dirKey: 'jaDir' },
  { agent: 'persona-emma', label: 'Emma(English)', dirKey: 'enDir' },
  { agent: 'persona-noriko', label: 'のりこ(63)', dirKey: 'jaDir' },
];

/** Play の掲載順（README と ORDER に一致）。この順で「初見」させる。 */
const ORDER = [
  '10-recipe-detail-photo.png',
  '07-photo-to-recipe.png',
  '08-photo-recipe-result.png',
  '01-home-timeline.png',
  '02-recipe-library.png',
  '03-recipe-detail.png',
  '04-cooking-mode.png',
  '06-family-group.png',
];

const version = args?.version ?? 'unknown';

phase('Review');
const reviews = await parallel(
  PERSONAS.map((p) => () => {
    const dir = args?.[p.dirKey];
    const files = ORDER.map((f) => `${dir}/${f}`).join('\n');
    return agent(
      `あなたの人物設定はシステムプロンプトにある。それになりきって答えること。

以下のアプリ画面（Google Play 掲載順）を上から 1 枚ずつ Read で開き、
**この順で初めて見た**ものとして評価せよ:

${files}

全部開いてから、構造化出力で答える。指摘の screen にはファイル名を使う。
人物設定の「規律」を厳守: 見えるものだけ・支払い判断はしない・埋め草の賞賛をしない。`,
      { label: p.label, phase: 'Review', schema: REVIEW, agentType: p.agent },
    ).then((r) => ({ persona: p.label, review: r }));
  }),
);

const ok = reviews.filter(Boolean);
log(`${ok.length}/${PERSONAS.length} ペルソナのレビューを回収`);

phase('Synthesize');
const synthesis = await agent(
  `だいどこ（レシピアプリ）のストアスクショを 5 人のペルソナがレビューした結果を統合し、
リリース判断に使える Markdown レポートを書け。

## 入力（各ペルソナの構造化レビュー）

${JSON.stringify(ok, null, 2)}

## やること

1. **friction / copy_issues を和集合で整理**する。複数ペルソナが同じ画面の同じ問題を挙げていたら
   1 項目にまとめ、誰が挙げたかを併記（複数人が挙げた指摘は重み付けして先頭へ）
2. **既知の設計判断と突合**する。docs/画面設計.md・docs/フリーミアム設計.md・
   docs/store/google-play/phone-screenshots/README.md を Read し、指摘が
   (a) 既に意図された設計（理由があってこうしている）なのか (b) 新規の発見なのかを分類。
   (a) は「既知」節に落とし、本文は (b) だけにする
3. **課金導線の節**: 5 人の monetization を並べ、「価値が伝わっていない箇所」だけを抽出。
   支払い予測はしない（レポートにもその旨を明記）
4. 構成: サマリ（3 行）→ 新規の指摘（severity 順・screen 付き）→ 課金導線 → 既知（1 行ずつ）→
   ペルソナ別の第一印象と離脱リスク（表）→ 良かった点
5. 淡々と書く。改善の実施判断は読み手（人間）に委ねる

Markdown 全文だけを返せ。`,
  { label: 'synthesize', phase: 'Synthesize' },
);

return { version, personas: ok.length, report: synthesis };

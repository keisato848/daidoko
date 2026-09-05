/**
 * 会話文 → 呼ぶべきエージェント の対応表（単一ソース）。
 *
 * ユーザーが役を名指ししなくても専門役・束ねる役が呼ばれるようにするための 2 段目。
 * 1 段目は各エージェントの `description`（Claude が自動委譲の判断に使う）。
 * こちらは `hook-user-prompt-router.mjs`（UserPromptSubmit）が使い、当たったときだけ
 * 「この依頼は ○○ の領域」とコンテキストを注入する（docs/開発ハーネス.md §2・§7-5）。
 *
 * 方針:
 *   - 当たらなければ黙る（毎回何か言うと読まれなくなる）
 *   - 提案は最大 2 役。束ねる役を優先し、専門役は束ねる役が呼ぶ
 *   - スラッシュコマンド・短すぎる文・役を名指し済みの文は対象外
 */

/** @typedef {{ agent: string, ask: string, patterns: RegExp[] }} Route */

/** @type {Route[]} 上にあるほど優先 */
export const ROUTES = [
  {
    agent: 'project-manager',
    ask: '現状・進捗・次の一手・リリース準備・ブロッカーの整理',
    patterns: [
      /現状|進捗|状況(は|を)|今どこ|次(に|は)何|何から|着手|ブロッカー|残(り|タスク|作業)|準備(状況|できて)|出せる状態/,
      /\b(status|progress|what'?s next|blocker|ready to (ship|release))\b/i,
    ],
  },
  {
    agent: 'quality-manager',
    ask: 'PR / リリース / デプロイを出してよいかの判定',
    patterns: [
      /出して(いい|良い|よい|大丈夫)|マージ(して|できる|していい)|PR (に|を)(出|作)|リリースして(いい|良い|よい)|品質(判定|チェック|は大丈夫|どう)|レビュー(を|も)?(して|頼)|テスト(は|が)足り/,
      /\b(can (i|we) (ship|merge|release)|ready for (review|merge)|go\/no-?go|review (this|the) (pr|diff))\b/i,
    ],
  },
  {
    agent: 'product-manager',
    ask: '作る価値・優先度・スコープ・利用者への伝え方',
    patterns: [
      /作(りたい|ろう|るべき|る価値)|欲しい|追加したい|入れたい|どう思う|価値(は|が)ある|優先(度|順)|スコープ(は|が|外)|ユーザー(は|に)(嬉|喜|困)|アイデア|訴求(は|を|文)|掲載文(は|を|の)/,
      /\b(should we build|worth (building|doing)|feature idea|prioriti[sz]e|scope)\b/i,
    ],
  },
  {
    agent: 'app-leader',
    ask: '実装計画・設計判断・どこを変えるか',
    patterns: [
      /どう(実装|作れば|入れれば|組み込)|実装(計画|方針|の順)|設計(は|を|判断)|どこを(変え|触|直)|構成(は|を)|アーキテクチャ|変更(面|範囲)|影響範囲/,
      /\b(how (should|do) (i|we) implement|implementation plan|architecture|where (should|do) (i|we) change)\b/i,
    ],
  },
  {
    agent: 'finding-recorder',
    ask: '分かったことの記録先と書き方',
    patterns: [
      /分かった(こと|の)|記録(して|しておいて)|覚えておいて|メモして|残しておいて|ハマった|落とし穴|次のセッション/,
      /\b(record (this|the) finding|write (this|it) down|remember (this|that))\b/i,
    ],
  },
  {
    agent: 'server-verifier',
    ask: 'サーバーの検証・デプロイ前後の疎通',
    patterns: [/railway|サーバー(を|の)(検証|確認|デプロイ)|デプロイ(前|後|して)|\/health|疎通/i],
  },
  {
    agent: 'release-notes-drafter',
    ask: 'リリースノート・新機能文の起草',
    patterns: [/リリースノート|新機能(の|を)(文|書)|whats?new|release notes?/i],
  },
  {
    agent: 'issue-groomer',
    ask: 'Issue ボードの棚卸し',
    patterns: [
      /issue(s)? ?(を|の)?(整理|棚卸|片付)|ボード(を|の)(整理|棚卸)|ラベル(を|の)(整理|付け)/i,
    ],
  },
  {
    agent: 'growth-analyst',
    ask: 'アナリティクス・継続率・広告効果・収益化の判断',
    patterns: [
      /継続率|リテンション|アンインストール|DAU|MAU|広告(の|は)?(効果|収益|成果)|eCPM|収益化(は|が|の)|アナリティクス|数字(は|を|で)(どう|見)|インストール数/i,
      /\b(retention|ecpm|ad revenue|analytics|installs?)\b/i,
    ],
  },
  {
    agent: 'eval-inference',
    ask: '推論品質の測定・プロンプト変更の評価',
    patterns: [
      /プロンプト.{0,12}(変え|改良|評価|比較|直し)|推論(の|品質|精度)|精度(は|が|どう)|評価セット|合格ライン|vision-eval/i,
    ],
  },
];

/** 名指し判定に使う名前。ROUTES に無い役（作業役・audit-*・persona-*）も名指しなら黙る */
const AGENT_NAMES = [
  ...ROUTES.map((r) => r.agent),
  'android-verifier',
  'ios-release-mac',
  'store-ops',
  'diff-critic',
  'test-writer',
  'audit-',
  'persona-',
];
const MAX_SUGGESTIONS = 2;

/**
 * @param {string} text ユーザーの発話
 * @returns {Route[]} 当たった経路（優先順・最大 2 件）。対象外なら空
 */
export function routePrompt(text) {
  if (typeof text !== 'string') return [];
  const prompt = text.trim();
  if (prompt.length < 6) return [];
  if (prompt.startsWith('/')) return [];
  // 役を名指ししている（`product-manager` 等）なら本人が分かっているので黙る
  if (AGENT_NAMES.some((name) => prompt.includes(name))) return [];
  const hits = ROUTES.filter((route) => route.patterns.some((re) => re.test(prompt)));
  return hits.slice(0, MAX_SUGGESTIONS);
}

/** 注入するコンテキスト文。当たりが無ければ null */
export function routeContext(text) {
  const routes = routePrompt(text);
  if (routes.length === 0) return null;
  const lines = routes.map((r) => `  - \`${r.agent}\`（${r.ask}）`);
  return [
    '🧭 この依頼は次の役の領域に見える。名指しが無くても Agent ツールで呼び、結論を持ち帰ること（docs/開発ハーネス.md §7-5）:',
    ...lines,
    '  当たっていなければ無視してよい。',
  ].join('\n');
}

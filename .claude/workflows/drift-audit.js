export const meta = {
  name: 'drift-audit',
  description:
    '出荷物と説明・導線・ルート判定・テスト・設計書の食い違いを 5 系統で監査する（再発防止スイート）',
  whenToUse:
    'PR を出す前と、リリース前。2026-08-31 の監査で見つかった 5 つの見逃しの型（文言の嘘・導線の重複増殖・パス部分一致の誤爆・歯の無いテスト・設計書との乖離）を機械的に点検する。いずれも型・lint・テストが通る種類の壊れ方で、人が読む以外に見つける手が無い。',
  phases: [
    { title: 'Audit', detail: '5 つの検査役が並列で点検' },
    { title: 'Synthesize', detail: '重複排除して severity 順に整理' },
  ],
};

/**
 * args:
 *   scope: 'full' | 'changed'（既定 'changed'）
 *     changed = 直近の変更に関係する範囲だけ見る（PR 前の常用）
 *     full    = 全体を見る（リリース前・月次）
 *   focus: 走らせる検査役の名前の配列（省略時は全部）
 *   context: 追加の文脈（「今回のPRは○○を変えた」など）。プロンプトに足される
 *
 * 検査役の人格は .claude/agents/audit-*.md。ここでは走らせ方と出力形だけを決める。
 */

const FINDINGS = {
  type: 'object',
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: '3 文以内。見つからなければ「見つからなかった」' },
    findings: {
      type: 'array',
      description: '見つからなければ空配列。水増ししない',
      items: {
        type: 'object',
        required: ['severity', 'title', 'evidence'],
        properties: {
          severity: {
            type: 'string',
            description:
              'high=利用者に誤解や機能欠落が届く / mid=分かりにくい・次に壊れる / low=気になる程度',
          },
          title: { type: 'string', description: '短い見出し' },
          file: { type: 'string', description: 'パス:行' },
          evidence: {
            type: 'string',
            description: '**両側を並べる**。文言と実体、設計書と実装、期待値と実装 など',
          },
          fix: { type: 'string', description: '直すならどうするか（1〜2 文）' },
        },
      },
    },
  },
};

const AUDITORS = [
  { agent: 'audit-copy-drift', label: '文言と実装', task: '画面の文言が実装と食い違っていないか' },
  {
    agent: 'audit-nav-duplication',
    label: '導線の重複',
    task: '同じ場所へ行く導線が重複していないか・ホームが肥大していないか',
  },
  {
    agent: 'audit-route-match',
    label: 'パス誤爆',
    task: '文字列の部分一致でルートを判定して誤爆していないか',
  },
  { agent: 'audit-test-teeth', label: 'テストの歯', task: '緑だが守っていないテストが無いか' },
  { agent: 'audit-design-drift', label: '設計との乖離', task: '設計書と実装が食い違っていないか' },
  {
    agent: 'audit-listing-claims',
    label: '掲載文の主張',
    task: 'ストア掲載文の主張が実装で裏取りできるか',
  },
];

const scope = args?.scope === 'full' ? 'full' : 'changed';
const focus = Array.isArray(args?.focus) ? args.focus : null;
const selected = focus ? AUDITORS.filter((a) => focus.includes(a.agent)) : AUDITORS;

if (selected.length === 0) {
  throw new Error(`focus に一致する検査役がいない: ${JSON.stringify(args?.focus)}`);
}

const scopeNote =
  scope === 'full'
    ? '**全体**を見よ。時間をかけてよい。'
    : `**直近の変更に関係する範囲**だけ見よ。まず \`git status --short\` と
\`git diff --stat origin/main...HEAD\` で何が変わったかを掴み、**変更に関係しない指摘はしない**。
変更が docs/ や .claude/ だけなら「対象なし」として即座に空で返してよい（無理に探さない）。
**ただし \`docs/store/\` の変更は例外** — 掲載文は公開される約束なので、
audit-listing-claims は docs のみの変更でも必ず点検すること。`;

phase('Audit');
const results = await parallel(
  selected.map(
    (a) => () =>
      agent(
        `あなたの検査観点はシステムプロンプトにある。それに従って **${a.task}** を点検せよ。

読むだけ。**変更は一切しない。** git のブランチ操作もしない。

## 範囲
${scopeNote}
${args?.context ? `\n## 今回の文脈\n${args.context}\n` : ''}
## 出力の規律
- **見つからなければ findings は空配列**にせよ。埋め草の指摘をしない
- evidence には**両側を並べる**（文言と実体 / 設計書と実装 / 期待値と実装）。
  片側だけでは読み手が判断できない
- 確度が低いものは severity を下げ、「要目視」と明記する`,
        { label: a.label, phase: 'Audit', schema: FINDINGS, agentType: a.agent },
      ).then((r) => ({ auditor: a.label, ...r })),
  ),
);

const ok = results.filter(Boolean);
const total = ok.reduce((n, r) => n + (r.findings?.length ?? 0), 0);
log(`${ok.length}/${selected.length} の検査を回収・指摘 ${total} 件`);

if (total === 0) {
  return { scope, auditors: ok.length, findings: 0, report: '指摘なし。' };
}

phase('Synthesize');
const report = await agent(
  `だいどこの drift 監査（5 系統）の結果を統合し、日本語 Markdown の短いレポートにせよ。

## 入力
${JSON.stringify(ok, null, 2)}

## やること
1. **同じ問題を複数の検査役が挙げていたら 1 件にまとめ**、誰が挙げたかを併記する
   （複数人が挙げたものを上に）
2. **既に意図された設計判断は除外する。** \`docs/画面設計.md\` /
   \`docs/お店の味を再現設計.md\` / \`docs/買い物リスト・在庫設計.md\` /
   \`docs/フリーミアム設計.md\` を読み、理由が記録されている決定は
   「既知」節に 1 行で落として本文から外す
3. severity 順に並べ、各項目に「症状 → なぜそうなったか → 直し方」を書く
4. **指摘が少なければ短く終える。** 分量で価値を示そうとしない
5. 最後に「このうちリリースを止めるべきものはあるか」を 1〜2 行で

推測を事実のように書かない。判断を読み手に丸投げしない。`,
  { label: 'synthesize', phase: 'Synthesize' },
);

return { scope, auditors: ok.length, findings: total, report };

export const meta = {
  name: 'change-review',
  description:
    'ブランチの差分を 4 つの別の目（批判役・初見・セキュリティ・約束の整合）で読み、指摘を 1 件ずつ反証してから go / no-go を出す（PR 前のセカンドオピニオン）',
  whenToUse:
    'PR を出す前。外部の LLM（Copilot / Gemini）に頼らず、スイートの中で「書いた本人と別の目」を作りたいとき。diff-critic 単体より重いが、指摘が反証を通っているので読む価値がある。drift-audit（出荷物と説明の食い違い）とは別物で、両方回す。',
  phases: [
    { title: 'Review', detail: '4 つの目が並列で差分を読む' },
    { title: 'Verify', detail: '指摘ごとに反証役が「本当か」を確かめる' },
    { title: 'Synthesize', detail: '生き残った指摘から go / no-go と PR コメント用ブロックを作る' },
  ],
};

/**
 * args:
 *   base:        比較元（既定 'origin/main'）。`git diff <base>...HEAD` を各役が読む
 *   context:     今回の変更の意図（PR 本文など）。プロンプトに足される
 *   maxFindings: 反証に回す指摘の上限（既定 8。超えた分は severity 順に落とし、log で明示する）
 *
 * 出力: { verdict, confirmed, refuted, dropped, report }
 *   report は Markdown。末尾に PR コメントへ貼る判定ブロックを含む（司令塔が貼る。docs/開発ハーネス.md §7-3）
 *
 * 役の人格: diff-critic は .claude/agents/diff-critic.md。他の 3 つの目はここで与える
 * （リポジトリの監査観点を持たない「初見」を 1 つ入れるのが目的。model: sonnet で別の頭にする）。
 */

const SEVERITY_ORDER = { block: 0, should: 1, nit: 2 };

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
        required: ['severity', 'title', 'file', 'failure_scenario'],
        properties: {
          severity: {
            type: 'string',
            description:
              'block=利用者に届く不具合・データ破損・規約違反 / should=次に壊れる・保守で踏む / nit=好み',
          },
          title: { type: 'string', description: '短い見出し' },
          file: { type: 'string', description: 'パス:行' },
          failure_scenario: {
            type: 'string',
            description: 'どの入力・どの操作で・何が起きるか。具体的に。推測なら「推測:」を付ける',
          },
          fix: { type: 'string', description: '直すならどうするか（1〜2 文）' },
        },
      },
    },
  },
};

const VERDICT = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: {
    refuted: {
      type: 'boolean',
      description: 'true=指摘は成り立たない（または確かめられない）。迷ったら true',
    },
    reason: { type: 'string', description: '根拠。ファイル:行を引用する' },
    severity_adjust: {
      type: 'string',
      description:
        '成り立つが severity が違うなら block / should / nit のどれが妥当か。同じなら省略',
    },
  },
};

const base = typeof args?.base === 'string' && args.base ? args.base : 'origin/main';
const maxFindings =
  Number.isInteger(args?.maxFindings) && args.maxFindings > 0 ? args.maxFindings : 8;
const contextNote = args?.context
  ? `\n## 今回の変更の意図（メインループから）\n${args.context}\n`
  : '';

const common = `対象は **\`git diff --stat ${base}...HEAD\` と \`git diff ${base}...HEAD\`** の差分。まずそれを読め。
差分に無いことを指摘しない。読むだけで、**ファイルを変更しない**。git のブランチ操作もしない。
${contextNote}
## 出力の規律
- 見つからなければ findings は空配列。埋め草の指摘をしない
- 各指摘に「どの入力・どの操作で壊れるか」を必ず書く。書けない指摘は出さない
- 推測は「推測:」と明記し severity を下げる`;

/** 4 つの目。diff-critic はリポジトリの批判役、残りはここで人格を与える */
const REVIEWERS = [
  {
    label: '批判役（diff-critic）',
    agentType: 'diff-critic',
    prompt: `あなたの観点はシステムプロンプトにある。それに従って差分を敵対的に読め。\n${common}`,
  },
  {
    label: '初見（別の頭）',
    model: 'sonnet',
    prompt: `あなたはこのリポジトリを初めて見るレビュアーで、リポジトリ固有の監査観点は持っていない。
一般的なソフトウェアの目で読む: 境界値・null・空・重複・非 ASCII・並行実行・例外の握りつぶし・
名前と実体のずれ・コメントと実装のずれ・「書いてあるが実行されないコード」。
分からない前提は推測せず「前提が分からないので確認したい」と書く。\n${common}`,
  },
  {
    label: 'セキュリティ・権限',
    prompt: `セキュリティと権限の目で読む: 秘密情報の混入（キー・トークン・サービスアカウント・環境変数の値）、
外向きアクション（提出・デプロイ・公開・書き込み API）が承認なしに走る経路、
権限の広がり（読むだけの役に書けるツール、許可リストの緩み）、入力の未検証、
削除・上書きの不可逆操作。この差分に**無ければ空で返す**。\n${common}`,
  },
  {
    label: '約束の整合',
    prompt: `「書いてあることと実体」の整合を読む: 説明文（description・README・設計書・PR 本文）が
実装と一致しているか、対応表や列挙に片側だけ足していないか（同期エンティティ・ルート名一覧・
ラベル規約・委譲表）、数値（上限・字数・件数）が正典と一致しているか、
参照先（ファイル・節番号・Issue 番号）が実在するか。\n${common}`,
  },
];

phase('Review');
const reviews = await parallel(
  REVIEWERS.map(
    (r) => () =>
      agent(r.prompt, {
        label: r.label,
        phase: 'Review',
        schema: FINDINGS,
        ...(r.agentType ? { agentType: r.agentType } : {}),
        ...(r.model ? { model: r.model } : {}),
      }).then((res) => ({ reviewer: r.label, ...res })),
  ),
);
const ok = reviews.filter(Boolean);
log(`${ok.length}/${REVIEWERS.length} の目を回収`);

// 重複排除（同じファイル・似た見出し）。ここは全指摘が揃ってから行う必要があるので barrier の後
const seen = new Map();
for (const r of ok) {
  for (const f of r.findings ?? []) {
    const key = `${(f.file ?? '').split(':')[0]}|${(f.title ?? '').replace(/\s+/g, '').slice(0, 24)}`;
    const prev = seen.get(key);
    if (prev) {
      prev.reviewers.push(r.reviewer);
      if ((SEVERITY_ORDER[f.severity] ?? 9) < (SEVERITY_ORDER[prev.severity] ?? 9)) {
        prev.severity = f.severity;
      }
    } else {
      seen.set(key, { ...f, reviewers: [r.reviewer] });
    }
  }
}
const all = [...seen.values()].sort(
  (a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
    b.reviewers.length - a.reviewers.length,
);
const toVerify = all.slice(0, maxFindings);
const dropped = all.slice(maxFindings);
log(
  `指摘 ${all.length} 件（重複排除後）。反証に回す ${toVerify.length} 件、落とした ${dropped.length} 件`,
);
if (dropped.length > 0) {
  log(
    `落とした指摘（severity 低い順に切った）: ${dropped.map((f) => `${f.severity} ${f.title}`).join(' / ')}`,
  );
}

if (toVerify.length === 0) {
  return {
    verdict: 'go',
    confirmed: [],
    refuted: [],
    dropped,
    report: `## 判定: go\n\n4 つの目（${ok.map((r) => r.reviewer).join('・')}）のいずれも指摘なし。\n\n### PR コメント用\n\`\`\`\nchange-review: go（指摘 0 件・反証なし）\n\`\`\``,
  };
}

phase('Verify');
const verified = await pipeline(toVerify, (f) =>
  agent(
    `次の指摘を**反証**せよ。指摘が正しいと信じる側ではなく、崩す側に立て。

## 指摘
- severity: ${f.severity}
- 見出し: ${f.title}
- 場所: ${f.file}
- 壊れ方: ${f.failure_scenario}
- 直し方の案: ${f.fix ?? '（無し）'}
- 挙げた目: ${f.reviewers.join('・')}

## やること
1. \`${f.file}\` の実物を Read し、必要なら \`git diff ${base}...HEAD\` と周辺の呼び出し元を Grep する
2. 「壊れ方」に書かれた入力・操作で本当にそうなるかを、コードを引用して確かめる
3. 成り立たない・確かめられない・差分と無関係 なら refuted=true。**迷ったら true**
4. 成り立つなら refuted=false とし、severity が違うなら severity_adjust に書く

ファイルは変更しない。`,
    { label: `反証: ${f.title}`, phase: 'Verify', schema: VERDICT, effort: 'high' },
  ).then((v) => ({ ...f, verdict: v })),
);

const confirmed = verified
  .filter(Boolean)
  .filter((f) => f.verdict && f.verdict.refuted === false)
  .map((f) => ({ ...f, severity: f.verdict.severity_adjust || f.severity }));
const refuted = verified.filter(Boolean).filter((f) => !f.verdict || f.verdict.refuted !== false);
log(`反証を通った指摘 ${confirmed.length} 件・落ちた ${refuted.length} 件`);

phase('Synthesize');
const report = await agent(
  `だいどこの change-review（4 つの目 → 反証）の結果を、日本語 Markdown の短いレポートにせよ。

## 反証を通った指摘
${JSON.stringify(confirmed, null, 2)}

## 反証で落ちた指摘（参考。本文には入れず、末尾に 1 行ずつ）
${JSON.stringify(
  refuted.map((f) => ({ title: f.title, file: f.file, reason: f.verdict?.reason ?? '回収できず' })),
  null,
  2,
)}

## 反証に回せず落とした指摘
${JSON.stringify(
  dropped.map((f) => ({ severity: f.severity, title: f.title, file: f.file })),
  null,
  2,
)}

## 書き方
1. 先頭に **判定: go / 条件付き go / no-go**。block が 1 件でも通っていれば no-go、should だけなら条件付き go、nit だけか 0 件なら go
2. 通った指摘を severity 順に「ファイル:行 — 壊れ方 → 直し方 — 挙げた目 / 反証役の根拠」で
3. 「反証で落ちたもの」は見出しと落ちた理由を 1 行ずつ（読み手が同じ疑いを再燃させないため）
4. 反証に回せず落とした指摘があれば「未検証」として列挙する（無かったことにしない）
5. 最後に **PR コメント用** のコードブロック（判定・block の一覧・go にする条件。10 行以内）

推測を事実のように書かない。分量で価値を示さない。判定が go なら短く終える。`,
  { label: 'synthesize', phase: 'Synthesize' },
);

const verdict = confirmed.some((f) => f.severity === 'block')
  ? 'no-go'
  : confirmed.some((f) => f.severity === 'should')
    ? 'conditional-go'
    : 'go';

return { verdict, confirmed, refuted, dropped, report };

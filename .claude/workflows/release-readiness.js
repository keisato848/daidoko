export const meta = {
  name: 'release-readiness',
  description:
    'リリース準備状況の並列監査 — リポジトリ/CI・タスクボード・設定整合を3系統で点検し readiness レポートを返す',
  whenToUse:
    'リリース着手前（release-play / monetize-golive / ios-release の前）に「いま出せる状態か」を一括点検したいとき。',
  phases: [{ title: 'Audit', detail: 'repo / board / config を並列点検' }],
};

const REPORT = {
  type: 'object',
  required: ['ok', 'findings'],
  properties: {
    ok: { type: 'boolean', description: 'この観点でリリースを止める問題が無ければ true' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'message'],
        properties: {
          severity: { type: 'string', description: 'blocker | warn | info' },
          message: { type: 'string' },
        },
      },
    },
  },
};

phase('Audit');
const [repo, board, config] = await parallel([
  () =>
    agent(
      `daidoko リポジトリのリリース準備状況を点検して findings を返せ。確認事項:
1. git status --porcelain（未コミット変更は blocker）
2. 現在ブランチと develop/main の差分: git log --oneline main..develop | head（develop に未リリースの何があるか = info）
3. 開いている PR: gh pr list --state open（マージ待ちは warn）
4. 直近 CI: gh run list --limit 3（main/develop の失敗は blocker）
判断できない点は severity=info で記載。`,
      { label: 'audit:repo', phase: 'Audit', schema: REPORT },
    ),
  () =>
    agent(
      `daidoko の GitHub Issues タスクボードを点検して findings を返せ。
1. gh issue list --repo keisato848/daidoko --state open --json number,title,labels,milestone --limit 50
2. マイルストーン M1（広告有効化）/ M2（iOS 初回）の open issue を分類:
   - blocked:external / blocked:decision / agent:user ラベル付き = 外部・ユーザー待ち（info）
   - それ以外の open = 未完了の作業あり（リリース対象のマイルストーンなら warn）
3. どのマイルストーンが「あとどれだけ」かを要約して findings に含める。`,
      { label: 'audit:board', phase: 'Audit', schema: REPORT },
    ),
  () =>
    agent(
      `daidoko の設定整合を点検して findings を返せ。確認事項:
1. apps/mobile/app.json: version と android.versionCode（前回リリースは 1.3.0/10010。バンプ済みかは文脈依存なので info で報告）
2. AD_ID 整合: android.blockedPermissions に com.google.android.gms.permission.AD_ID が「ある」= 広告なし構成 /「ない」= 広告あり構成。eas.json の EXPO_PUBLIC_ADMOB_ENABLED の有無と突合し、片方だけ広告ありなら blocker
3. eas.json に EXPO_PUBLIC_REVENUECAT_API_KEY が入っていたら blocker（方針A: 課金保留 — docs/リリース手順.md §6-0-a）
4. docs/リリース手順.md §6-0 の残作業表と現状の食い違いがあれば warn`,
      { label: 'audit:config', phase: 'Audit', schema: REPORT },
    ),
]);

const sections = [
  ['repo/CI', repo],
  ['タスクボード', board],
  ['設定整合', config],
];
const blockers = [];
const warns = [];
const infos = [];
for (const [name, r] of sections) {
  for (const f of r?.findings ?? []) {
    const line = `[${name}] ${f.message}`;
    if (f.severity === 'blocker') blockers.push(line);
    else if (f.severity === 'warn') warns.push(line);
    else infos.push(line);
  }
}
return {
  ready: blockers.length === 0,
  blockers,
  warns,
  infos,
};

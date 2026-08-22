/**
 * 「分かったことをどこに書くか / どこを見れば分かるか」の単一ソース。
 *
 * 同じ穴を掘り直さないための索引。CLAUDE.md §5「分かったことは必ずリポジトリに残す」を
 * 機械側から支える:
 *   - `hook-session-start.mjs` … セッション開始時にこの索引を出す（**見に行かせる**）
 *   - `hook-stop-docs-guard.mjs` … 調べ物・検証をしたのに記録が増えていないターンで督促する
 *   - `.claude/skills/record-finding` … 書き方（症状→原因→対処）の作法
 *
 * ここを増やすときは、**実在するファイルだけ**を書くこと（session-start が実在を確かめて
 * 出すので、消えた文書を指し続けると気づける）。
 */

/** 分かったことの種類 → 記録先。session-start でそのまま表示する */
export const KNOWLEDGE_TARGETS = [
  {
    kind: 'テストの罠（緑のまま本番が死ぬ類）',
    path: 'docs/品質基準.md',
    section: '§2.3',
  },
  {
    kind: '実機・エミュレーター操作の罠',
    path: 'docs/開発ハーネス.md',
    section: '§4',
  },
  {
    kind: '設計の判断と、設計書どおりで壊れた点',
    path: 'docs/クラウド同期設計.md',
    section: '§5-1b / §5-1c（他の機能は該当する設計書へ）',
  },
  {
    kind: 'リリース・ストア運用でハマったこと',
    path: 'docs/リリース手順.md',
    section: '該当節と Skill',
  },
];

/**
 * 「調べ物・検証をした」と見なすコマンドの痕跡。
 * ここに当たるコマンドを流したターンは、何かしら**分かったことがあるはず**という前提で
 * 記録の有無を一度だけ確認する（ブロックは 1 回きり・理由を言えば通せる）。
 */
export const INVESTIGATION_SIGNALS = [
  /\badb\b/i,
  /\bemulator\.exe\b/i,
  /uiautomator/i,
  /build-android\.mjs/,
  /\blogcat\b/i,
  /\bdumpsys\b/i,
  /record-device-verification/,
];

/** 記録が増えたと見なすパス（ドキュメント・Skill・エージェント定義） */
export const KNOWLEDGE_PATH_HINT =
  /^(docs\/|\.claude\/(skills|agents)\/|\.github\/(skills|agents)\/|CLAUDE\.md$)/;

/** session-start に出す索引テキスト（1 行 1 項目） */
export function knowledgeIndexLines() {
  return KNOWLEDGE_TARGETS.map((entry) => `  - ${entry.kind} → ${entry.path} ${entry.section}`);
}

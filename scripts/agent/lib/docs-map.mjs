/**
 * 「このファイルを変更したら、このドキュメント/Skill の更新を検討する」対応表。
 * hook-posttool-docs-reminder（編集直後の注入）と hook-stop-docs-guard
 * （ターン終了時の未更新チェック）で共有する。
 */
export const DOC_RULES = [
  {
    pattern: /^(scripts\/agent\/hook-|\.githooks\/|\.claude\/settings\.json$)/,
    target: 'docs/開発ハーネス.md（フック一覧）',
  },
  {
    pattern: /^scripts\/agent\/(build-android|device-shot|preflight|install-apk)/,
    target: 'docs/開発ハーネス.md と docs/リリース手順.md',
  },
  {
    pattern: /^scripts\/release\//,
    target: 'docs/リリース手順.md §3 と .claude/skills/update-store-listing',
  },
  {
    pattern: /^(railway\.json|apps\/server\/Dockerfile)$/,
    target: 'docs/リリース手順.md §1 と .claude/skills/deploy-server',
  },
  {
    pattern: /^apps\/mobile\/eas\.json$/,
    target: 'docs/リリース手順.md §2 と .claude/skills/release-play',
  },
  {
    pattern: /^\.claude\/(agents|skills)\//,
    target: 'docs/開発ハーネス.md §1 構成マップ',
  },
  {
    pattern: /^apps\/server\/src\/routes\//,
    target: 'docs/アーキテクチャ設計.md（API エンドポイント一覧）',
  },
  {
    pattern: /^apps\/mobile\/src\/db\/(schema|migrate)\.ts$/,
    target: 'docs/データ設計.md（エンティティ・マイグレーション）',
  },
];

/** ドキュメント側とみなすパス（これが同時に変更されていれば督促しない） */
export const DOC_TARGET_HINT = /^(docs\/|\.claude\/(skills|agents)\/|CLAUDE\.md$)/;

/** リポジトリ相対パスに正規化（Windows 絶対パス・バックスラッシュ対応） */
export function toRepoRelative(filePath, rootDir) {
  if (typeof filePath !== 'string' || !filePath) return '';
  let p = filePath.replace(/\\/g, '/');
  const root = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
  if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    p = p.slice(root.length + 1);
  }
  return p;
}

/** 変更ファイル群に対する督促対象（重複除去済み）を返す */
export function matchDocTargets(files) {
  const targets = new Set();
  const hits = [];
  for (const file of files) {
    for (const rule of DOC_RULES) {
      if (rule.pattern.test(file)) {
        if (!targets.has(rule.target)) {
          targets.add(rule.target);
        }
        hits.push({ file, target: rule.target });
      }
    }
  }
  return { targets: [...targets], hits };
}

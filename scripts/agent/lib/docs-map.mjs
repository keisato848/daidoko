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
  {
    // version/versionCode（§2-1）と AdMob ID・AD_ID blockedPermissions（§6）の単一ソース
    pattern: /^apps\/mobile\/app\.json$/,
    target: 'docs/リリース手順.md §2-1（バージョン）/ §6（AdMob・AD_ID）',
  },
  {
    // config plugin の変更は prebuild しないと反映されない（サイレント no-op の実績あり）
    pattern: /^apps\/mobile\/plugins\//,
    target: 'docs/リリース手順.md（--prebuild 必須の注意）と docs/開発ハーネス.md',
  },
  {
    // ポリシー原本の変更は gist（Play 登録済み公開 URL）への同期が必要
    pattern: /^docs\/privacy-policy\.md$/,
    target: 'gist 同期（docs/リリース手順.md §4 のコマンド）と Play データセーフティの整合確認',
  },
  {
    // Copilot 用資産も開発ハーネスの地図に含める（.claude 側との乖離防止）
    pattern: /^\.github\/(skills|agents|hooks|prompts)\//,
    target: 'docs/開発ハーネス.md §1 構成マップ',
  },
  {
    // フリーミアムのゲート実装は設計書と対で保守する
    pattern: /^apps\/mobile\/src\/services\/(usage|entitlement|ad-reward|byok)/,
    target: 'docs/フリーミアム設計.md',
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

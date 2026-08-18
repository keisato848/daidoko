/**
 * PreToolUse ガード（Bash / PowerShell ツール向け）。
 * .claude/settings.json で配線される。deny=遮断 / ask=ユーザー確認 / allow=通過。
 * ルールは docs/開発ハーネス.md に一覧。実際に事故った・時間を失った操作だけを載せる。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdinJson, runCommand } from './lib/runtime.mjs';
import { classifySigningEnv } from './lib/signing.mjs';

// リポジトリルートはこのファイルの位置（scripts/agent/）から導出する。
// フォルダ名ハードコードは別名 clone でガードが無効化されるため禁止（edit-guard と同じ方針）。
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

// 提出ガード（releaseTagStatus / deviceVerificationStatus）のメモ化用。関数定義より前、
// メインの判定チェーンより前に宣言する必要がある
// （`let` は TDZ にかかるため、関数だけ先に巻き上がっても呼べない）。
let deviceVerificationStatusCache;
let releaseTagStatusCache;
let unpushedCommitsCache;

const payload = await readStdinJson();
const commandText = extractCommandText(payload);
const toolName = extractToolName(payload);

// git のグローバルオプション（-C <path> / -c k=v / --no-pager 等）を挟んだバイパスを防ぐ:
// `git -C <path> reset --hard` も `git reset --hard` と同様に検知する。
const GIT = String.raw`\bgit(?:\s+(?:-[A-Za-z]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+`;
const gitRule = (tail) => new RegExp(GIT + tail, 'i');

if (!commandText) {
  respond('allow', 'No shell-like command detected.');
} else if (gitRule(String.raw`reset\s+--hard`).test(commandText)) {
  respond('deny', 'Destructive git reset is blocked by the repo guardrail.');
} else if (
  // checkout -- <path> / checkout <ref> -- <path> / checkout . はいずれも作業ツリーの変更を破棄する。
  // git restore も同等（--staged のみのアンステージは無害なので除外、--worktree 併用は破壊）。
  gitRule(String.raw`checkout\s+(?:\S+\s+)?--\s+`).test(commandText) ||
  gitRule(String.raw`checkout\s+\.(?:[/\\]|\s|$)`).test(commandText) ||
  (gitRule(String.raw`restore\b`).test(commandText) &&
    (!/--staged\b/i.test(commandText) || /--worktree\b/i.test(commandText)))
) {
  respond('deny', 'Discarding tracked changes is blocked by the repo guardrail.');
} else if (/\badb(\.exe)?(")?\b.*\buninstall\b/i.test(commandText)) {
  respond('deny', 'adb uninstall would delete local app data.');
} else if (/\bpm\s+clear\b/i.test(commandText)) {
  respond('deny', 'pm clear would wipe local SQLite and saved photos.');
} else if (/gradlew(\.bat)?["']?\s+(:app:)?(assemble|bundle)Release/i.test(commandText)) {
  // 生 gradlew は EXPO_NO_METRO_WORKSPACE_ROOT 未設定で必ず失敗する（1.3.0 リリースで3回被弾）
  respond(
    'deny',
    'ローカルの release ビルドは `node scripts/agent/build-android.mjs` を使ってください（生 gradlew は "Unable to resolve ./index.js" で失敗します。docs/リリース手順.md §5）。',
  );
} else if (/\brailway\s+variables\b/i.test(commandText) && !/--json\b/.test(commandText)) {
  // テーブル出力はシークレットの値を会話ログに晒す
  respond(
    'ask',
    'railway variables はテーブル表示だと値（シークレット）が会話に露出します。`--json` でファイルに落としてキー名だけ確認してください。',
  );
} else if (/\brailway\s+up\b/i.test(commandText)) {
  respond('ask', 'Railway 本番へのデプロイです。ユーザーの明示承認を確認してください。');
} else if (
  /\beas\s+submit\b/i.test(commandText) &&
  !/(-p|--platform)\s+ios\b/i.test(commandText) &&
  releaseTagStatus()?.missing
) {
  const { version, versionCode } = releaseTagStatus();
  const tagName = `v${version}-play-${versionCode}`;
  respond(
    'deny',
    `apps/mobile/app.json の versionCode ${versionCode}（v${version}）に対応する git タグがありません。` +
      `先に \`git tag -a ${tagName} -m "..."\` を作成し、` +
      `\`git push origin ${tagName}\` で共有してから submit してください（docs/開発ハーネス.md）。`,
  );
} else if (
  /\beas\s+submit\b/i.test(commandText) &&
  !/(-p|--platform)\s+ios\b/i.test(commandText) &&
  deviceVerificationStatus()?.blocked
) {
  respond('deny', deviceVerificationStatus().reason);
} else if (/\beas\s+submit\b/i.test(commandText)) {
  respond(
    'ask',
    'Google Play への提出（外向きアクション）です。ユーザーの明示承認を確認してください。',
  );
} else if (
  toolName === 'bash' &&
  /\badb(\.exe)?(")?\b/i.test(commandText) &&
  /\/sdcard\//i.test(commandText)
) {
  // Git Bash は /sdcard を C:/Program Files/Git/sdcard に変換して壊す
  respond(
    'ask',
    'Git Bash は /sdcard パスをホスト側パスに変換して壊します。adb のデバイスパス操作は PowerShell ツールで実行してください（docs/開発ハーネス.md）。',
  );
} else if (/bundleRelease/i.test(commandText) && missingSigningEnv().length > 0) {
  respond('ask', `Play signing environment looks incomplete: ${missingSigningEnv().join(', ')}`);
} else if (
  /\badb(\.exe)?(")?\b.*\binstall\b/i.test(commandText) &&
  !/\s-r(\s|$)/i.test(commandText)
) {
  respond('ask', 'Use adb install -r for in-place updates when preserving local data.');
} else if (gitRule(String.raw`push\b[^;&|]*[\s:]main(\s|$)`).test(commandText)) {
  // main への直接 push は禁止（CLAUDE.md: PR 経由のみ）。
  // force-push の ask より先に評価する（`git push --force origin main` を ask に降格させない）。
  respond(
    'deny',
    'main への直接 push は禁止です（リポジトリ規約: PR 経由のみ）。develop からリリース PR を作成してください。',
  );
} else if (gitRule(String.raw`push\b[^;&|]*--force(?!-with-lease)`).test(commandText)) {
  respond('ask', 'Force push should be explicitly confirmed.');
} else if (
  /cd\s+(\.\/)?apps[/\\]mobile\b[^;&|]*(&&|;)\s*pnpm\s+(install|add|update|remove)\b/i.test(
    commandText,
  )
) {
  // apps/mobile 内での pnpm install はルートの hoisted ワークスペースをハイジャックして壊す
  respond(
    'ask',
    'pnpm install/add は必ずリポジトリルートで実行してください（.npmrc node-linker=hoisted。apps/mobile 内で実行するとワークスペースが壊れます）。依存追加は root から `pnpm --filter mobile add <pkg>`。',
  );
} else if (/\beas\s+build\b[^;&|]*--profile\s+production\b/i.test(commandText)) {
  // EAS はローカル作業ディレクトリをアップロードする — 本番ビルドは main checkout が規約
  respond(
    'ask',
    'EAS production ビルドはローカル作業ディレクトリをアップロードします。main を checkout 済みか確認してください（docs/リリース手順.md §2-3）。',
  );
} else if (/\bgh\s+pr\s+merge\b/i.test(commandText) && unpushedCommits()?.blocked) {
  respond('deny', unpushedCommits().reason);
} else if (
  /\bgh\s+pr\s+merge\b/i.test(commandText) ||
  gitRule(String.raw`merge\b`).test(commandText)
) {
  respond(
    'ask',
    'マージ前にエミュレーター/実機での動作確認が必要です（リポジトリ規約）。確認が完了していれば続行してください。',
  );
} else {
  respond('allow', 'Command passed repo guardrails.');
}

function respond(permissionDecision, reason) {
  process.stdout.write(
    `${JSON.stringify(
      {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision,
          permissionDecisionReason: reason,
        },
      },
      null,
      2,
    )}\n`,
  );
}

function extractCommandText(value) {
  const candidates = [
    value?.tool_input?.command, // Claude Code 実ペイロード（snake_case）
    value?.tool_input?.input,
    value?.toolInput?.command, // 旧形式・テスト互換
    value?.toolInput?.input,
    value?.input?.command,
    value?.input?.input,
    value?.arguments?.command,
    value?.arguments?.input,
    value?.command,
  ];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim()) ?? '';
}

function extractToolName(value) {
  const name = value?.tool_name ?? value?.toolName ?? '';
  return typeof name === 'string' ? name.toLowerCase() : '';
}

function missingSigningEnv() {
  return classifySigningEnv().missing;
}

// `eas submit` ガード用: 現在の apps/mobile/app.json の versionCode に対応する git タグが
// あるかを調べる。app.json が読めない・git 呼び出しが失敗する場合は null を返し呼び出し側で
// フェイルオープン（ガードを効かせない）にする — インフラの不調でリリースを止めたくないため。
function releaseTagStatus() {
  if (releaseTagStatusCache !== undefined) return releaseTagStatusCache;
  releaseTagStatusCache = computeReleaseTagStatus();
  return releaseTagStatusCache;
}

/**
 * リリース前の実機検証記録を調べる。
 *
 * 1.4.5 の準備で、**エミュレーターでは1件も出なかった不具合が実機で4件**出た
 * （出力枠の枯渇・差分が注記で埋まる・同名材料の取り違え・明るい写真でボタンが消える）。
 * 「確認したつもり」でリリースしないよう、記録の存在を機械が確かめる。
 *
 * 記録は `node scripts/agent/record-device-verification.mjs` が作る。あれは実際に
 * 端末へ接続し、入っているビルドの versionCode が app.json と一致することまで見る。
 *
 * app.json / git / ファイルの読み取りに失敗したら null（フェイルオープン）。
 * インフラの不調でリリースを止めたくないため。
 */
function deviceVerificationStatus() {
  if (deviceVerificationStatusCache !== undefined) return deviceVerificationStatusCache;
  deviceVerificationStatusCache = computeDeviceVerificationStatus();
  return deviceVerificationStatusCache;
}

function computeDeviceVerificationStatus() {
  const release = releaseTagStatus();
  if (!release) return null;
  const { version, versionCode } = release;
  const relativePath = `docs/verification/${version}-${versionCode}.json`;

  let record;
  try {
    record = JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), 'utf8'));
  } catch {
    return {
      blocked: true,
      reason:
        `v${version}（versionCode ${versionCode}）の実機検証記録がありません（${relativePath}）。\n` +
        '実機にこのビルドを入れて確認し、次で記録してから提出してください:\n' +
        '  node scripts/agent/record-device-verification.mjs --checked "確認した内容"\n' +
        'エミュレーターだけでは足りません。1.4.5 の準備では実機のみで4件の不具合が出ています（docs/開発ハーネス.md §4）。',
    };
  }

  if (record?.device?.isEmulator) {
    return {
      blocked: true,
      reason:
        `${relativePath} はエミュレーターでの記録です（${record.device?.model ?? '不明'}）。\n` +
        '**リリース前の検証は実機で行ってください。** 実データの規模・同名材料・明るい写真といった\n' +
        '条件はエミュレーターでは揃わず、1.4.5 の準備で実機のみで見つかった不具合が4件あります。',
    };
  }

  // 記録した後にアプリを変えたなら、その変更は検証されていない
  const changed = appChangedSince(record.headCommit);
  if (changed && changed.length > 0) {
    return {
      blocked: true,
      reason:
        `実機検証（${record.verifiedAt}）の後に apps/ が変更されています。検証されていない変更が含まれます:\n` +
        `${changed.slice(0, 5).join('\n')}${changed.length > 5 ? `\n… 他 ${changed.length - 5} 件` : ''}\n` +
        '入れ直して再検証し、記録を取り直してください。',
    };
  }

  return { blocked: false };
}

/** 記録時のコミット以降に apps/ が変わっていればそのコミット一覧を返す。判定不能なら null。 */
function appChangedSince(headCommit) {
  if (!headCommit) return null;
  const log = runCommand('git', ['log', '--oneline', `${headCommit}..HEAD`, '--', 'apps'], {
    cwd: REPO_ROOT,
  });
  if (!log.ok) return null;
  return log.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * `gh pr merge` の直前に、**手元のコミットが push 済みか**を確かめる。
 *
 * なぜ要るか: 2026-08-18 に、修正をコミットしただけで push せずに PR をマージし、
 * その 6 ファイル（キーボード周りの水平展開）が main に入らなかった。PR は
 * **push 済みのコミットしか含まない**ので、ローカルにだけある変更は黙って落ちる。
 * CI は通り、マージも成功し、次に実機で触るまで気づけない。
 *
 * 判定は現在のブランチと upstream の差分。upstream 無し（未 push）も対象。
 * git が失敗したときはフェイルオープン（ガードのせいで作業を止めない）。
 */
function unpushedCommits() {
  if (unpushedCommitsCache !== undefined) return unpushedCommitsCache;
  unpushedCommitsCache = computeUnpushedCommits();
  return unpushedCommitsCache;
}

function computeUnpushedCommits() {
  const branch = runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT });
  if (!branch.ok) return null;
  const name = branch.stdout.trim();
  // main や detached HEAD からのマージは、この事故の形にならない
  if (!name || name === 'HEAD' || name === 'main') return null;

  const upstream = runCommand(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { cwd: REPO_ROOT },
  );
  if (!upstream.ok) {
    return {
      blocked: true,
      reason:
        'ブランチ ' +
        name +
        ' はまだ push されていません（upstream 無し）。' +
        'このままマージしても手元のコミットは PR に含まれません。' +
        '先に ' +
        '`' +
        'git push -u origin ' +
        name +
        '`' +
        ' してください。',
    };
  }

  const ahead = runCommand('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd: REPO_ROOT });
  if (!ahead.ok) return null;
  const count = Number(ahead.stdout.trim());
  if (!Number.isFinite(count) || count === 0) return { blocked: false };

  return {
    blocked: true,
    reason:
      'ブランチ ' +
      name +
      ' に push されていないコミットが ' +
      count +
      ' 件あります。' +
      'PR は push 済みのコミットしか含まないので、このままマージすると手元の変更は main に入りません' +
      '（2026-08-18 に実際に 6 ファイル落ちました）。' +
      '先に ' +
      '`' +
      'git push' +
      '`' +
      ' し、PR に反映されたことを確認してからマージしてください。',
  };
}

function computeReleaseTagStatus() {
  let version;
  let versionCode;
  try {
    const app = JSON.parse(readFileSync(resolve(REPO_ROOT, 'apps/mobile/app.json'), 'utf8'));
    version = app?.expo?.version;
    versionCode = app?.expo?.android?.versionCode;
  } catch {
    return null;
  }
  if (!version || !versionCode) return null;

  const tagList = runCommand('git', ['tag', '-l'], { cwd: REPO_ROOT });
  if (!tagList.ok) return null;

  const tags = tagList.stdout.split(/\r?\n/).filter(Boolean);
  const hasTag = tags.some((tag) => new RegExp(`\\b${versionCode}\\b`).test(tag));
  return { version, versionCode, missing: !hasTag };
}

/**
 * PreToolUse ガード（Bash / PowerShell ツール向け）。
 * .claude/settings.json で配線される。deny=遮断 / ask=ユーザー確認 / allow=通過。
 * ルールは docs/開発ハーネス.md に一覧。実際に事故った・時間を失った操作だけを載せる。
 */
import { readStdinJson } from './lib/runtime.mjs';
import { classifySigningEnv } from './lib/signing.mjs';

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

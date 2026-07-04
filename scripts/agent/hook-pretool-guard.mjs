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

if (!commandText) {
  respond('allow', 'No shell-like command detected.');
} else if (/git\s+reset\s+--hard/i.test(commandText)) {
  respond('deny', 'Destructive git reset is blocked by the repo guardrail.');
} else if (/git\s+checkout\s+--\s+/i.test(commandText)) {
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
} else if (/git\s+push\s+--force(?!-with-lease)/i.test(commandText)) {
  respond('ask', 'Force push should be explicitly confirmed.');
} else if (/\bgh\s+pr\s+merge\b/i.test(commandText) || /\bgit\s+merge\b/i.test(commandText)) {
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

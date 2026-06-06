import { readStdinJson } from './lib/runtime.mjs';

const payload = await readStdinJson();
const commandText = extractCommandText(payload);

if (!commandText) {
  respond('allow', 'No shell-like command detected.');
} else if (/git\s+reset\s+--hard/i.test(commandText)) {
  respond('deny', 'Destructive git reset is blocked by the repo guardrail.');
} else if (/git\s+checkout\s+--\s+/i.test(commandText)) {
  respond('deny', 'Discarding tracked changes is blocked by the repo guardrail.');
} else if (/\badb\b.*\buninstall\b/i.test(commandText)) {
  respond('deny', 'adb uninstall would delete local app data.');
} else if (/\bpm\s+clear\b/i.test(commandText)) {
  respond('deny', 'pm clear would wipe local SQLite and saved photos.');
} else if (/bundleRelease/i.test(commandText) && missingSigningEnv().length > 0) {
  respond(
    'ask',
    `Play signing environment looks incomplete: ${missingSigningEnv().join(', ')}`,
  );
} else if (/\badb\b.*\binstall\b/i.test(commandText) && !/\s-r(\s|$)/i.test(commandText)) {
  respond('ask', 'Use adb install -r for in-place updates when preserving local data.');
} else if (/git\s+push\s+--force/i.test(commandText)) {
  respond('ask', 'Force push should be explicitly confirmed.');
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
    value?.toolInput?.command,
    value?.toolInput?.input,
    value?.input?.command,
    value?.input?.input,
    value?.arguments?.command,
    value?.arguments?.input,
    value?.command,
  ];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim()) ?? '';
}

function missingSigningEnv() {
  return [
    'DAIDOKO_UPLOAD_STORE_FILE',
    'DAIDOKO_UPLOAD_STORE_PASSWORD',
    'DAIDOKO_UPLOAD_KEY_ALIAS',
    'DAIDOKO_UPLOAD_KEY_PASSWORD',
  ].filter((key) => !process.env[key]);
}
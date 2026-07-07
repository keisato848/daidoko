/**
 * PreToolUse ガード（Edit / Write / MultiEdit ツール向け）。
 * .claude/settings.json で配線される。コマンドではなく「ファイルへの書き込み内容」を検査する。
 * ルールは docs/開発ハーネス.md に一覧。実際に事故った・事故りかけた書き込みだけを載せる。
 *
 * 1. deny: シークレットらしきリテラル（PEM 秘密鍵 / Google API キー）をリポジトリ内ファイルへ書く
 *    — 許可される書き込み先（.env* / settings.local.json / リポジトリ外）は除外。
 *    コミット時の scan-staged-secrets.mjs より手前で止める一次防衛。
 * 2. ask: eas.json への EXPO_PUBLIC_REVENUECAT_API_KEY 追加
 *    — 収益化方針A（課金なし）の間は投入禁止。Play 側に商品が無い状態でキーを入れると
 *      購入ボタンが実体化して必ず失敗する（docs/リリース手順.md §6-0-a）。
 * 3. ask: package.json への pnpm overrides / patchedDependencies の再導入
 *    — SDK51 時代の残骸。SDK54 では不要と確定済みで、再導入は 16KB 対応を壊すリスク
 *      （memory: expo-sdk-54-upgrade「Do not reintroduce」）。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStdinJson } from './lib/runtime.mjs';

// リポジトリルートはこのファイルの位置（scripts/agent/）から導出する。
// フォルダ名 'daidoko' のハードコードは別名 clone でガードが無効化されるため禁止。
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  .replace(/\\/g, '/')
  .toLowerCase();

const payload = await readStdinJson();
const filePath = extractFilePath(payload);
const content = extractWrittenContent(payload);

// 検査パターンは自己一致（このファイル自身が secret スキャンに引っかかる）を避けるため連結で構築
const PEM_HEADER = new RegExp('-----BEGIN [A-Z ]*' + 'PRIVATE KEY-----');
const GOOGLE_API_KEY = new RegExp('AIza' + '[0-9A-Za-z_-]{35}');
const GOOGLE_AQ_KEY = new RegExp('\\bAQ\\.' + '[A-Za-z0-9_-]{30,}');
const SERVICE_ACCOUNT_KEY = new RegExp('"private_key"\\s*:\\s*"');

if (!filePath || !content) {
  respond('allow', 'No file write detected.');
} else if (isSecretSafeDestination(filePath)) {
  respond('allow', 'Write targets an allowed secret destination.');
} else if (
  PEM_HEADER.test(content) ||
  GOOGLE_API_KEY.test(content) ||
  GOOGLE_AQ_KEY.test(content) ||
  SERVICE_ACCOUNT_KEY.test(content)
) {
  respond(
    'deny',
    'シークレットらしきリテラル（秘密鍵 / API キー）をリポジトリ内ファイルへ書き込もうとしています。' +
      '値は .env（gitignore 済み）や C:\\secure\\ 等リポジトリ外に置き、コードからは環境変数で参照してください（docs/開発ハーネス.md §6）。',
  );
} else if (/eas\.json$/i.test(filePath) && /EXPO_PUBLIC_REVENUECAT_API_KEY/.test(content)) {
  respond(
    'ask',
    '収益化方針A（課金なし）の間は RevenueCat キーを eas.json に入れない規約です。' +
      'Play 側のサブスク商品・RC 紐付け（リリース手順 §6-0 の C〜E）が完了済みか、方針B への変更をユーザーが決定済みかを確認してください。',
  );
} else if (
  /package\.json$/i.test(filePath) &&
  /"(overrides|patchedDependencies)"\s*:/.test(content)
) {
  respond(
    'ask',
    'pnpm overrides / patchedDependencies の追加は SDK51 時代の回避策の再導入の可能性があります。' +
      'SDK54 では不要と確定済み（再導入は 16KB 対応を壊すリスク — memory: expo-sdk-54-upgrade）。本当に必要か確認してください。',
  );
} else {
  respond('allow', 'Write passed repo guardrails.');
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

function extractFilePath(value) {
  const input = value?.tool_input ?? value?.toolInput ?? {};
  const candidate = input.file_path ?? input.filePath ?? input.notebook_path ?? '';
  return typeof candidate === 'string' ? candidate.replace(/\\/g, '/') : '';
}

/** Write は content、Edit は new_string、MultiEdit は edits[].new_string を連結して検査する */
function extractWrittenContent(value) {
  const input = value?.tool_input ?? value?.toolInput ?? {};
  const parts = [];
  if (typeof input.content === 'string') parts.push(input.content);
  if (typeof input.new_string === 'string') parts.push(input.new_string);
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (typeof edit?.new_string === 'string') parts.push(edit.new_string);
    }
  }
  return parts.join('\n');
}

/** シークレットを書いてよい先: gitignore 済み設定・env ファイル・リポジトリ外への絶対パス（C:\secure 等） */
function isSecretSafeDestination(path) {
  if (/(^|\/)(\.env[^/]*|settings\.local\.json)$/i.test(path)) return true;
  const normalized = path.toLowerCase();
  // 相対パス・UNC パスはリポジトリ内とみなして検査対象（fail-closed）
  if (!/^[a-z]:\//.test(normalized)) return false;
  return normalized !== REPO_ROOT && !normalized.startsWith(`${REPO_ROOT}/`);
}

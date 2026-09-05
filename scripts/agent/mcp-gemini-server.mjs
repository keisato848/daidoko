/**
 * Gemini CLI を MCP サーバーとして Claude Code に見せる（stdio・JSON-RPC 2.0・依存なし）。
 *
 * 目的: 「別の LLM のセカンドオピニオン」をスイートの中から呼ぶ（docs/開発ハーネス.md §7-3）。
 * Gemini CLI は Google アカウント（AI Pro）のログインで動き、API キーも追加料金も要らない。
 * このサーバーは `gemini -p <prompt>` を子プロセスで呼ぶだけで、Gemini の出力を文字列で返す。
 * 判断（指摘が本当か）は Claude 側の反証役が行う（change-review の Verify）。
 *
 * 配線: リポジトリ直下の .mcp.json（project scope）。初回はユーザーが承認する。
 * 前提: `npm i -g @google/gemini-cli` と、一度 `gemini` を起動して Google アカウントでログイン済みであること
 *       （リモート環境では OAuth ができないので使えない。ローカル Windows / macOS 用）。
 *
 * 自己検査: `node scripts/agent/mcp-gemini-server.mjs --self-test`
 *   PATH に無い場合は tools/call が isError で「Gemini CLI が見つからない」を返すことを確かめる。
 *   GEMINI_BIN 環境変数で CLI の実体を差し替えられる（自己検査ではスタブを指す）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const SERVER = { name: 'daidoko-gemini', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';
const GEMINI_BIN = process.env.GEMINI_BIN || 'gemini';
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 180_000;

const TOOLS = [
  {
    name: 'ask_gemini',
    description:
      'Gemini（Google AI Pro のログインで動く Gemini CLI）に文章を渡して答えを文字列で返す。' +
      'レビュー・別の目・翻訳など「別の LLM の意見」が欲しいときに使う。判断はこちらで反証してから採用する。',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Gemini への指示。日本語でよい' },
        input: {
          type: 'string',
          description: '指示に添える本文（差分・ファイル内容など）。stdin で渡される',
        },
        model: {
          type: 'string',
          description: 'Gemini CLI の -m に渡すモデル名（省略時は CLI の既定）',
        },
      },
    },
  },
  {
    name: 'review_diff_with_gemini',
    description:
      'ブランチの差分（git diff <base>...HEAD）を Gemini にレビューさせ、指摘を JSON 配列で返す。' +
      'change-review の「別の LLM の目」用。base 省略時は origin/main。',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: '比較元。既定 origin/main' },
        context: { type: 'string', description: '変更の意図（PR 本文など）' },
        model: { type: 'string', description: 'Gemini CLI の -m に渡すモデル名' },
      },
    },
  },
];

const REVIEW_PROMPT = `あなたはこのリポジトリを初めて見るコードレビュアーです。以下の差分を読み、
壊れる入力・呼び出し元の取りこぼし・名前と実体のずれ・説明と実装のずれ・秘密情報の混入 を探してください。
見つからなければ空配列を返してください。水増しは禁止です。

出力は **JSON 配列だけ**（前後に文章を付けない）。各要素:
{"severity":"block|should|nit","title":"短い見出し","file":"パス:行","failure_scenario":"どの入力・操作で何が起きるか","fix":"直し方（1〜2 文）"}
severity の基準: block=利用者に届く不具合・データ破損 / should=次に壊れる・保守で踏む / nit=好み。
推測なら failure_scenario の先頭に「推測:」と書いてください。`;

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  serve();
}

function serve() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 壊れた行は無視（MCP は行単位の JSON-RPC）
    }
    handle(msg)
      .then((result) => {
        if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result });
      })
      .catch((error) => {
        if (msg.id !== undefined) {
          send({
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      });
  });
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER,
      };
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return undefined;
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      return callTool(msg.params?.name, msg.params?.arguments ?? {});
    default:
      if (msg.id === undefined) return undefined; // 未知の通知は無視
      throw new Error(`unknown method: ${msg.method}`);
  }
}

async function callTool(name, args) {
  if (name === 'ask_gemini') {
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
      return errorContent('prompt が空です');
    }
    return runGemini(args.prompt, args.input ?? '', args.model);
  }
  if (name === 'review_diff_with_gemini') {
    const base = typeof args.base === 'string' && args.base ? args.base : 'origin/main';
    const diff = spawnSync('git', ['diff', `${base}...HEAD`], { encoding: 'utf8' });
    if (diff.status !== 0) return errorContent(`git diff に失敗: ${diff.stderr?.trim()}`);
    if (!diff.stdout.trim()) return textContent('[]（差分なし）');
    const prompt = args.context ? `${REVIEW_PROMPT}\n\n変更の意図: ${args.context}` : REVIEW_PROMPT;
    return runGemini(prompt, diff.stdout, args.model);
  }
  return errorContent(`unknown tool: ${name}`);
}

/** gemini -p <prompt> [-m model] に input を stdin で渡し、stdout を返す */
function runGemini(prompt, input, model) {
  return new Promise((resolve) => {
    const cliArgs = ['-p', prompt];
    if (typeof model === 'string' && model) cliArgs.push('-m', model);
    let child;
    try {
      child = spawn(GEMINI_BIN, cliArgs, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    } catch (error) {
      resolve(errorContent(`Gemini CLI を起動できない: ${String(error)}`));
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(errorContent(`Gemini CLI が ${TIMEOUT_MS}ms 以内に返らなかった`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (error) => {
      clearTimeout(timer);
      const hint =
        error.code === 'ENOENT'
          ? 'Gemini CLI が見つからない。`npm i -g @google/gemini-cli` を入れ、一度 `gemini` を起動して Google アカウントでログインする（AI Pro）。リモート環境では使えない'
          : String(error);
      resolve(errorContent(hint));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(errorContent(`Gemini CLI が終了コード ${code}: ${err.trim().slice(0, 500)}`));
        return;
      }
      resolve(textContent(out.trim()));
    });
    child.stdin.end(input);
  });
}

function textContent(text) {
  return { content: [{ type: 'text', text }] };
}

function errorContent(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

/** 自己検査: プロトコルの往復と、CLI 不在時の isError を確かめる */
async function selfTest() {
  const results = [];
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  results.push(['initialize returns serverInfo', init?.serverInfo?.name === SERVER.name]);
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  results.push(['tools/list has 2 tools', list?.tools?.length === 2]);
  const missing = await handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'ask_gemini', arguments: { prompt: 'hi' } },
  });
  const bin = process.env.GEMINI_BIN;
  if (bin) {
    results.push([
      `tools/call via GEMINI_BIN=${bin} returns text`,
      !missing.isError && !!missing.content[0].text,
    ]);
  } else {
    // 実機に gemini が入っていれば本物が答える。無ければ isError
    results.push(['tools/call returns content', Array.isArray(missing?.content)]);
  }
  const unknown = await handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'nope', arguments: {} },
  });
  results.push(['unknown tool is isError', unknown?.isError === true]);
  let failed = 0;
  for (const [label, ok] of results) {
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? '[OK]' : '[NG]'} ${label}\n`);
  }
  process.stdout.write(
    `mcp-gemini-server self-test: ${failed === 0 ? 'OK' : `${failed} failed`}\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

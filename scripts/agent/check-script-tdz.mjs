/**
 * `scripts/**` と `e2e/**` の **module スコープ TDZ** を静的に検出する。
 *
 * ## なぜ要るか（2026-09-01・実際に踏んだ）
 *
 * 撮影スクリプトのガードが `let sessionGuardUsable` の TDZ で 1 行目から死んでおり、
 * **マージ以降どのショット指定でも即 `ReferenceError`** になっていた。
 * 実害ゼロで済んだのは、たまたま次の撮影より前に見つかったから。
 *
 * これを既存の道具は**どれも捕まえない**:
 *
 * | 道具 | 結果 |
 * | --- | --- |
 * | `node --check` | 通る（構文としては正しい） |
 * | `eslint no-use-before-define` | **素通り**（宣言はソース順で参照より前にあるため） |
 * | 型チェック | `scripts/**` は TypeScript ではない |
 * | テスト | `scripts/**` にテストが無い |
 * | レビュー | 通った |
 *
 * `no-use-before-define` が効かない理由: 危険なのは**呼び出しの順序**であって
 * 参照の位置ではない。トップレベルで `run()` を呼び、`run` の中で読む `let` が
 * ファイル後半で宣言されていると、宣言行は関数定義より前にあるので
 * eslint からは正しく見える。実行時だけ落ちる。
 *
 * ## 何を見るか
 *
 * **トップレベルの実行文より後ろで宣言された module スコープの `let` / `var`。**
 *
 * `const` は対象外（設定値として先頭付近に置かれるのが普通で、後ろに置いても
 * 参照されないことが多く、誤検知が増える）。`let` / `var` を後ろで宣言するのは
 * 「実行中に書き換える状態」なので、トップレベルの実行から読まれる可能性が高い。
 *
 * ## 誤検知を避けるため到達可能性まで見る
 *
 * 「実行文より後ろの `let`」だけで報告すると**誤検知だらけになる**。初版がそれで、
 * 6 件中 5 件が無害だった（実行文の前に置く検証 `if` と、後ろで宣言する状態変数は
 * 普通に共存する）。**誤検知の多い検査は必ず無視されるようになる。**
 *
 * そこで、宣言より前のトップレベル実行から**呼ばれる関数を辿り**（間接呼び出しも）、
 * その中でその変数が読まれている場合だけ報告する。実際の事故もこの形だった:
 * トップレベルのループ → `captureShot()` → `clearCookingSession()` → `sessionGuardUsable`。
 *
 * ## 限界（承知のうえ）
 *
 * 動的 import・eval・コールバック越しの間接呼び出しは見えない。
 * **これは実行の代わりにはならない。** 実行して確かめるのが第一で、これはその前の安い網。
 *
 * 使い方: node scripts/agent/check-script-tdz.mjs [--json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TARGET_DIRS = ['scripts', 'e2e'];
const EXTENSIONS = ['.mjs', '.js'];

/** 行頭がインデント 0 で、実行を伴うもの（宣言・import・関数定義ではないもの）。 */
const EXECUTABLE_AT_TOP =
  /^(?!\s)(?!import\b)(?!export\b)(?!function\b)(?!class\b)(?!const\b)(?!let\b)(?!var\b)(?!\/\/)(?!\/\*)(?!\*)(?!})(?!\))(?!])(?!;)\S/;
/** インデント 0 の `let` / `var` 宣言。`const` は対象外（上のコメント参照）。 */
const MUTABLE_DECL = /^(let|var)\s+([A-Za-z_$][\w$]*)/;

function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else if (EXTENSIONS.some((ext) => name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** 文字列・テンプレート・行コメントを潰してから括弧を数えるための下ごしらえ。 */
function stripLiterals(raw) {
  return raw
    .replace(/\\./g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*$/, '');
}

/**
 * トップレベルの**文**を、ブロック本体ごと 1 件として返す。
 *
 * 1 行だけ見ると `for (const shot of shots) {` のようなブロックの**中身**を取り逃がす。
 * 実際の事故もその形（ループ本体の `captureShot()` が変数へ至る経路）だったので、
 * 文の全体（開き括弧から対応する閉じ括弧まで）を 1 つのテキストとして扱う。
 */
function topLevelStatements(source) {
  const lines = source.split('\n');
  const result = [];
  let depth = 0;
  let inBlockComment = false;
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (inBlockComment) {
      if (raw.includes('*/')) inBlockComment = false;
      continue;
    }
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('/*')) {
      if (!raw.includes('*/')) inBlockComment = true;
      continue;
    }

    if (depth === 0 && current === null && trimmed !== '' && !trimmed.startsWith('//')) {
      current = { lineNo: i + 1, text: raw };
    } else if (current !== null) {
      current.text += `\n${raw}`;
    }

    for (const ch of stripLiterals(raw)) {
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    }
    if (depth < 0) depth = 0;

    if (depth === 0 && current !== null) {
      result.push(current);
      current = null;
    }
  }
  if (current !== null) result.push(current);
  return result;
}

/** `function name(...) { ... }` の本体を切り出す（波括弧の対応で数える）。 */
function extractFunctions(source) {
  const map = new Map();
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    const openIdx = source.indexOf('{', re.lastIndex);
    if (openIdx === -1) continue;
    let depth = 0;
    let end = openIdx;
    for (let i = openIdx; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    map.set(m[1], source.slice(openIdx, end + 1));
  }
  return map;
}

/** `text` から呼び出されている既知の関数名を拾う（`foo(` の形）。 */
function calledNames(text, known) {
  const names = new Set();
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (known.has(m[1])) names.add(m[1]);
  }
  return names;
}

/** `startText` から辿れる関数の本体で `varName` が参照されるか（間接呼び出しも辿る）。 */
function reachesVariable(startText, functions, varName) {
  const ref = new RegExp(`\\b${varName}\\b`);
  if (ref.test(startText)) return true;
  const seen = new Set();
  const queue = [...calledNames(startText, functions)];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const body = functions.get(name);
    if (!body) continue;
    if (ref.test(body)) return true;
    for (const next of calledNames(body, functions)) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return false;
}

function checkFile(file) {
  const source = readFileSync(file, 'utf8');
  const top = topLevelStatements(source);
  const functions = extractFunctions(source);

  let firstExecutable = null;
  const candidates = [];
  const execBefore = [];

  for (const { lineNo, text } of top) {
    const decl = MUTABLE_DECL.exec(text);
    if (decl) {
      if (firstExecutable !== null) {
        candidates.push({ lineNo, name: decl[2], keyword: decl[1] });
      }
      continue;
    }
    if (EXECUTABLE_AT_TOP.test(text)) {
      if (firstExecutable === null) firstExecutable = { lineNo, text: text.trim() };
      execBefore.push({ lineNo, text });
    }
  }

  if (firstExecutable === null || candidates.length === 0) return null;

  // 宣言より前のトップレベル実行から、その変数へ到達できるものだけ残す
  const lateMutables = candidates.filter((c) =>
    execBefore
      .filter((e) => e.lineNo < c.lineNo)
      .some((e) => reachesVariable(e.text, functions, c.name)),
  );

  if (lateMutables.length === 0) return null;
  return { file: relative(ROOT, file).replace(/\\/g, '/'), firstExecutable, lateMutables };
}

const files = TARGET_DIRS.flatMap((dir) => listFiles(join(ROOT, dir)));
const findings = files.map(checkFile).filter(Boolean);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(findings, null, 2));
} else if (findings.length === 0) {
  console.log(`[OK] module スコープ TDZ の疑いなし（${files.length} ファイル）`);
} else {
  for (const f of findings) {
    console.error(`\n[NG] ${f.file}`);
    console.error(
      `  トップレベルの実行が ${f.firstExecutable.lineNo} 行目で始まる: ${f.firstExecutable.text.slice(0, 70)}`,
    );
    for (const m of f.lateMutables) {
      console.error(
        `  → ${m.lineNo} 行目の \`${m.keyword} ${m.name}\` はその後で初期化される。` +
          `実行から読まれると ReferenceError`,
      );
    }
    console.error('  直し方: 宣言を実行文より前へ移す（移して困ることは無い）');
  }
  console.error(`\n${findings.length} ファイルで疑いあり。`);
  process.exit(1);
}

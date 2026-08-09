/**
 * A 階層（意味が崩れると機能が壊れる文言）の候補を洗い出す。
 * 設計は `docs/多言語対応設計.md` §6。
 *
 * なぜ機械抽出が要るか: 701 件を目で追うと**必ず漏れる**。
 * 漏れた A 階層は、英語で意味が崩れても誰も気づけない。
 *
 * 抽出する場所（いずれも「ユーザーの行動を決める／保証する」文言が出る）:
 *   1. 失敗パス      — fail(...) / throw new *Error(...) / Alert.alert(...)
 *   2. 保証・否定文  — 「〜ません」「〜できません」「必ず」など、
 *                      弱まると意味が変わる述語
 *   3. 警告          — VISION_WARNINGS など明示的な注意書き
 *
 * 出力は候補であって確定ではない。**人が見て A/B/C を決める**ための材料。
 *
 * 使い方:
 *   node scripts/agent/extract-critical-strings.mjs            # 一覧
 *   node scripts/agent/extract-critical-strings.mjs --json     # 機械可読
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TARGETS = [join(REPO_ROOT, 'apps', 'mobile'), join(REPO_ROOT, 'apps', 'server')];
const JAPANESE = /[ぁ-んァ-ヶ一-龯]/;
const SKIP_DIRS = new Set([
  'node_modules',
  '__tests__',
  'android',
  'ios',
  'assets',
  '.expo',
  'dist',
]);
const asJson = process.argv.includes('--json');

/**
 * 開発者しか見ない文言は対象外。
 * CLI ツールは翻訳しないし、意味が崩れても被害はこちらに閉じる。
 */
const EXCLUDED_FILES = [
  /scripts\//,
  /\.config\./,
  // AI プロンプト本体（サーバー側）は P3（対象国ごとの書き換え）で別に扱う。
  // ここに混ざると「翻訳すべき UI 文言」と区別がつかなくなる。
  //
  // **モバイルの provider は除外しない。** 同じファイルに BYOK 用のプロンプト写しと
  // visionErrorMessage()（オフライン/枠切れの区別＝最重要の A 階層）が同居しており、
  // ファイル単位で外すと肝心の文言ごと消える
  /apps\/server\/src\/lib\/(vision-recipe|recipe-refine|meal-vision|receipt-vision|name-resolve)\.ts$/,
];

/**
 * 内部エラーは A 階層ではない。
 *
 * 「Base64 データが不正です」が英語で少し変でも、**ユーザーの行動は変わらない**
 * （どちらにせよ復元できず、問い合わせるしかない）。A 階層の基準は
 * 「意味が崩れるとユーザーが**違う行動を取る**、または**保証が嘘になる**」こと。
 *
 * 一方で入力検証（「40文字以内」など）は B 階層。数値が崩れれば実害が出るが、
 * それは翻訳ではなく補間の問題で、§3-4 の「文を1キーにする」で対処する。
 */
const INTERNAL_ERROR_PATTERNS = [
  /が不正です$/,
  /を取得できませんでした$/,
  /が見つかりません(:|$)/,
  /解析できませんでした$/,
  /^Base64/,
];

/**
 * 分類の手がかり。**順序が優先度**（先に当たったものを採る）。
 * reason は「なぜ壊れると困るか」を人が読むためのもの。
 */
const SIGNALS = [
  {
    id: 'guarantee',
    label: '保証・免責。弱まると説明が嘘になる',
    // R2 の「変わっていません」、免責の「行いません」など。**否定の保証**が核
    test: (_line, text) =>
      /(変わっていません|行いません|検出しません|保証|responsibility)/.test(text),
  },
  {
    id: 'user-action',
    label: '失敗時にユーザーが取るべき行動が変わる',
    // 「再接続すれば直る」「待つしかない」「書き方を変えれば直る」の区別。
    // ここが崩れると #120 の作業が無に帰す
    test: (_line, text) =>
      /(つながって|接続して|上限に達|時間をおいて|混み合って|もう一度お試し|書いてみて)/.test(text),
  },
  {
    id: 'ai-caveat',
    label: 'AI 生成物の注意書き（安全に関わる）',
    test: (_line, text) => /(AIが|AI が).*(確認|ご注意|推定)/.test(text),
  },
  {
    id: 'destructive',
    label: '取り消せない操作の確認。誤読すると復旧できない',
    // ボタンやメニューの**ラベル**（「削除」「写真を削除」）は B 階層。
    // A 階層なのは**確認を求める文**だけ — 誤読した結果が戻せないもの
    test: (_line, text) =>
      /(しますか|よろしいですか|取り消せません|置き換えます)/.test(text) &&
      /(削除|置き換え|上書き|復元)/.test(text),
  },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      yield* walk(path);
    } else if (/\.tsx?$/.test(name)) {
      yield path;
    }
  }
}

/**
 * 行から日本語を含む「文言」を取り出す。
 *
 * クォート内のリテラルだけでは **JSX のテキストノードを取りこぼす**。
 * R2 の保証文（`<Text>ここに出ていない材料・手順は変わっていません。…</Text>`）が
 * まさにそれで、**最も重要な A 階層が丸ごと漏れていた**。
 * クォートに囲まれていない日本語の並びも拾う。
 */
function literalsIn(line) {
  const quoted = (line.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? []).map((m) =>
    m.slice(1, -1).trim(),
  );
  if (quoted.some((t) => JAPANESE.test(t))) {
    return quoted.filter((t) => t && JAPANESE.test(t));
  }
  // JSX テキストノード: タグ・波かっこを除いた残りに日本語が続いていれば文言とみなす
  const stripped = line
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .trim();
  return JAPANESE.test(stripped) && stripped.length >= 6 ? [stripped] : [];
}

const found = [];

for (const root of TARGETS) {
  for (const file of walk(root)) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
    if (EXCLUDED_FILES.some((re) => re.test(rel))) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    let inBlockComment = false;

    lines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (inBlockComment) {
        if (line.includes('*/')) inBlockComment = false;
        return;
      }
      if (line.startsWith('/*')) {
        if (!line.includes('*/')) inBlockComment = true;
        return;
      }
      if (line.startsWith('//') || line.startsWith('*')) return;

      const code = line.replace(/\/\/.*$/, '');
      for (const text of literalsIn(code)) {
        if (INTERNAL_ERROR_PATTERNS.some((re) => re.test(text))) continue;
        // 複数行にまたがる文言は前後を見ないと拾えないが、
        // 候補出しには十分（人が確認する前提）
        const signal = SIGNALS.find((s) => s.test(code, text));
        if (!signal) continue;
        found.push({
          file: rel,
          line: index + 1,
          signal: signal.id,
          why: signal.label,
          text,
        });
      }
    });
  }
}

// 同一文言の重複を畳む（同じ文が複数箇所にあることを可視化する）
const byText = new Map();
for (const item of found) {
  const key = item.text;
  if (!byText.has(key)) byText.set(key, { ...item, places: [] });
  byText.get(key).places.push(`${item.file}:${item.line}`);
}
const unique = [...byText.values()];

if (asJson) {
  process.stdout.write(`${JSON.stringify(unique, null, 2)}\n`);
} else {
  const bySignal = new Map();
  for (const item of unique) {
    if (!bySignal.has(item.signal)) bySignal.set(item.signal, []);
    bySignal.get(item.signal).push(item);
  }
  console.log(`A 階層の候補: ${unique.length} 件（重複を畳んだ数）\n`);
  for (const signal of SIGNALS) {
    const items = bySignal.get(signal.id) ?? [];
    if (items.length === 0) continue;
    console.log(`\n■ ${signal.id} — ${signal.label}（${items.length} 件）`);
    for (const item of items) {
      console.log(`  ${item.text}`);
      console.log(
        `      ${item.places.slice(0, 2).join(' , ')}${item.places.length > 2 ? ` ほか${item.places.length - 2}件` : ''}`,
      );
    }
  }
}

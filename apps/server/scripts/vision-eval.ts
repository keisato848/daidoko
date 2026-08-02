/**
 * レシピ推論の評価ハーネス（R0 / Issue #118）。
 * 設計: `docs/レシピ推論の評価設計.md`
 *
 * 評価セットを順に推論し、**採点欄が空の Markdown 表**を書き出す。人がその表を埋め、
 * `--summarize` で集計して合格ラインと突き合わせる。
 *
 * 本番の HTTP ルートは通さず、provider を直接呼ぶ。よって
 * サーバーの INFER_GLOBAL_DAILY_LIMIT は消費しない（課金は同じ API キーに乗る）。
 *
 * 使い方:
 *   tsx scripts/vision-eval.ts run --set <dir> --variant v1 [--model ...] [--with name|cross|menu]
 *   tsx scripts/vision-eval.ts summarize --file <生成された md>
 *
 * 評価セット: <dir>/manifest.json ＋ 画像。**リポジトリにコミットしないこと**（個人の外食履歴）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  GeminiVisionRecipeProvider,
  type PromptVariant,
  type VisionRecipeImage,
  type VisionRecipeRaw,
} from '../src/lib/vision-recipe.js';

// ─── 評価セットの形 ──────────────────────────────────────────────────────────

interface EvalCase {
  id: string;
  /** 全体写真（必須） */
  photo: string;
  /** 断面・取り分け後（任意。3枚セットで撮った10件のみ） */
  crossSection?: string;
  /** メニュー（任意） */
  menu?: string;
  /** 正解の料理名。陰性ケースでは空でよい */
  expectedDish?: string;
  genre?: string;
  /** 撮影条件のメモ（例: 暗い店内・寄り） */
  condition?: string;
  kind: 'eaten_out' | 'home' | 'negative';
  /** 陰性ケース: 拒否されるべきなら true */
  expectReject?: boolean;
}

interface EvalManifest {
  cases: EvalCase[];
}

/** 追加入力の種類。名前はテキスト、cross/menu は画像。 */
type WithOption = 'name' | 'cross' | 'menu';

const SCORE_AXES = ['A', 'B', 'C', 'D'] as const;

// ─── 引数 ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, 'true');
    }
  }
  return args;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function mimeTypeFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function readImage(dir: string, fileName: string): VisionRecipeImage {
  const full = path.join(dir, fileName);
  if (!existsSync(full)) fail(`画像が見つかりません: ${full}`);
  return { imageBase64: readFileSync(full).toString('base64'), mimeType: mimeTypeFor(full) };
}

// ─── 実行 ────────────────────────────────────────────────────────────────────

interface RunOutcome {
  id: string;
  expectedDish: string;
  kind: EvalCase['kind'];
  condition: string;
  /** 推論に成功したか（例外なくレスポンスを得たか） */
  ok: boolean;
  raw?: VisionRecipeRaw;
  error?: string;
  elapsedMs: number;
}

function buildContext(evalCase: EvalCase, withOptions: Set<WithOption>): string | undefined {
  if (!withOptions.has('name')) return undefined;
  return evalCase.expectedDish?.trim() || undefined;
}

function buildExtraImages(
  evalCase: EvalCase,
  dir: string,
  withOptions: Set<WithOption>,
): VisionRecipeImage[] {
  const extras: VisionRecipeImage[] = [];
  if (withOptions.has('cross') && evalCase.crossSection) {
    extras.push(readImage(dir, evalCase.crossSection));
  }
  if (withOptions.has('menu') && evalCase.menu) {
    extras.push(readImage(dir, evalCase.menu));
  }
  return extras;
}

/** その変種で回せるケースだけを残す（断面がない件で --with cross を指定しても飛ばす）。 */
function isRunnable(evalCase: EvalCase, withOptions: Set<WithOption>): boolean {
  if (withOptions.has('cross') && !evalCase.crossSection) return false;
  if (withOptions.has('menu') && !evalCase.menu) return false;
  return true;
}

async function runEval(args: Map<string, string>): Promise<void> {
  const setDir = args.get('set') ?? fail('--set <評価セットのディレクトリ> が必要です');
  const variant = (args.get('variant') ?? 'v1') as PromptVariant;
  if (variant !== 'v0' && variant !== 'v1') fail('--variant は v0 か v1 を指定してください');

  const model = args.get('model');
  const withOptions = new Set<WithOption>(
    (args.get('with') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is WithOption =>
        ['name', 'cross', 'menu'].includes(value as WithOption),
      ),
  );

  const manifestPath = path.join(setDir, 'manifest.json');
  if (!existsSync(manifestPath)) fail(`manifest.json が見つかりません: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as EvalManifest;

  const cases = manifest.cases.filter((evalCase) => isRunnable(evalCase, withOptions));
  const skipped = manifest.cases.length - cases.length;

  const provider = new GeminiVisionRecipeProvider({
    variant,
    ...(model ? { model } : {}),
  });

  const label = [variant, model ?? 'default', ...[...withOptions].sort()].join('-');
  process.stdout.write(
    `評価開始: ${cases.length} 件（スキップ ${skipped} 件）/ 変種 ${label}\n` +
      `追加入力: ${withOptions.size > 0 ? [...withOptions].join(', ') : 'なし（全体1枚のみ）'}\n\n`,
  );

  const outcomes: RunOutcome[] = [];
  for (const [index, evalCase] of cases.entries()) {
    const main = readImage(setDir, evalCase.photo);
    const extraImages = buildExtraImages(evalCase, setDir, withOptions);
    const context = buildContext(evalCase, withOptions);
    const startedAt = Date.now();

    try {
      const raw = await provider.infer({
        imageBase64: main.imageBase64,
        mimeType: main.mimeType,
        ...(context ? { context } : {}),
        ...(extraImages.length > 0 ? { extraImages } : {}),
      });
      outcomes.push({
        id: evalCase.id,
        expectedDish: evalCase.expectedDish ?? '',
        kind: evalCase.kind,
        condition: evalCase.condition ?? '',
        ok: true,
        raw,
        elapsedMs: Date.now() - startedAt,
      });
      process.stdout.write(
        `[${index + 1}/${cases.length}] ${evalCase.id}: ` +
          `${raw.isDish ? (raw.title ?? '(タイトルなし)') : `拒否(${raw.rejectReason ?? '理由なし'})`}\n`,
      );
    } catch (err) {
      outcomes.push({
        id: evalCase.id,
        expectedDish: evalCase.expectedDish ?? '',
        kind: evalCase.kind,
        condition: evalCase.condition ?? '',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt,
      });
      process.stdout.write(`[${index + 1}/${cases.length}] ${evalCase.id}: 失敗\n`);
    }
  }

  const outDir = args.get('out') ?? path.join(setDir, 'results');
  mkdirSync(outDir, { recursive: true });
  const stamp = args.get('stamp') ?? 'latest';
  const base = `${stamp}-${label}`;

  writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(outcomes, null, 2), 'utf8');
  const markdownPath = path.join(outDir, `${base}.md`);
  writeFileSync(markdownPath, renderMarkdown(label, model, outcomes), 'utf8');

  process.stdout.write(
    `\n採点シート: ${markdownPath}\n生の出力: ${path.join(outDir, `${base}.json`)}\n`,
  );
}

// ─── 採点シート ──────────────────────────────────────────────────────────────

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMarkdown(label: string, model: string | undefined, outcomes: RunOutcome[]): string {
  const lines: string[] = [];
  lines.push(`# 採点シート: ${label}`);
  lines.push('');
  lines.push(`- モデル: ${model ?? '既定（gemini-2.5-flash）'}`);
  lines.push(`- 件数: ${outcomes.length}`);
  lines.push('');
  lines.push('採点は 0〜2。基準は `docs/レシピ推論の評価設計.md` §2。**A〜D の列を埋めてから**');
  lines.push('`tsx scripts/vision-eval.ts summarize --file <このファイル>` で集計する。');
  lines.push('');
  lines.push('- A: 料理の特定 / B: 材料 / C: 家庭で作れるか / D: 手順');
  lines.push('- 陰性ケース（kind=negative）は A〜D を空のままにし、`拒否` 列だけ見る');
  lines.push('');
  lines.push(
    '| id | 種別 | 撮影条件 | 期待する料理 | 出力タイトル | 拒否 | conf | ヒント | A | B | C | D |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const outcome of outcomes) {
    const raw = outcome.raw;
    const rejected = raw && !raw.isDish;
    const title = !outcome.ok
      ? `⚠ ${outcome.error ?? 'エラー'}`
      : rejected
        ? '—'
        : (raw?.title ?? '(タイトルなし)');
    const reject = rejected ? (raw?.rejectReason ?? 'true') : '';
    const hints = raw?.improvementHints?.join(' / ') ?? '';
    lines.push(
      `| ${outcome.id} | ${outcome.kind} | ${escapeCell(outcome.condition)} | ` +
        `${escapeCell(outcome.expectedDish)} | ${escapeCell(title)} | ${reject} | ` +
        `${raw?.confidence ?? ''} | ${escapeCell(hints)} |  |  |  |  |`,
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

// ─── 集計 ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  id: string;
  kind: string;
  rejected: boolean;
  confidence: string;
  scores: Partial<Record<(typeof SCORE_AXES)[number], number>>;
}

function parseMarkdown(markdown: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 12) continue;
    const [id, kind, , , , reject, confidence, , a, b, c, d] = cells;
    if (!id || id === 'id' || id.startsWith('---')) continue;

    const scores: ParsedRow['scores'] = {};
    for (const [axis, value] of [
      ['A', a],
      ['B', b],
      ['C', c],
      ['D', d],
    ] as const) {
      const parsed = Number(value);
      if (value !== '' && Number.isFinite(parsed)) {
        scores[axis as (typeof SCORE_AXES)[number]] = parsed;
      }
    }
    rows.push({
      id,
      kind: kind ?? '',
      rejected: (reject ?? '') !== '',
      confidence: confidence ?? '',
      scores,
    });
  }
  return rows;
}

/** 合格ライン（`docs/レシピ推論の評価設計.md` §3）。測る前に確定させたもの。 */
const THRESHOLDS: Record<(typeof SCORE_AXES)[number], number> = { A: 1.6, B: 1.4, C: 1.8, D: 1.5 };
const MAX_A_ZERO_RATE = 0.1;
const MIN_HIGH_CONF_ACCURACY = 0.85;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatVerdict(actual: number | null, threshold: number): string {
  if (actual === null) return '未採点';
  return actual >= threshold ? `✅ ${actual.toFixed(2)}` : `❌ ${actual.toFixed(2)}`;
}

function summarize(args: Map<string, string>): void {
  const file = args.get('file') ?? fail('--file <採点済みの md> が必要です');
  if (!existsSync(file)) fail(`ファイルが見つかりません: ${file}`);
  const rows = parseMarkdown(readFileSync(file, 'utf8'));
  const scored = rows.filter((row) => row.kind !== 'negative');

  process.stdout.write(`\n=== 集計: ${path.basename(file)} ===\n`);
  process.stdout.write(
    `採点対象 ${scored.length} 件 / 陰性ケース ${rows.length - scored.length} 件\n\n`,
  );

  for (const axis of SCORE_AXES) {
    const values = scored
      .map((row) => row.scores[axis])
      .filter((value): value is number => value !== undefined);
    process.stdout.write(
      `${axis}: ${formatVerdict(average(values), THRESHOLDS[axis])} ` +
        `(ライン ${THRESHOLDS[axis]} / 採点済み ${values.length}件)\n`,
    );
  }

  // A の 0 点率
  const aScores = scored
    .map((row) => row.scores.A)
    .filter((value): value is number => value !== undefined);
  if (aScores.length > 0) {
    const zeroRate = aScores.filter((value) => value === 0).length / aScores.length;
    const ok = zeroRate <= MAX_A_ZERO_RATE;
    process.stdout.write(
      `A の0点率: ${ok ? '✅' : '❌'} ${(zeroRate * 100).toFixed(1)}% (ライン ${MAX_A_ZERO_RATE * 100}% 以下)\n`,
    );
  }

  // confidence=high の校正
  const highRows = scored.filter((row) => row.confidence === 'high' && row.scores.A !== undefined);
  if (highRows.length > 0) {
    const accuracy = highRows.filter((row) => row.scores.A === 2).length / highRows.length;
    const ok = accuracy >= MIN_HIGH_CONF_ACCURACY;
    process.stdout.write(
      `confidence=high の A 正答率: ${ok ? '✅' : '❌'} ${(accuracy * 100).toFixed(1)}% ` +
        `(ライン ${MIN_HIGH_CONF_ACCURACY * 100}% / ${highRows.length}件)\n`,
    );
  }

  // 陰性ケース: 拒否できているか
  const negatives = rows.filter((row) => row.kind === 'negative');
  if (negatives.length > 0) {
    const rejected = negatives.filter((row) => row.rejected).length;
    process.stdout.write(
      `\n陰性ケース: ${rejected}/${negatives.length} 件を拒否` +
        `${rejected === negatives.length ? ' ✅' : ' ❌'}\n`,
    );
  }

  // 正当な写真を誤って弾いていないか（本命）
  const falseRejects = scored.filter((row) => row.rejected);
  if (falseRejects.length > 0) {
    process.stdout.write(
      `\n⚠ 正当な写真を拒否: ${falseRejects.length} 件 (${falseRejects.map((row) => row.id).join(', ')})\n`,
    );
  }
  process.stdout.write('\n');
}

// ─── エントリポイント ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (command === 'run') {
    await runEval(args);
    return;
  }
  if (command === 'summarize') {
    summarize(args);
    return;
  }
  fail(
    'Usage:\n' +
      '  tsx scripts/vision-eval.ts run --set <dir> --variant v0|v1 [--model <id>] [--with name,cross,menu]\n' +
      '  tsx scripts/vision-eval.ts summarize --file <採点済みの md>',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});

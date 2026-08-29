/**
 * 献立 M2（AI 並べ替え）の評価ハーネス。docs/買い物リスト・在庫設計.md §10.10.5。
 *
 * `apps/server/scripts/vision-eval.ts` の骨組み（tsx 実行・provider 直呼び・
 * run → 採点シート md + 生 JSON・summarize → ✅/❌）を踏襲する。ただし採点の中核は
 * 機械採点エンジン（ベースライン比較・隣接重複計算・正規表現ゲート・sanitize 適用率）
 * — vision の「人が0〜2点を埋める」表とは形が違う。G 軸（why の質）だけは人手のまま
 * 残し、run1 の why 全文と照合用の入力事実（候補・在庫・直近 title）を md に併記する。
 *
 * 使い方:
 *   tsx scripts/menu-eval.ts run [--set menu-eval-cases.json] [--runs 2] [--case <id>]
 *                                 [--model ...] [--thinking <n>] [--delay <ms>] [--jpy <rate>]
 *   tsx scripts/menu-eval.ts summarize --file <run が書き出した md>
 *
 * 実 API を呼ぶ。鍵は apps/server/.env の GEMINI_API_KEY（dotenv 非依存。このスクリプトが
 * 自前で読む。無ければ既存の process.env を使う——CI 等で環境変数が直接渡る経路を塞がない）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BANNED_WHY_PATTERNS,
  GeminiMenuArrangeProvider,
  MAX_MENU_CANDIDATES,
  sanitizeMenuDays,
  type MenuArrangeRaw,
  type MenuCandidate,
  type MenuDayPick,
} from '../src/lib/menu-arrange.js';
import type { OutputLocale } from '../src/lib/output-locale.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── .env 読み込み（dotenv 非依存） ───────────────────────────────────────────
// このパッケージに dotenv は入っていない。vision-eval.ts の前例に従い
// apps/server/.env の GEMINI_API_KEY を使うため、無ければここで自前で読む。
function loadDotEnvIfMissing(): void {
  if (process.env['GEMINI_API_KEY']) return;
  const envPath = path.join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnvIfMissing();

// ─── 料金表（vision-eval.ts と同じ。差分が出たらどちらも直す） ───────────────
const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
};
const DEFAULT_JPY_PER_USD = 155;

// ─── 評価セットの形 ──────────────────────────────────────────────────────────

interface CaseLabel {
  mainCategory: string;
  genre: string;
}

interface CaseCandidate extends MenuCandidate {
  label: CaseLabel;
}

interface EvalCase {
  id: string;
  note?: string;
  days: number;
  outputLocale: OutputLocale;
  pantry: string[];
  recentTitles: string[];
  candidates: CaseCandidate[];
}

interface CasesFile {
  cases: EvalCase[];
}

/** provider に渡す前に label を剥がす。剥がし忘れは試験の意味を壊す。 */
function stripLabel(candidate: CaseCandidate): MenuCandidate {
  return {
    id: candidate.id,
    title: candidate.title,
    coveragePct: candidate.coveragePct,
    missing: candidate.missing,
    ...(candidate.cookTimeMin !== undefined ? { cookTimeMin: candidate.cookTimeMin } : {}),
  };
}

// ─── why 禁止パターン（§10.10.5・ja/en 両方） ────────────────────────────────
// 正典は `lib/menu-arrange.ts` の BANNED_WHY_PATTERNS（sanitizeMenuDays が実際に
// これでストリップする）。ここでは import して二重定義しない。ラウンド 2 からは
// 生成直後（ストリップ前・scanBannedPatternsRaw）と、sanitizeMenuDays を通した後
// （表示値・scanBannedPatternsDisplayed）の両方を測る——ストリップが効くと表示値は
// 常に 0 件になり、プロンプト改良の効果は生値でしか見えないため。

const JAPANESE_CHAR_REGEX = /[぀-ヿ一-鿿]/;

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ─── 機械採点: 補助関数 ──────────────────────────────────────────────────────

/** 隣接する要素が同じ値の回数（散らばり無しの度合い）。 */
function adjacentDupCount(values: string[]): number {
  let count = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === values[i - 1]) count += 1;
  }
  return count;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

interface BannedHit {
  day: number;
  field: 'why' | 'note';
  pattern: string;
  text: string;
}

/**
 * 生成直後（`sanitizeMenuDays` を通す前）の why をスキャンする。§10.10.5 の
 * 「why 禁止パターン」軸（合否判定）はこの生値で測る——モデルが実際に
 * プロンプトを守ったかどうかを見るため。sanitize 前なので day/recipeId の
 * 妥当性は問わず、文字列として存在する why は全部見る。
 */
function scanBannedPatternsRaw(
  rawDays: MenuArrangeRaw['days'],
  note: string | undefined,
): BannedHit[] {
  const hits: BannedHit[] = [];
  for (const item of rawDays ?? []) {
    const why = typeof item?.why === 'string' ? item.why : undefined;
    if (!why) continue;
    const day = typeof item?.day === 'number' ? item.day : -1;
    for (const { name, regex } of BANNED_WHY_PATTERNS) {
      if (regex.test(why)) hits.push({ day, field: 'why', pattern: name, text: why });
    }
  }
  if (note) {
    for (const { name, regex } of BANNED_WHY_PATTERNS) {
      if (regex.test(note)) hits.push({ day: 0, field: 'note', pattern: name, text: note });
    }
  }
  return hits;
}

/**
 * `sanitizeMenuDays` を通した後（＝実際に画面へ出る値）をスキャンする。why は
 * `BANNED_WHY_PATTERNS` に掛かれば sanitize 側で既に undefined に落ちているはずなので、
 * ここで拾えるのは note（sanitize の対象外）だけになる想定——0 件でなければ
 * 防御が効いていない証拠。
 */
function scanBannedPatternsDisplayed(picks: MenuDayPick[], note: string | undefined): BannedHit[] {
  const hits: BannedHit[] = [];
  for (const pick of picks) {
    if (!pick.why) continue;
    for (const { name, regex } of BANNED_WHY_PATTERNS) {
      if (regex.test(pick.why))
        hits.push({ day: pick.day, field: 'why', pattern: name, text: pick.why });
    }
  }
  if (note) {
    for (const { name, regex } of BANNED_WHY_PATTERNS) {
      if (regex.test(note)) hits.push({ day: 0, field: 'note', pattern: name, text: note });
    }
  }
  return hits;
}

// ─── 実行結果の形 ────────────────────────────────────────────────────────────

interface RunOutcome {
  caseId: string;
  run: number;
  ok: boolean;
  error?: string;
  elapsedMs: number;
  model: string;
  outputLocale: OutputLocale;
  days: number;
  candidateCount: number;
  /** モデル生出力の行数（sanitize 前）。null は失敗時。 */
  rawDaysCount: number | null;
  picks: MenuDayPick[];
  note?: string;
  /** rawDaysCount - picks.length。sanitize で捨てられた行数（契約違反の代理指標）。 */
  contractViolationCount: number;
  /** 主菜（mainCategory）の隣接重複数。M1 先頭 X 件 vs AI の選び直し。 */
  dupMainBaseline: number;
  dupMainAi: number;
  /** ジャンル（genre）の隣接重複数。 */
  dupGenreBaseline: number;
  dupGenreAi: number;
  /** カバー率（coveragePct）の平均。AI の実選択数 N に揃えて比較する。 */
  coverageBaselineAvg: number | null;
  coverageAiAvg: number | null;
  coverageDiff: number | null;
  /** 生成直後（ストリップ前）のヒット。§10.10.5 の合否判定はこちらを使う。 */
  bannedHitsRaw: BannedHit[];
  /** sanitizeMenuDays を通した後（＝画面表示値）のヒット。参考値・常に 0 件が期待値。 */
  bannedHitsDisplayed: BannedHit[];
  whyOverLengthCount: number;
  whyTotalCount: number;
  /** en ケースのみ意味を持つ。ja では常に 0（測っていない）。 */
  jaCharsInEnCount: number;
  costJpy: number | null;
}

function costJpy(
  usage: { promptTokens?: number; outputTokens?: number; thoughtsTokens?: number } | undefined,
  model: string,
  jpyPerUsd: number,
): number | null {
  if (!usage) return null;
  const price = PRICING_USD_PER_MTOK[model];
  if (!price) return null;
  const outputTokens = (usage.outputTokens ?? 0) + (usage.thoughtsTokens ?? 0);
  const usd =
    ((usage.promptTokens ?? 0) / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output;
  return usd * jpyPerUsd;
}

/** 実行1件を採点する。provider 呼び出し自体はこの関数の外。 */
function scoreExecution(
  evalCase: EvalCase,
  run: number,
  model: string,
  raw: MenuArrangeRaw | undefined,
  error: string | undefined,
  elapsedMs: number,
  jpyPerUsd: number,
): RunOutcome {
  const labelById = new Map(evalCase.candidates.map((c) => [c.id, c.label]));
  const coverageById = new Map(evalCase.candidates.map((c) => [c.id, c.coveragePct]));
  const candidateIds = new Set(evalCase.candidates.map((c) => c.id));
  const dayCount = evalCase.days;

  if (!raw) {
    return {
      caseId: evalCase.id,
      run,
      ok: false,
      error: error ?? 'unknown error',
      elapsedMs,
      model,
      outputLocale: evalCase.outputLocale,
      days: dayCount,
      candidateCount: evalCase.candidates.length,
      rawDaysCount: null,
      picks: [],
      contractViolationCount: 0,
      dupMainBaseline: 0,
      dupMainAi: 0,
      dupGenreBaseline: 0,
      dupGenreAi: 0,
      coverageBaselineAvg: null,
      coverageAiAvg: null,
      coverageDiff: null,
      bannedHitsRaw: [],
      bannedHitsDisplayed: [],
      whyOverLengthCount: 0,
      whyTotalCount: 0,
      jaCharsInEnCount: 0,
      costJpy: null,
    };
  }

  const picks = sanitizeMenuDays(raw.days, candidateIds, dayCount);
  const rawDaysCount = Array.isArray(raw.days) ? raw.days.length : 0;
  const contractViolationCount = Math.max(0, rawDaysCount - picks.length);

  // ベースライン = 候補の先頭 N 件（M1 スコア順）。N は AI が実際に選んだ件数に揃える
  // ——「埋めない」契約を守った実行を、埋まらなかったこと自体で不利に採点しないため。
  const n = picks.length;
  const baselineSlice = evalCase.candidates.slice(0, n);
  const baselineMain = baselineSlice.map((c) => c.label.mainCategory);
  const baselineGenre = baselineSlice.map((c) => c.label.genre);
  const aiMain = picks.map((p) => labelById.get(p.recipeId)?.mainCategory ?? '(unknown)');
  const aiGenre = picks.map((p) => labelById.get(p.recipeId)?.genre ?? '(unknown)');

  const baselineCoverages = baselineSlice.map((c) => c.coveragePct);
  const aiCoverages = picks.map((p) => coverageById.get(p.recipeId) ?? 0);
  const coverageBaselineAvg = average(baselineCoverages);
  const coverageAiAvg = average(aiCoverages);
  const coverageDiff =
    coverageBaselineAvg !== null && coverageAiAvg !== null
      ? coverageAiAvg - coverageBaselineAvg
      : null;

  const bannedHitsRaw = scanBannedPatternsRaw(raw.days, raw.note);
  const bannedHitsDisplayed = scanBannedPatternsDisplayed(picks, raw.note);

  const whyLengthLimit = evalCase.outputLocale === 'en' ? 120 : 60;
  const whyValues = picks.map((p) => p.why).filter((w): w is string => typeof w === 'string');
  const whyOverLengthCount = whyValues.filter((w) => w.length > whyLengthLimit).length;

  let jaCharsInEnCount = 0;
  if (evalCase.outputLocale === 'en') {
    for (const w of whyValues) {
      if (JAPANESE_CHAR_REGEX.test(w)) jaCharsInEnCount += 1;
    }
    if (raw.note && JAPANESE_CHAR_REGEX.test(raw.note)) jaCharsInEnCount += 1;
  }

  return {
    caseId: evalCase.id,
    run,
    ok: true,
    elapsedMs,
    model,
    outputLocale: evalCase.outputLocale,
    days: dayCount,
    candidateCount: evalCase.candidates.length,
    rawDaysCount,
    picks,
    ...(raw.note ? { note: raw.note } : {}),
    contractViolationCount,
    dupMainBaseline: adjacentDupCount(baselineMain),
    dupMainAi: adjacentDupCount(aiMain),
    dupGenreBaseline: adjacentDupCount(baselineGenre),
    dupGenreAi: adjacentDupCount(aiGenre),
    coverageBaselineAvg,
    coverageAiAvg,
    coverageDiff,
    bannedHitsRaw,
    bannedHitsDisplayed,
    whyOverLengthCount,
    whyTotalCount: whyValues.length,
    jaCharsInEnCount,
    costJpy: costJpy(raw.usage, model, jpyPerUsd),
  };
}

// ─── 実行 ────────────────────────────────────────────────────────────────────

const DEFAULT_DELAY_MS = 4_000;
const E_INDUCING = new Set(['chicken-top', 'baseline-7']);
const F_INDUCING = new Set(['chinese-top', 'near-dup-titles', 'baseline-7']);

async function runEval(args: Map<string, string>): Promise<void> {
  const setPath = args.get('set') ?? path.join(__dirname, 'menu-eval-cases.json');
  if (!existsSync(setPath)) fail(`評価セットが見つかりません: ${setPath}`);
  const file = JSON.parse(readFileSync(setPath, 'utf8')) as CasesFile;

  const onlyCaseId = args.get('case');
  const cases = onlyCaseId ? file.cases.filter((c) => c.id === onlyCaseId) : file.cases;
  if (cases.length === 0) fail(`ケースが見つかりません（--case ${onlyCaseId ?? ''}）`);

  const model = args.get('model')?.trim() || 'gemini-2.5-flash';
  const thinkingRaw = args.get('thinking');
  if (thinkingRaw !== undefined) process.env['GEMINI_THINKING_BUDGET'] = thinkingRaw;
  const jpyPerUsd = Number(args.get('jpy') ?? DEFAULT_JPY_PER_USD);
  const delayMs = Number(args.get('delay') ?? DEFAULT_DELAY_MS);
  const runs = Number(args.get('runs') ?? 2);

  for (const c of cases) {
    if (c.candidates.length > MAX_MENU_CANDIDATES) {
      fail(`${c.id}: 候補数が MAX_MENU_CANDIDATES(${MAX_MENU_CANDIDATES}) を超えています`);
    }
  }

  const provider = new GeminiMenuArrangeProvider({ model });

  const outDir =
    args.get('out') ?? path.join(__dirname, '..', '..', '..', 'docs', 'eval', 'menu-rank');
  mkdirSync(outDir, { recursive: true });
  const stamp = args.get('stamp') ?? new Date().toISOString().slice(0, 10);
  const base = `${stamp}-${model}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const markdownPath = path.join(outDir, `${base}.md`);

  process.stdout.write(
    `評価開始: ${cases.length} ケース × ${runs} 回 = ${cases.length * runs} 呼び出し / モデル ${model}\n` +
      `思考予算: ${process.env['GEMINI_THINKING_BUDGET'] ?? '既定(0=オフ)'}\n` +
      `ケース間の待機: ${delayMs}ms\n\n`,
  );

  const outcomes: RunOutcome[] = [];
  let callIndex = 0;
  const totalCalls = cases.length * runs;

  for (const evalCase of cases) {
    for (let run = 1; run <= runs; run += 1) {
      if (callIndex > 0) await sleep(delayMs);
      callIndex += 1;

      const candidatesForProvider = evalCase.candidates.map(stripLabel);
      const startedAt = Date.now();
      let raw: MenuArrangeRaw | undefined;
      let error: string | undefined;
      try {
        raw = await provider.arrange({
          candidates: candidatesForProvider,
          pantry: evalCase.pantry,
          recentTitles: evalCase.recentTitles,
          days: evalCase.days,
          outputLocale: evalCase.outputLocale,
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      const elapsedMs = Date.now() - startedAt;
      const outcome = scoreExecution(evalCase, run, model, raw, error, elapsedMs, jpyPerUsd);
      outcomes.push(outcome);

      process.stdout.write(
        `[${callIndex}/${totalCalls}] ${evalCase.id} run${run}: ` +
          `${outcome.ok ? `${outcome.picks.length}日 選択・違反${outcome.contractViolationCount}件` : `失敗(${outcome.error})`}` +
          `${outcome.costJpy !== null ? ` (¥${outcome.costJpy.toFixed(2)})` : ''}\n`,
      );
    }
  }

  writeFileSync(jsonPath, JSON.stringify(outcomes, null, 2), 'utf8');
  writeFileSync(markdownPath, renderMarkdown(model, outcomes, cases), 'utf8');

  const costs = outcomes.map((o) => o.costJpy).filter((v): v is number => typeof v === 'number');
  if (costs.length > 0) {
    const total = costs.reduce((s, v) => s + v, 0);
    process.stdout.write(
      `\nコスト: 合計 ¥${total.toFixed(1)} / 1件あたり ¥${(total / costs.length).toFixed(2)}` +
        `（${costs.length}件・${model}・$1=¥${jpyPerUsd}）\n`,
    );
  }

  process.stdout.write(`\n採点シート: ${markdownPath}\n生の出力: ${jsonPath}\n`);
  process.stdout.write(`\ntsx scripts/menu-eval.ts summarize --file ${markdownPath}\n`);
}

// ─── 採点シート（md） ────────────────────────────────────────────────────────

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMarkdown(model: string, outcomes: RunOutcome[], cases: EvalCase[]): string {
  const lines: string[] = [];
  lines.push('# menu-eval 採点シート');
  lines.push('');
  lines.push(`- モデル: ${model}`);
  lines.push(
    `- 実行数: ${outcomes.length}（${cases.length} ケース × ${outcomes.length / cases.length} 回）`,
  );
  lines.push(
    '- 合格ラインは `docs/買い物リスト・在庫設計.md` §10.10.5。' +
      'このシートの数値表は機械採点済み。**G 列（why の質）だけを 0〜2 で埋めてから**' +
      ' `tsx scripts/menu-eval.ts summarize --file <このファイル>` で集計する。',
  );
  lines.push('');

  lines.push('## 機械採点（自動計算済み・数値表）');
  lines.push('');
  lines.push(
    '禁止語(生) = sanitizeMenuDays を通す前（モデルの生成そのもの）のヒット数。' +
      '§10.10.5「why 禁止パターン」の合否判定はこちらを使う。' +
      '禁止語(表示) = sanitizeMenuDays を通した後（＝実際に画面へ出る値）のヒット数。' +
      '**why はストリップされるので常に 0 件になるのが期待値**' +
      '（0 件でなければ防御が効いていない証拠。note はストリップ対象外）。',
  );
  lines.push('');
  lines.push(
    '| case | run | ok | 違反(捨てた行数) | 生行数 | 選択数 | 主菜dup(M1) | 主菜dup(AI) | ' +
      'ジャンルdup(M1) | ジャンルdup(AI) | カバー(M1) | カバー(AI) | カバー差 | ' +
      '禁止語(生) | 禁止語(表示) | why超過/全体 | ja混入(en) | ¥ |',
  );
  lines.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const o of outcomes) {
    lines.push(
      `| ${o.caseId} | ${o.run} | ${o.ok ? '✅' : `⚠ ${escapeCell(o.error ?? '')}`} | ` +
        `${o.contractViolationCount} | ${o.rawDaysCount ?? ''} | ${o.picks.length} | ` +
        `${o.dupMainBaseline} | ${o.dupMainAi} | ${o.dupGenreBaseline} | ${o.dupGenreAi} | ` +
        `${o.coverageBaselineAvg?.toFixed(1) ?? ''} | ${o.coverageAiAvg?.toFixed(1) ?? ''} | ` +
        `${o.coverageDiff?.toFixed(1) ?? ''} | ${o.bannedHitsRaw.length} | ` +
        `${o.bannedHitsDisplayed.length} | ` +
        `${o.whyOverLengthCount}/${o.whyTotalCount} | ${o.jaCharsInEnCount} | ` +
        `${o.costJpy !== null ? o.costJpy.toFixed(2) : ''} |`,
    );
  }
  lines.push('');

  const allRawHits = outcomes.flatMap((o) =>
    o.bannedHitsRaw.map((h) => ({ caseId: o.caseId, run: o.run, ...h })),
  );
  if (allRawHits.length > 0) {
    lines.push('### 禁止パターンのヒット詳細（生値・ストリップ前）');
    lines.push('');
    lines.push('| case | run | day | field | pattern | text |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const h of allRawHits) {
      lines.push(
        `| ${h.caseId} | ${h.run} | ${h.day} | ${h.field} | ${h.pattern} | ${escapeCell(h.text)} |`,
      );
    }
    lines.push('');
  }

  const allDisplayedHits = outcomes.flatMap((o) =>
    o.bannedHitsDisplayed.map((h) => ({ caseId: o.caseId, run: o.run, ...h })),
  );
  if (allDisplayedHits.length > 0) {
    lines.push('### 禁止パターンのヒット詳細（表示値・ストリップ後 — 0件が期待値）');
    lines.push('');
    lines.push('| case | run | day | field | pattern | text |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const h of allDisplayedHits) {
      lines.push(
        `| ${h.caseId} | ${h.run} | ${h.day} | ${h.field} | ${h.pattern} | ${escapeCell(h.text)} |`,
      );
    }
    lines.push('');
  }

  // 安定性: 同一ケースの run1/run2 の日別一致率（報告のみ）
  lines.push('### 安定性（報告のみ・同一入力2回の日別一致率）');
  lines.push('');
  lines.push('| case | 一致 | 分母 | 一致率 |');
  lines.push('| --- | --- | --- | --- |');
  for (const c of cases) {
    const run1 = outcomes.find((o) => o.caseId === c.id && o.run === 1);
    const run2 = outcomes.find((o) => o.caseId === c.id && o.run === 2);
    if (!run1?.ok || !run2?.ok) {
      lines.push(`| ${c.id} | — | — | 未算出（片方失敗） |`);
      continue;
    }
    const byDay1 = new Map(run1.picks.map((p) => [p.day, p.recipeId]));
    const byDay2 = new Map(run2.picks.map((p) => [p.day, p.recipeId]));
    const allDays = new Set([...byDay1.keys(), ...byDay2.keys()]);
    let match = 0;
    for (const day of allDays) {
      if (byDay1.get(day) === byDay2.get(day) && byDay1.get(day) !== undefined) match += 1;
    }
    const rate = allDays.size > 0 ? (match / allDays.size) * 100 : 0;
    lines.push(`| ${c.id} | ${match} | ${allDays.size} | ${rate.toFixed(0)}% |`);
  }
  lines.push('');

  // G 軸: run1 のみ。why 全文 + 照合用の入力事実。
  lines.push('## G 軸（人手・0〜2 点）— run1 のみ');
  lines.push('');
  lines.push(
    '2=事実に基づき自然で言い分け / 1=正しいが汎用的 / **0=渡していない事実を言う（捏造）**。' +
      '基準は `docs/レシピ推論の評価設計.md`。',
  );
  lines.push('');

  for (const c of cases) {
    const run1 = outcomes.find((o) => o.caseId === c.id && o.run === 1);
    if (!run1) continue;
    lines.push(`### ${c.id}`);
    lines.push('');
    if (c.note) lines.push(`_${c.note}_`);
    lines.push('');
    lines.push(`- 日数: ${c.days} / 出力言語: ${c.outputLocale}`);
    lines.push(`- 在庫: ${c.pantry.join('、') || '（空）'}`);
    lines.push(`- 直近に作った料理: ${c.recentTitles.join('、') || '（記録なし）'}`);
    lines.push('- 候補（おすすめ順）:');
    for (const cand of c.candidates) {
      lines.push(
        `  - \`${cand.id}\` ${cand.title}（${cand.label.mainCategory}/${cand.label.genre}・` +
          `カバー${cand.coveragePct}%・不足:${cand.missing.join('、') || 'なし'}・` +
          `${cand.cookTimeMin ?? '?'}分）`,
      );
    }
    lines.push('');

    if (!run1.ok) {
      lines.push(`⚠ run1 失敗: ${run1.error ?? ''}`);
      lines.push('');
      continue;
    }
    if (run1.note) {
      lines.push(`note: ${escapeCell(run1.note)}`);
      lines.push('');
    }
    lines.push('| day | recipeId | title | mainCategory/genre | why | G |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    const labelById = new Map(c.candidates.map((cand) => [cand.id, cand.label]));
    const titleById = new Map(c.candidates.map((cand) => [cand.id, cand.title]));
    for (const pick of run1.picks) {
      const label = labelById.get(pick.recipeId);
      lines.push(
        `| ${pick.day} | ${pick.recipeId} | ${titleById.get(pick.recipeId) ?? ''} | ` +
          `${label ? `${label.mainCategory}/${label.genre}` : ''} | ` +
          `${escapeCell(pick.why ?? '')} |  |`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

// ─── summarize ───────────────────────────────────────────────────────────────

interface MachineRow {
  caseId: string;
  run: number;
  ok: boolean;
  contractViolationCount: number;
  dupMainBaseline: number;
  dupMainAi: number;
  dupGenreBaseline: number;
  dupGenreAi: number;
  coverageDiff: number | null;
  /** 生成直後（ストリップ前）。§10.10.5 の合否判定に使う。 */
  bannedHitsRaw: number;
  /** sanitizeMenuDays を通した後（＝画面表示値）。参考値。 */
  bannedHitsDisplayed: number;
  whyOverLength: number;
  whyTotal: number;
  jaInEn: number;
}

function parseMachineTable(markdown: string): MachineRow[] {
  const rows: MachineRow[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 18) continue;
    const [
      caseId,
      run,
      ok,
      violations,
      ,
      ,
      dupMainBaseline,
      dupMainAi,
      dupGenreBaseline,
      dupGenreAi,
      ,
      ,
      coverageDiff,
      bannedHitsRaw,
      bannedHitsDisplayed,
      whyOverTotal,
      jaInEn,
    ] = cells;
    if (!caseId || caseId === 'case' || caseId.startsWith('---')) continue;
    const [whyOver, whyTotal] = (whyOverTotal ?? '0/0').split('/').map((v) => Number(v));
    rows.push({
      caseId,
      run: Number(run),
      ok: (ok ?? '').includes('✅'),
      contractViolationCount: Number(violations) || 0,
      dupMainBaseline: Number(dupMainBaseline) || 0,
      dupMainAi: Number(dupMainAi) || 0,
      dupGenreBaseline: Number(dupGenreBaseline) || 0,
      dupGenreAi: Number(dupGenreAi) || 0,
      coverageDiff: coverageDiff !== '' && coverageDiff !== undefined ? Number(coverageDiff) : null,
      bannedHitsRaw: Number(bannedHitsRaw) || 0,
      bannedHitsDisplayed: Number(bannedHitsDisplayed) || 0,
      whyOverLength: whyOver || 0,
      whyTotal: whyTotal || 0,
      jaInEn: Number(jaInEn) || 0,
    });
  }
  return rows;
}

interface GRow {
  caseId: string;
  score: number | null;
}

function parseGTable(markdown: string): GRow[] {
  const rows: GRow[] = [];
  const lines = markdown.split('\n');
  let currentCase = '';
  for (const line of lines) {
    const heading = line.match(/^### (.+)$/);
    if (heading?.[1]) {
      currentCase = heading[1].trim();
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 6) continue;
    const [day, , , , , g] = cells;
    if (!day || day === 'day' || day.startsWith('---')) continue;
    const parsed = g === '' || g === undefined ? null : Number(g);
    rows.push({
      caseId: currentCase,
      score: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    });
  }
  return rows;
}

function verdict(ok: boolean): string {
  return ok ? '✅' : '❌';
}

function summarize(args: Map<string, string>): void {
  const file = args.get('file') ?? fail('--file <run が書き出した md> が必要です');
  if (!existsSync(file)) fail(`ファイルが見つかりません: ${file}`);
  const markdown = readFileSync(file, 'utf8');
  const rows = parseMachineTable(markdown);
  if (rows.length === 0)
    fail('機械採点表を読み取れませんでした（run で生成した md か確認してください）');

  process.stdout.write(`\n=== menu-eval 集計: ${path.basename(file)} ===\n`);
  process.stdout.write(`実行数: ${rows.length}\n\n`);

  // 契約違反: 全実行の 90% 以上で違反ゼロ
  const cleanRuns = rows.filter((r) => r.ok && r.contractViolationCount === 0).length;
  const cleanRate = cleanRuns / rows.length;
  process.stdout.write(
    `${verdict(cleanRate >= 0.9)} 契約違反ゼロの実行率: ${(cleanRate * 100).toFixed(1)}% ` +
      `(ライン 90%以上 / ${cleanRuns}/${rows.length})\n`,
  );

  // E: 主菜の散り。分母 = chicken-top・baseline-7
  const eRows = rows.filter((r) => r.ok && E_INDUCING.has(r.caseId));
  if (eRows.length > 0) {
    const improved = eRows.filter((r) => r.dupMainAi < r.dupMainBaseline).length;
    const worsened = eRows.filter((r) => r.dupMainAi > r.dupMainBaseline).length;
    const improvedRate = improved / eRows.length;
    const ok = improvedRate >= 2 / 3 && worsened === 0;
    process.stdout.write(
      `${verdict(ok)} E. 主菜の散り: 改善 ${improved}/${eRows.length}（${(improvedRate * 100).toFixed(0)}%）` +
        ` / 悪化 ${worsened} (ライン: 改善≥2/3 かつ 悪化0)\n`,
    );
  } else {
    process.stdout.write('— E. 主菜の散り: 対象ケースの実行なし\n');
  }

  // F: ジャンルの散り。分母 = chinese-top・near-dup-titles・baseline-7
  const fRows = rows.filter((r) => r.ok && F_INDUCING.has(r.caseId));
  if (fRows.length > 0) {
    const improved = fRows.filter((r) => r.dupGenreAi < r.dupGenreBaseline).length;
    const worsened = fRows.filter((r) => r.dupGenreAi > r.dupGenreBaseline).length;
    const improvedRate = improved / fRows.length;
    const ok = improvedRate >= 2 / 3 && worsened === 0;
    process.stdout.write(
      `${verdict(ok)} F. ジャンルの散り: 改善 ${improved}/${fRows.length}（${(improvedRate * 100).toFixed(0)}%）` +
        ` / 悪化 ${worsened} (ライン: 改善≥2/3 かつ 悪化0)\n`,
    );
  } else {
    process.stdout.write('— F. ジャンルの散り: 対象ケースの実行なし\n');
  }

  // カバー保持: -15pt 以内（全実行の最悪値で判定）
  const coverageDiffs = rows
    .filter((r) => r.ok)
    .map((r) => r.coverageDiff)
    .filter((v): v is number => v !== null);
  if (coverageDiffs.length > 0) {
    const worst = Math.min(...coverageDiffs);
    const avg = average(coverageDiffs) ?? 0;
    const ok = worst >= -15;
    process.stdout.write(
      `${verdict(ok)} カバー保持: 最悪 ${worst.toFixed(1)}pt / 平均 ${avg.toFixed(1)}pt (ライン -15pt以内)\n`,
    );
  }

  // why 禁止パターン: 検出 0 件。§10.10.5 の合否判定は生値（ストリップ前）で測る
  // ——sanitizeMenuDays の防御がある以上、表示値は防御が効いていれば常に 0 件になり
  // プロンプト改良の効果が見えなくなるため。
  const totalBannedHitsRaw = rows.reduce((s, r) => s + r.bannedHitsRaw, 0);
  const totalBannedHitsDisplayed = rows.reduce((s, r) => s + r.bannedHitsDisplayed, 0);
  process.stdout.write(
    `${verdict(totalBannedHitsRaw === 0)} why 禁止パターン（生値・合否判定はこちら）: ` +
      `検出 ${totalBannedHitsRaw} 件 (ライン 0件)\n`,
  );
  process.stdout.write(
    `— why 禁止パターン（表示値・sanitizeMenuDays 通過後・参考値）: ` +
      `検出 ${totalBannedHitsDisplayed} 件（0 件でなければ防御が効いていない）\n`,
  );

  // why 長さ: 超過 5% 以下
  const whyOverTotal = rows.reduce((s, r) => s + r.whyOverLength, 0);
  const whyDenom = rows.reduce((s, r) => s + r.whyTotal, 0);
  if (whyDenom > 0) {
    const overRate = whyOverTotal / whyDenom;
    process.stdout.write(
      `${verdict(overRate <= 0.05)} why 長さ超過率: ${(overRate * 100).toFixed(1)}% ` +
        `(ライン 5%以下 / ${whyOverTotal}/${whyDenom})\n`,
    );
  }

  // 出力言語: en ケースの日本語混入 0 件
  const jaInEnRows = rows.filter((r) => r.ok);
  const totalJaInEn = jaInEnRows.reduce((s, r) => s + r.jaInEn, 0);
  process.stdout.write(
    `${verdict(totalJaInEn === 0)} 出力言語（en混入）: 検出 ${totalJaInEn} 件 (ライン 0件)\n`,
  );

  // 検証の捨て: 報告のみ
  const droppedRuns = rows.filter((r) => r.contractViolationCount >= 1).length;
  process.stdout.write(
    `— 検証の捨て（報告のみ）: sanitize で1行以上捨てた実行 ${droppedRuns}/${rows.length}` +
      `（${((droppedRuns / rows.length) * 100).toFixed(1)}%）\n`,
  );

  // G 軸: 平均 ≥1.5 かつ 0点率 ≤5%
  const gRows = parseGTable(markdown);
  const gScored = gRows.filter((r) => r.score !== null).map((r) => r.score as number);
  if (gScored.length > 0) {
    const avg = average(gScored) ?? 0;
    const zeroRate = gScored.filter((v) => v === 0).length / gScored.length;
    const ok = avg >= 1.5 && zeroRate <= 0.05;
    process.stdout.write(
      `${verdict(ok)} G. why の質（人手）: 平均 ${avg.toFixed(2)} / 0点率 ${(zeroRate * 100).toFixed(1)}% ` +
        `(ライン 平均≥1.5 かつ 0点率≤5% / 採点済み${gScored.length}/${gRows.length}件)\n`,
    );
  } else {
    process.stdout.write('— G. why の質（人手）: 未採点（G 列を埋めてから再実行してください）\n');
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
      '  tsx scripts/menu-eval.ts run [--set menu-eval-cases.json] [--runs 2] [--case <id>]\n' +
      '      [--model <id>] [--thinking <n>] [--delay <ms>] [--jpy <rate>] [--out <dir>]\n' +
      '  tsx scripts/menu-eval.ts summarize --file <run が書き出した md>\n',
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});

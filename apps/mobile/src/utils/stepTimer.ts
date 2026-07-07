/**
 * 手順本文からの調理時間抽出（#77）。
 *
 * 「弱火で10分煮る」のような手順テキストから、タイマーに使える秒数を
 * 見つけ出す純関数。数字＋単位（分/秒/時間）だけを対象にするので、
 * 「一晩」「半日」「N日」のような日単位・かな数字は自然に対象外になる。
 *
 * 消費側:
 * - RecipeForm: タイマー未設定の手順に「⏱ 10分を設定」チップを提案（自動では書かない）
 * - テキスト/URL/AI写真の取り込み: パース結果に自動セット（確認フォームで修正できるため）
 * - 料理中モード: timerSec 未設定でも検出値でタイマーボタンを表示（DB には保存しない）
 */

export interface StepTimerCandidate {
  /** タイマー秒数 */
  seconds: number;
  /** マッチした原文（UI 表示用: 「約10分」「1時間半」など） */
  text: string;
}

// 全角数字・全角小数点も受ける数値トークン
const NUM = '([0-9０-９]+(?:[.．][0-9０-９]+)?)';
// 範囲の前半（「10〜15分」の「10〜」）。短い方を採用する（焦げ防止側に倒す）
const RANGE = `(?:${NUM}\\s*[〜～~\\-−–ー]\\s*)?`;

// 「4分割」（等分カット）と「3分の1」（分数）は時間ではないので除外する
const MINUTES_GUARD = '(?!割)(?!\\s*の\\s*[0-9０-９])';

// 「1時間」「1時間半」「1時間20分」「1〜2時間」
const HOURS_PATTERN = new RegExp(
  `${RANGE}${NUM}\\s*時間(?:\\s*(半)|\\s*${NUM}\\s*分${MINUTES_GUARD})?`,
  'g',
);
// 「10分」「10分半」「約10分」「10〜15分」（約・ほど・間などの前後装飾は値に影響しないので無視）
const MINUTES_PATTERN = new RegExp(`${RANGE}${NUM}\\s*分${MINUTES_GUARD}\\s*(半)?`, 'g');
// 「30秒」「20〜30秒」
const SECONDS_PATTERN = new RegExp(`${RANGE}${NUM}\\s*秒`, 'g');

// タイマーとして意味のある範囲（24時間超・0以下は捨てる）
const MAX_TIMER_SECONDS = 24 * 3600;

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const ascii = raw
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.');
  const value = parseFloat(ascii);
  return Number.isFinite(value) ? value : null;
}

/** 範囲指定なら短い方の値を返す（「10〜15分」→ 10） */
function pickRangeValue(rangeStart: string | undefined, main: string | undefined): number | null {
  const mainValue = toNumber(main);
  if (mainValue == null) return null;
  const startValue = toNumber(rangeStart);
  return startValue != null ? Math.min(startValue, mainValue) : mainValue;
}

interface RawMatch extends StepTimerCandidate {
  index: number;
  length: number;
}

function collectMatches(
  body: string,
  pattern: RegExp,
  toSeconds: (match: RegExpExecArray) => number | null,
): RawMatch[] {
  const results: RawMatch[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) != null) {
    const seconds = toSeconds(match);
    if (seconds != null && seconds > 0 && seconds <= MAX_TIMER_SECONDS) {
      results.push({
        seconds: Math.round(seconds),
        text: match[0].trim(),
        index: match.index,
        length: match[0].length,
      });
    }
  }
  return results;
}

/**
 * 手順本文からタイマー候補を出現順に抽出する。
 * 「1時間20分」は複合で1候補（重なる「20分」は数えない）。
 */
export function extractStepTimers(body: string): StepTimerCandidate[] {
  if (!body) return [];

  const hours = collectMatches(body, HOURS_PATTERN, (m) => {
    // m: [range, hours, 半, minutes]
    const hoursValue = pickRangeValue(m[1], m[2]);
    if (hoursValue == null) return null;
    const half = m[3] ? 1800 : 0;
    const minutes = toNumber(m[4]) ?? 0;
    return hoursValue * 3600 + half + minutes * 60;
  });
  const minutes = collectMatches(body, MINUTES_PATTERN, (m) => {
    const value = pickRangeValue(m[1], m[2]);
    if (value == null) return null;
    return value * 60 + (m[3] ? 30 : 0);
  });
  const seconds = collectMatches(body, SECONDS_PATTERN, (m) => {
    const value = pickRangeValue(m[1], m[2]);
    return value != null ? value : null;
  });

  // 出現順に並べ、重なる区間（時間複合の中の「20分」等）は先勝ちで捨てる。
  // 同じ開始位置なら長いマッチ（複合）を優先する。
  const all = [...hours, ...minutes, ...seconds].sort(
    (a, b) => a.index - b.index || b.length - a.length,
  );
  const picked: RawMatch[] = [];
  let consumedUntil = -1;
  for (const candidate of all) {
    if (candidate.index < consumedUntil) continue;
    picked.push(candidate);
    consumedUntil = candidate.index + candidate.length;
  }

  return picked.map(({ seconds: value, text }) => ({ seconds: value, text }));
}

/** 既定採用の候補（先頭）。無ければ null。 */
export function extractPrimaryStepTimer(body: string): StepTimerCandidate | null {
  return extractStepTimers(body)[0] ?? null;
}

/** 秒数の表示ラベル（600→「10分」/ 5400→「1時間30分」/ 90→「1分30秒」） */
export function formatStepTimerLabel(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}時間`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);
  // 「1時間0分30秒」のような冗長表示は起きない（0 の部位は積まない）
  return parts.join('');
}

/**
 * 取り込みフロー用: timerSec 未設定の手順に本文からの検出値を自動セットする。
 * 既に値がある手順は上書きしない。
 */
export function applyAutoStepTimers<T extends { body: string; timerSec?: number | undefined }>(
  steps: T[],
): T[] {
  return steps.map((step) => {
    if (step.timerSec != null) return step;
    const detected = extractPrimaryStepTimer(step.body);
    return detected ? { ...step, timerSec: detected.seconds } : step;
  });
}

/**
 * 調整後の手順に、元の手順が持っていた**タイマーと写真**を引き継ぐ。
 *
 * `updateRecipe` は手順を丸ごと入れ替えるので、AI が返す本文だけで保存すると
 * 手順写真とタイマーが消える。かといって位置だけで機械的に引き継ぐと、
 * 「弱火で5分煮る」→「弱火で10分煮る」に直したのに 5 分のタイマーが残り、
 * **調理中に間違った時間を指してしまう**。
 *
 * そこで本文が変わったかどうかで分ける:
 * - 本文が同じ  → タイマーも写真もそのまま（同じ手順だと確定できる）
 * - 本文が変わった → 写真は残し、タイマーは**新しい本文から取り直す**
 * - 新しく増えた → 本文から取れるならタイマーを付ける
 */
import { extractPrimaryStepTimer } from './stepTimer';

export interface ExistingStep {
  body: string;
  timerSec: number | null;
  photoPath: string | null;
}

export interface MergedStep {
  body: string;
  timerSec?: number;
  photoPath?: string | null;
}

export function mergeRefinedSteps(before: ExistingStep[], after: { body: string }[]): MergedStep[] {
  return after.map((step, index) => {
    const original = before[index];
    if (original && original.body === step.body) {
      return {
        body: step.body,
        ...(original.timerSec != null && { timerSec: original.timerSec }),
        photoPath: original.photoPath,
      };
    }
    const detected = extractPrimaryStepTimer(step.body);
    return {
      body: step.body,
      ...(detected && { timerSec: detected.seconds }),
      // 写真は手順の見た目の参考なので、本文が変わっても残す
      photoPath: original?.photoPath ?? null,
    };
  });
}

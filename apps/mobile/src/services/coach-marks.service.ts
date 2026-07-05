/**
 * Coach-mark service — first-run usage guidance flags. Each screen shows its
 * coach marks once (per install); the flag is stored in app_meta. 設定 >
 * 使い方ガイド から全画面のマークをリセットして再表示できる。
 */
import { isNativePlatform } from '../db/client';
import { getAppMeta, setAppMeta } from './app-meta.service';

const KEY_PREFIX = 'coach_marks_seen:';
const SEEN = '1';

/** Screens carrying coach marks (used by the reset action). */
export const COACH_MARK_SCREENS = [
  'home',
  'recipes',
  'recipe-detail',
  'shopping',
  'pantry',
  'add',
  'settings',
] as const;

export type CoachMarkScreen = (typeof COACH_MARK_SCREENS)[number];

/**
 * ストア用スクリーンショット取得ビルド（EXPO_PUBLIC_DISABLE_COACH_MARKS=1）では
 * コーチマークを一切表示しない（scripts/release/capture-store-screenshots.mjs 用）。
 */
export function areCoachMarksDisabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_DISABLE_COACH_MARKS;
  return flag === '1' || flag === 'true';
}

export async function shouldShowCoachMarks(screen: CoachMarkScreen): Promise<boolean> {
  if (!isNativePlatform || areCoachMarksDisabled()) return false;
  return (await getAppMeta(KEY_PREFIX + screen)) !== SEEN;
}

export async function markCoachMarksSeen(screen: CoachMarkScreen): Promise<void> {
  if (!isNativePlatform) return;
  await setAppMeta(KEY_PREFIX + screen, SEEN);
}

/** Re-arm every screen's coach marks (設定 > 使い方ガイドを再表示). */
export async function resetCoachMarks(): Promise<void> {
  if (!isNativePlatform) return;
  for (const screen of COACH_MARK_SCREENS) {
    await setAppMeta(KEY_PREFIX + screen, '0');
  }
}

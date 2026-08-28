/**
 * Zustand store for the in-progress cooking session（どの手順まで進んだか）.
 *
 * 料理中モードの手順位置は useState だけで持っていたため、✕ で閉じたり
 * 別画面へ移動すると**手順 1 からやり直し**だった（`docs/画面設計.md` S06 の
 * 「ステップ番号を保存して続きから再開」が設計のまま未実装 — 2026-08-28 実装）。
 *
 * 競合調査（docs/reviews/cooking-resume-research-2026-08-28.md）では、国内アプリに
 * 復帰導線は無く、海外も Paprika のピン留めと Mela のマルチレシピセッションのみ。
 * 「Now Cooking バー」で常時 1 タップ復帰できるのは空白地帯なので、ここを取る。
 *
 * 置き場の判断: timer.store と同じく**画面をまたぐ状態は store が所有**する。
 * さらに調理は 1 時間スケールでアプリのキルをまたぎうるので、unitSystem.store と
 * 同じハイブリッド方式（起動時に app_meta から読み、変更のたび書き戻す）で
 * 再起動も生き延びる。古すぎるセッション（12 時間超）は復元時に捨てる —
 * 昨日の調理に「戻る」導線が出続けるのは邪魔なだけ。
 */
import { create } from 'zustand';

import { getAppMeta, setAppMeta } from '../services/app-meta.service';

const SESSION_KEY = 'cooking_session';

/** これより古いセッションは復元しない（調理としてもう終わっている） */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface CookingSession {
  recipeId: string;
  recipeTitle: string;
  /** 0-based の手順位置 */
  stepIndex: number;
  totalSteps: number;
  /** epoch ms。復元時の鮮度判定に使う */
  startedAt: number;
}

interface CookingSessionState {
  session: CookingSession | null;
  /** 調理を開始（同じレシピなら既存の位置を保つ） */
  begin: (input: Omit<CookingSession, 'startedAt' | 'stepIndex'> & { stepIndex?: number }) => void;
  /** 手順移動のたびに呼ぶ */
  setStep: (stepIndex: number) => void;
  /** 「完成」または明示的な終了。復帰導線も消える */
  end: () => void;
}

function persist(session: CookingSession | null): void {
  // ベストエフォート。書けなくてもアプリ内の復帰（store 経由）は成立する
  void setAppMeta(SESSION_KEY, session ? JSON.stringify(session) : '').catch(() => undefined);
}

export const useCookingSessionStore = create<CookingSessionState>((set, get) => ({
  session: null,

  begin: ({ recipeId, recipeTitle, totalSteps, stepIndex }) => {
    const prev = get().session;
    const next: CookingSession = {
      recipeId,
      recipeTitle,
      totalSteps,
      // 同じレシピの再開なら位置を引き継ぐ（明示指定があればそちら）
      stepIndex:
        stepIndex ??
        (prev && prev.recipeId === recipeId ? Math.min(prev.stepIndex, totalSteps - 1) : 0),
      startedAt: prev && prev.recipeId === recipeId ? prev.startedAt : Date.now(),
    };
    set({ session: next });
    persist(next);
  },

  setStep: (stepIndex) => {
    const prev = get().session;
    if (!prev) return;
    const next = { ...prev, stepIndex };
    set({ session: next });
    persist(next);
  },

  end: () => {
    set({ session: null });
    persist(null);
  },
}));

/** 起動時に一度呼ぶ。app_meta に残っている新しいセッションだけを復元する。 */
export async function loadCookingSession(): Promise<void> {
  const raw = await getAppMeta(SESSION_KEY).catch(() => null);
  if (!raw) return;
  const parsed = parseSession(raw);
  if (!parsed || Date.now() - parsed.startedAt > SESSION_MAX_AGE_MS) {
    // 古い残骸は消しておく（次回以降の読み込みも軽くなる）
    void setAppMeta(SESSION_KEY, '').catch(() => undefined);
    return;
  }
  useCookingSessionStore.setState({ session: parsed });
}

export function parseSession(raw: string): CookingSession | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const s = v as Record<string, unknown>;
    if (
      typeof s.recipeId !== 'string' ||
      s.recipeId === '' ||
      typeof s.recipeTitle !== 'string' ||
      typeof s.stepIndex !== 'number' ||
      typeof s.totalSteps !== 'number' ||
      typeof s.startedAt !== 'number'
    ) {
      return null;
    }
    return {
      recipeId: s.recipeId,
      recipeTitle: s.recipeTitle,
      stepIndex: s.stepIndex,
      totalSteps: s.totalSteps,
      startedAt: s.startedAt,
    };
  } catch {
    return null;
  }
}

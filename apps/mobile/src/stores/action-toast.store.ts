/**
 * Zustand store for ActionToast — ルートレベルの確認付き Toast。
 *
 * 既存の `Toast.tsx`（17 画面が使用）とは別物。
 * `confirmMutate` の結果を表示し、取り消しボタンを持てる。
 *
 * 窓の長さ（`docs/相談してレシピを作る設計.md` §7-5）:
 * - 破壊的操作の取り消し: 8 秒
 * - それ以外: 4 秒
 */
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionToastAction {
  label: string;
  onPress: () => void;
}

export interface ActionToastPayload {
  message: string;
  action?: ActionToastAction;
  /** 自動消去までのミリ秒。既定は 4_000（取り消し付きは 8_000 を渡す） */
  durationMs?: number;
}

interface ActionToastState {
  current: ActionToastPayload | null;
  show: (payload: ActionToastPayload) => void;
  dismiss: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useActionToastStore = create<ActionToastState>((set) => ({
  current: null,

  show: (payload) => set({ current: payload }),

  dismiss: () => set({ current: null }),
}));

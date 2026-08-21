/**
 * 同期の進行状態（S1 — `docs/クラウド同期設計.md` §5-1b）。
 *
 * この画面群は TanStack Query を使っておらず、どの画面も `useFocusEffect` で
 * 開くたびに DB を読み直す作りになっている。それだけだと「見ている最中に他端末の
 * 変更が届いた」ときに画面が古いままなので、**受信を適用した合図**をここに置き、
 * 一覧系の画面はこの値の変化で読み直す（`useSyncRefresh`）。
 *
 * 「誰が何を追加したか」は持たない（§0-2 の決定）。ここにあるのは時刻と真偽だけ。
 */
import { create } from 'zustand';

interface SyncStoreState {
  /** 受信を 1 件でも適用し終えた時刻（epoch ms）。0 = まだ一度も適用していない */
  lastAppliedAt: number;
  /** 同期の往復中。将来インジケータを出すなら使う */
  syncing: boolean;
  markApplied: () => void;
  setSyncing: (syncing: boolean) => void;
  /** テスト用: 初期状態へ戻す */
  resetForTesting: () => void;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  lastAppliedAt: 0,
  syncing: false,
  markApplied: () => set({ lastAppliedAt: Date.now() }),
  setSyncing: (syncing) => set({ syncing }),
  resetForTesting: () => set({ lastAppliedAt: 0, syncing: false }),
}));

/** 描画の外から合図を出す用（サービス層から呼ぶ） */
export function notifySyncApplied(): void {
  useSyncStore.getState().markApplied();
}

export function setSyncing(syncing: boolean): void {
  useSyncStore.getState().setSyncing(syncing);
}

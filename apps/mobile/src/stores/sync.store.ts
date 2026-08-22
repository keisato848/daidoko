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
  /**
   * 家族グループに入っているか。
   *
   * **画面が「個人/家族」の切り替えを出すかどうかの判断に使う**（設計 §5-2 —
   * 未参加のあいだは出さない＝使わない人の画面を変えない）。
   * 起動時と参加・離脱のたびに同期の実行役が入れる。
   */
  joined: boolean;
  markApplied: () => void;
  setSyncing: (syncing: boolean) => void;
  setJoined: (joined: boolean) => void;
  /** テスト用: 初期状態へ戻す */
  resetForTesting: () => void;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  lastAppliedAt: 0,
  syncing: false,
  joined: false,
  markApplied: () => set({ lastAppliedAt: Date.now() }),
  setSyncing: (syncing) => set({ syncing }),
  setJoined: (joined) => set({ joined }),
  resetForTesting: () => set({ lastAppliedAt: 0, syncing: false, joined: false }),
}));

/** 描画の外から合図を出す用（サービス層から呼ぶ） */
export function notifySyncApplied(): void {
  useSyncStore.getState().markApplied();
}

export function setSyncing(syncing: boolean): void {
  useSyncStore.getState().setSyncing(syncing);
}

export function setSyncJoined(joined: boolean): void {
  useSyncStore.getState().setJoined(joined);
}

/** 描画の外から読む用 */
export function isSyncJoined(): boolean {
  return useSyncStore.getState().joined;
}

/**
 * 表示待ちのダイアログ（`docs/画面設計.md` §7-3）。
 *
 * **キューにするのは、ホストが 1 つしかないため。** `Alert.alert` は OS が積んでくれるので
 * 失敗が同時に 2 つ起きても両方出るが、自前のホストは先頭しか描けない。
 * 積まずに上書きすると後の 1 件が黙って消える。
 *
 * ここは状態だけを持つ。Promise 化は `services/dialog.service`、描画は `components/DialogHost`。
 */
import { create } from 'zustand';

import type { DialogButton, DialogLayout } from '../components/AppDialog';

export interface DialogEntry {
  /** キューの中で一意。`key` として使う（同じ文言が続けて積まれても別物として扱う） */
  id: number;
  layout: DialogLayout;
  title: string;
  message?: string;
  buttons: readonly DialogButton[];
  /**
   * 背景タップ・戻るキーで選ばれるボタンの添字。
   * `null` はどのボタンも選ばずに却下（呼び出し側は「キャンセル」として扱う）。
   */
  dismissIndex: number | null;
  /** 押されたボタンの添字を返す。`null` は却下 */
  settle: (index: number | null) => void;
}

interface DialogState {
  queue: readonly DialogEntry[];
  /** `DialogHost` が画面に居るか。無いまま出そうとしたら却下する（service 側で判定） */
  hostMounted: boolean;
  enqueue: (entry: Omit<DialogEntry, 'id'>) => void;
  /** 先頭を解決して取り除く。キューが空なら何もしない */
  settleHead: (index: number | null) => void;
  setHostMounted: (mounted: boolean) => void;
}

let nextId = 1;

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  hostMounted: false,

  enqueue: (entry) => {
    set((state) => ({ queue: [...state.queue, { ...entry, id: nextId++ }] }));
  },

  settleHead: (index) => {
    const [head, ...rest] = get().queue;
    if (!head) return;
    set({ queue: rest });
    head.settle(index);
  },

  setHostMounted: (mounted) => {
    // ホストが外れたら、待っている Promise を全部却下する。
    // 放置すると呼び出し側が永久に await したまま固まる
    if (!mounted) {
      const pending = get().queue;
      set({ hostMounted: false, queue: [] });
      pending.forEach((entry) => entry.settle(null));
      return;
    }
    set({ hostMounted: true });
  },
}));

/** テスト用。キューと採番を初期状態に戻す。 */
export function resetDialogStoreForTesting(): void {
  useDialogStore.setState({ queue: [], hostMounted: false });
  nextId = 1;
}

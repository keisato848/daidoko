/**
 * 家族の変更を、アプリを開かずにウィジェットへ映す背景タスク（受付票 D-3・`docs/ウィジェット設計.md` §11）。
 *
 * サーバーが送る見えない push（`type: 'sync-bg'`）で OS に起こされ、
 * 「DB を開く → 同期して取り込む → ウィジェットのスナップショットを書き直す」だけをやる。
 *
 * **`TaskManager.defineTask` はモジュールの最上位で呼ぶ**（Expo の決まり）。アプリが終了している状態で
 * OS に起こされたとき、画面（`_layout.tsx`）は一切走らない — だから `index.js` がこのファイルを
 * 最初に読み込む。同じ理由で、**ここでは DB の初期化も自前でやる**（`useDatabase` は画面のフックなので
 * 背景では呼ばれない）。移行（`runMigrations`）は毎回の起動でも走る冪等な処理。
 *
 * **ベストエフォート。** Android の Doze・メーカーの省電力・利用者による強制停止、iOS の配信間引き
 * （Apple の目安は 1 時間に 2〜3 通）で届かないことがある。届かなくても、アプリを開けば従来どおり同期する。
 * 失敗は全部握る — 背景で例外を投げても、誰も見ていない。
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { isNativePlatform } from '../db/client';
import { isSyncBackgroundPayload } from '../utils/syncBackgroundPush';

export const SYNC_BACKGROUND_TASK = 'daidoko-sync-background';

/** 同時に 2 本走らせない（見えない push が続けて届いたとき） */
let running: Promise<void> | null = null;

async function syncAndRefreshWidgets(): Promise<void> {
  const { getExpoDb, initDatabase } = await import('../db/client');
  const { runMigrations } = await import('../db/migrate');
  await initDatabase();
  runMigrations(getExpoDb());

  // 家族共有に参加していない端末では、同期は何もせず帰ってくる（サーバーへも行かない）
  const { runSyncAndAwaitPull } = await import('../services/sync-runner.service');
  await runSyncAndAwaitPull();

  // 取り込めなかったときも書き直す（手元の変更が映っていないことがある・害は無い）
  const { writeWidgetSnapshotNow } = await import('../services/widget-snapshot.service');
  await writeWidgetSnapshotNow();
}

if (isNativePlatform) {
  TaskManager.defineTask(SYNC_BACKGROUND_TASK, async ({ data, error }) => {
    if (error || !isSyncBackgroundPayload(data)) return;
    running ??= syncAndRefreshWidgets()
      .catch(() => undefined)
      .finally(() => {
        running = null;
      });
    await running;
  });
}

/** OS に「push が来たらこのタスクを起こして」と頼む。何度呼んでもよい。失敗は握る */
export async function registerSyncBackgroundTask(): Promise<void> {
  if (!isNativePlatform) return;
  try {
    await Notifications.registerTaskAsync(SYNC_BACKGROUND_TASK);
  } catch {
    // 登録できなくても、前面での同期（addSyncPushListener）は従来どおり動く
  }
}

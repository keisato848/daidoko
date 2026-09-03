/**
 * App-meta key-value service — small persistent flags stored in the app_meta
 * table (survives restarts, no extra dependency). Used for things like the
 * cloud Vision inference opt-in consent.
 */
import { eq, like } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';
import {
  MENU_AUTO_DEFAULT_DAYS,
  MENU_AUTO_DEFAULT_NOTIFY_TIME,
  formatMenuAutoNotifyTime,
  isValidMenuAutoDays,
  parseMenuAutoNotifyTime,
  type MenuAutoNotifyTime,
} from '../utils/menuAuto';

const CLOUD_INFERENCE_CONSENT_KEY = 'cloud_inference_consent';
const LAUNCH_CAMERA_KEY = 'launch_camera';
const INSTALLATION_ID_KEY = 'installation_id';
const MENU_AUTO_KEY = 'menu_auto_enabled';
const MENU_AUTO_ADD_KEY = 'menu_auto_add_enabled';
const MENU_AUTO_DAYS_KEY = 'menu_auto_days';
const MENU_AUTO_NOTIFY_TIME_KEY = 'menu_auto_notify_time';

export async function getAppMeta(key: string): Promise<string | null> {
  if (!isNativePlatform) return null;
  const rows = await getDb()
    .select({ value: schema.appMeta.value })
    .from(schema.appMeta)
    .where(eq(schema.appMeta.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

/**
 * 前方一致でキーと値を列挙する。呼び出し側はコード内の固定プレフィックスだけを渡すこと
 * （`%`/`_` を含む動的文字列を渡すと LIKE のワイルドカードとして解釈される）。
 */
export async function getAppMetaByPrefix(
  prefix: string,
): Promise<Array<{ key: string; value: string }>> {
  if (!isNativePlatform) return [];
  return getDb()
    .select({ key: schema.appMeta.key, value: schema.appMeta.value })
    .from(schema.appMeta)
    .where(like(schema.appMeta.key, `${prefix}%`));
}

export async function setAppMeta(key: string, value: string): Promise<void> {
  if (!isNativePlatform) return;
  const updatedAt = new Date().toISOString();
  await getDb()
    .insert(schema.appMeta)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: schema.appMeta.key, set: { value, updatedAt } });
}

/** Whether the user has opted in to cloud Vision inference (sending photos). */
export async function hasCloudInferenceConsent(): Promise<boolean> {
  return (await getAppMeta(CLOUD_INFERENCE_CONSENT_KEY)) === 'granted';
}

export async function setCloudInferenceConsent(granted: boolean): Promise<void> {
  await setAppMeta(CLOUD_INFERENCE_CONSENT_KEY, granted ? 'granted' : 'denied');
}

/**
 * 「アプリを開いたらすぐ撮影」（R3 / Issue #114）。**既定オフ**。
 *
 * 店を出た直後には最適だが、レシピを見に来た人には邪魔になるので既定にはしない
 * （`docs/お店の味を再現設計.md` §4.4）。
 */
export async function isLaunchCameraEnabled(): Promise<boolean> {
  return (await getAppMeta(LAUNCH_CAMERA_KEY)) === 'on';
}

export async function setLaunchCameraEnabled(enabled: boolean): Promise<void> {
  await setAppMeta(LAUNCH_CAMERA_KEY, enabled ? 'on' : 'off');
}

/**
 * インストールごとの乱数 ID（個人情報ではない・同期 §0-2 と同じ線）。
 * AI 献立並べ替え（M2）の `x-device-id` ヘッダに使う（設計 §10.10.1/§10.10.7-3）。
 *
 * **同期の `deviceId`（sync-client.service.ts）とは別物で、流用しない** —
 * 同期未設定の端末には同期 deviceId が存在しないため。初回アクセス時に生成して
 * `app_meta` へ永続化し、以後は同じ値を返す（`generateId()` の UUID v4 は
 * 36 字・`[0-9a-f-]` で、サーバー側の書式チェック 8..64 字 `[A-Za-z0-9_-]` に収まる）。
 */
export async function getInstallationId(): Promise<string> {
  const existing = await getAppMeta(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const next = generateId();
  await setAppMeta(INSTALLATION_ID_KEY, next);
  return next;
}

// ── 毎日の自動献立モード（#215 A1・設計 §10.11）──────────────────────────────
// 親トグル「毎日の献立」（既定オフ）→ 子トグル「足りない材料を自動で追加」（既定オフ）の
// 二段オプトイン。既定値・妥当性判定は utils/menuAuto.ts（純関数・jest 対象）に置く。

/** 親トグル。既定オフ（設計 §10.11 冒頭・「決めるのは常に利用者」）。 */
export async function isMenuAutoEnabled(): Promise<boolean> {
  return (await getAppMeta(MENU_AUTO_KEY)) === 'on';
}

export async function setMenuAutoEnabled(enabled: boolean): Promise<void> {
  await setAppMeta(MENU_AUTO_KEY, enabled ? 'on' : 'off');
}

/**
 * 子トグル。既定オフ。**親がオフでも値は保持する**（親を切ってもまた入れたときに
 * 前回の選択を覚えている方が自然——親のオフは「オフにする」であって「忘れる」ではない）。
 */
export async function isMenuAutoAddEnabled(): Promise<boolean> {
  return (await getAppMeta(MENU_AUTO_ADD_KEY)) === 'on';
}

export async function setMenuAutoAddEnabled(enabled: boolean): Promise<void> {
  await setAppMeta(MENU_AUTO_ADD_KEY, enabled ? 'on' : 'off');
}

/** ローリングの窓幅 X（何日分を保つか）。既定 3。壊れた/範囲外の保存値は既定へ倒す。 */
export async function getMenuAutoDays(): Promise<number> {
  const raw = await getAppMeta(MENU_AUTO_DAYS_KEY);
  const value = raw ? Number(raw) : NaN;
  return isValidMenuAutoDays(value) ? value : MENU_AUTO_DEFAULT_DAYS;
}

export async function setMenuAutoDays(days: number): Promise<void> {
  await setAppMeta(MENU_AUTO_DAYS_KEY, String(days));
}

/** 通知時刻。既定 7:00。 */
export async function getMenuAutoNotifyTime(): Promise<MenuAutoNotifyTime> {
  const raw = await getAppMeta(MENU_AUTO_NOTIFY_TIME_KEY);
  const parsed = raw ? parseMenuAutoNotifyTime(raw) : null;
  return parsed ?? MENU_AUTO_DEFAULT_NOTIFY_TIME;
}

export async function setMenuAutoNotifyTime(time: MenuAutoNotifyTime): Promise<void> {
  await setAppMeta(MENU_AUTO_NOTIFY_TIME_KEY, formatMenuAutoNotifyTime(time));
}

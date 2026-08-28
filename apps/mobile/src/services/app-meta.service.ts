/**
 * App-meta key-value service — small persistent flags stored in the app_meta
 * table (survives restarts, no extra dependency). Used for things like the
 * cloud Vision inference opt-in consent.
 */
import { eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';
import { generateId } from '../utils/id';

const CLOUD_INFERENCE_CONSENT_KEY = 'cloud_inference_consent';
const LAUNCH_CAMERA_KEY = 'launch_camera';
const INSTALLATION_ID_KEY = 'installation_id';

export async function getAppMeta(key: string): Promise<string | null> {
  if (!isNativePlatform) return null;
  const rows = await getDb()
    .select({ value: schema.appMeta.value })
    .from(schema.appMeta)
    .where(eq(schema.appMeta.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
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

/**
 * App-meta key-value service — small persistent flags stored in the app_meta
 * table (survives restarts, no extra dependency). Used for things like the
 * cloud Vision inference opt-in consent.
 */
import { eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';

const CLOUD_INFERENCE_CONSENT_KEY = 'cloud_inference_consent';
const LAUNCH_CAMERA_KEY = 'launch_camera';

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

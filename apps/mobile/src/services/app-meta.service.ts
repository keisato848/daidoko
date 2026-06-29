/**
 * App-meta key-value service — small persistent flags stored in the app_meta
 * table (survives restarts, no extra dependency). Used for things like the
 * cloud Vision inference opt-in consent.
 */
import { eq } from 'drizzle-orm';

import { getDb, isNativePlatform } from '../db/client';
import * as schema from '../db/schema';

const CLOUD_INFERENCE_CONSENT_KEY = 'cloud_inference_consent';

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

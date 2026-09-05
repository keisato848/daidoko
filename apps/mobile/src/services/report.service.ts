/**
 * AI 生成コンテンツの「アプリ内報告」（docs/レシピ表紙AI生成設計.md §6）。
 *
 * Play の AI 生成コンテンツポリシー（"without needing to exit the app"）を満たすための
 * 経路。mailto は使わない（外部メールアプリへの遷移は厳格には満たさない可能性がある —
 * 設計 §6）。サーバー `POST /api/v1/report/content` へ送るだけの薄いサービス。
 */
import { getInstallationId } from './app-meta.service';
import { API_V1 } from '../config';

export type ReportCategory = 'inappropriate' | 'inaccurate' | 'other';

export interface ReportContentInput {
  category: ReportCategory;
  /** 500 字まで（サーバー zod と同じ上限）。空でもよい。 */
  text?: string;
  /** どの画面からの報告か（例: 'cover-image' | 'consult' | 'photo-recipe'）。ログの手がかり用。 */
  source: string;
}

const TIMEOUT_MS = 15_000;

/** 送信の成否だけを返す（例外は投げない — 呼び出し側はトースト 1 つで済ませたい）。 */
export async function reportContent(input: ReportContentInput): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const deviceId = await getInstallationId();
    const res = await fetch(`${API_V1}/report/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({
        category: input.category,
        text: input.text?.trim() ? input.text.trim().slice(0, 500) : undefined,
        source: input.source,
      }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 画像をサーバー/Gemini へ送るときの**唯一の入口**（`docs/品質基準.md` 水平展開規約①）。
 *
 * 実機のカメラ写真（quality 1）は 6.5MB JPEG → base64 8.6MB になり、サーバーの
 * Zod 上限（shared `MAX_INFER_IMAGE_BASE64_LENGTH` = 8,000,000 字）を超えて 400 に
 * なる。冷蔵庫写真で実際に起きた（2026-09-05 実機 E2E・冷蔵庫写真設計 §8）。
 * 前処理を provider 任せにすると経路ごとに抜ける — 送信前の縮小はここに一本化する。
 *
 * 縮小は写真からレシピと同じ既定（`image-preprocess.service` = 長辺 1200・JPEG 0.9）。
 * 縮小後は JPEG で書き出されるので mimeType も揃える。縮小に失敗しても止めない —
 * 元画像で続け、それでも大きすぎる場合はサーバーの 400/413 を `ai-error.ts` が
 * 利用者向け文言に変換する（二段構えの保険）。
 */
import * as FileSystem from 'expo-file-system/legacy';

import { expoImageManipulatorPreprocessAdapter } from './expo-image-preprocess.adapter';
import { preprocessImageForOcr } from './image-preprocess.service';

export interface InferImagePayload {
  imageBase64: string;
  mimeType: string;
}

/** 拡張子から mimeType を推定する（不明は JPEG 扱い — カメラの既定）。 */
export function mimeTypeForUri(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * ローカル画像 1 枚を送信ペイロードにする。**必ず縮小を試してから** base64 化する。
 */
export async function toInferImagePayload(image: {
  localPath: string;
  mimeType?: string;
}): Promise<InferImagePayload> {
  let uri = image.localPath;
  let mimeType = image.mimeType ?? mimeTypeForUri(image.localPath);
  try {
    const processed = await preprocessImageForOcr(uri, expoImageManipulatorPreprocessAdapter);
    uri = processed.imageUri;
    mimeType = 'image/jpeg'; // adapter は JPEG で書き出す
  } catch {
    // 前処理が転んでも元画像で続ける（十分小さい写真ならそのまま通る）
  }
  return {
    imageBase64: await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    }),
    mimeType,
  };
}

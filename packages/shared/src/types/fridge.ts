/**
 * 冷蔵庫写真の読み取り（`docs/冷蔵庫写真設計.md`）。
 *
 * `POST /api/v1/infer/fridge` のリクエスト/レスポンス契約の**正**。
 * 冷蔵庫（庫内・野菜室・ドアポケット）の写真から**食材の品名だけ**を読み取る。
 *
 * **分量・数量は契約に持たせない。** 写真から数量は読めず、推測した数字は在庫で
 * 合算されて「家に無いものが在庫にある」状態を静かに作る（レシートの quantity と
 * 同じ理由で、こちらは最初から欄ごと無い）。数量は使うときに利用者が入れる。
 *
 * `confidence` は 0〜1 の数値。表示側は 3 段階（high/medium/low）に分類して
 * 低いものを「たぶん◯◯」の要確認表示にする（自動確定はどの段階でもしない）。
 *
 * サーバーは実行時に `@daidoko/shared` を取り込まない方針（tsconfig の rootDir が
 * `src` に閉じている）ため、`apps/server/src/routes/infer.ts` は同じ形の zod を
 * ローカルに写している。**片方だけ直さないこと。**
 */
import { z } from 'zod';

import { MAX_INFER_IMAGE_BASE64_LENGTH } from '../constants/ai';

/** 1 回の読み取りに送れる写真の枚数（庫内＋野菜室のような 2 枚まで）。 */
export const MAX_FRIDGE_IMAGES = 2;
/**
 * 画像 1 枚の base64 上限。汎用定数（`constants/ai.ts` の
 * `MAX_INFER_IMAGE_BASE64_LENGTH` — 全 infer ルート共通の正）の別名。
 * 当初この上限が写し（サーバー）にだけあり、契約に無かったため、クライアントが
 * 前処理（縮小）を省いても契約テストでは気づけず、実機のカメラ写真
 * （6.5MB JPEG → base64 8.6MB）が本番で 400 になった（2026-09-05 実機 E2E）。
 * 送信側は `image-payload.ts` の縮小ヘルパー（長辺 1200・JPEG 0.9）を必ず通すこと。
 */
export const MAX_FRIDGE_IMAGE_BASE64_LENGTH = MAX_INFER_IMAGE_BASE64_LENGTH;
/** 1 回の読み取りが返す品目数の上限（家庭の冷蔵庫でこれを超えたら読み違い）。 */
export const MAX_FRIDGE_ITEMS = 60;

/** 読み取った品目 1 件。品名と確からしさだけ — 分量・数量の欄は無い。 */
export const fridgeItemSchema = z.object({
  name: z.string().min(1).max(50),
  /** 読み取りの確からしさ（0〜1）。低いものは UI が要確認表示にする */
  confidence: z.number().min(0).max(1),
});

/** リクエスト本体。locale は AI の**出力言語**（他 infer ルートと同じ意味）。 */
export const fridgeInferRequestSchema = z.object({
  images: z
    .array(
      z.object({
        imageBase64: z.string().min(1).max(MAX_FRIDGE_IMAGE_BASE64_LENGTH),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }),
    )
    .min(1)
    .max(MAX_FRIDGE_IMAGES),
  locale: z.enum(['ja', 'en']).optional(),
  // unitSystem は受けない — 分量を出力しない推論への単位系指示は
  // 「分量を書け」という圧力になるだけ（/infer/menu と同じ判断）
});

/** レスポンスの data 部（AgentResult の中身）。空配列 = 食材を読み取れなかった。 */
export const fridgeInferResponseSchema = z.object({
  items: z.array(fridgeItemSchema).max(MAX_FRIDGE_ITEMS),
});

export type FridgeItem = z.infer<typeof fridgeItemSchema>;
export type FridgeInferRequest = z.infer<typeof fridgeInferRequestSchema>;
export type FridgeInferResponse = z.infer<typeof fridgeInferResponseSchema>;

/**
 * cover-image のサーバー側時間予算（タイムアウト×リトライ回数の合計）が
 * 55 秒を超えないことの検査（`garden-retry-budget.test.ts` と同型・
 * docs/レシピ表紙AI生成設計.md §5）。
 *
 * ## なぜ要るか
 *
 * garden-vision.ts に明文化された教訓と同じ: サーバーの粘りが呼び出し側の
 * 待ち時間を超えると、超えたぶんのリトライは成功しても誰にも届かない
 * — クライアントはとっくに諦めているのに、サーバーだけが Gemini
 * （課金は 1 枚 ≒¥5.0 と高額）を叩き続けて課金だけが増える。
 *
 * cover-image は**リトライなし**（MAX_ATTEMPTS=1）で予算をゼロに倒しているので、
 * どんなクライアントタイムアウトに対しても超えようがない設計だが、
 * 定数は将来いじられる。**そのとき不等式が壊れたら、ここで気づく。**
 */
import { describe, expect, it } from 'vitest';

import {
  CLIENT_TIMEOUT_MS,
  COVER_IMAGE_RETRY_BUDGET_MS,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
} from '../lib/cover-image.js';

describe('cover-image のリトライ予算', () => {
  it('設計 §5 の確定値どおり: 55 秒・リトライなし', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(55_000);
    expect(MAX_ATTEMPTS).toBe(1);
  });

  it('モバイル側の待ち時間（75 秒）を超えない', () => {
    expect(COVER_IMAGE_RETRY_BUDGET_MS).toBeLessThan(CLIENT_TIMEOUT_MS);
  });

  it('55 秒ちょうどを超えない（設計の確定値そのもの）', () => {
    expect(COVER_IMAGE_RETRY_BUDGET_MS).toBeLessThanOrEqual(55_000);
  });
});

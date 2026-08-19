/**
 * リトライ予算が、呼び出し側の待ち時間の中に収まっていることの検査。
 *
 * ## なぜ要るか
 *
 * さいえん手帳アプリは 60 秒でリクエストを打ち切る
 * （`garden-consult.service.ts` の `TIMEOUT_MS`）。サーバーの粘りがそれを超えると、
 * **超えたぶんのリトライは成功しても誰にも届かない** — アプリはとっくに諦めているのに、
 * サーバーだけが Gemini を叩き続けて課金だけが増える。
 *
 * 実際 2026-08-19 まで 30 秒 × 4 回 + バックオフ 13.5 秒 = **133.5 秒**で、
 * アプリの我慢の倍以上あった。4 回とも空振りして 134 秒かかった記録が残っている
 * （`POST /api/v1/garden/consult 200 134s`）。
 *
 * 定数は将来いじられる。**そのとき不等式が壊れたら、ここで気づく。**
 *
 * ## 直し方
 *
 * 落ちたら `REQUEST_TIMEOUT_MS` か `MAX_ATTEMPTS` を減らす。
 * **アプリ側の 60 秒を伸ばして通すのは筋が悪い** — アプリの再ビルドと
 * ストア再提出が要るうえ、ユーザーを待たせる時間が延びるだけで体験は良くならない。
 */
import { describe, expect, it } from 'vitest';

import { CLIENT_TIMEOUT_MS, GARDEN_RETRY_BUDGET_MS } from '../lib/garden-vision.js';

/** アップロードとサーバー処理に残しておく余裕。 */
const HEADROOM_MS = 5_000;

describe('garden consult のリトライ予算', () => {
  it('アプリの待ち時間（60 秒）を超えない', () => {
    expect(GARDEN_RETRY_BUDGET_MS).toBeLessThan(CLIENT_TIMEOUT_MS);
  });

  it('画像アップロードぶんの余裕を残している', () => {
    expect(GARDEN_RETRY_BUDGET_MS).toBeLessThanOrEqual(CLIENT_TIMEOUT_MS - HEADROOM_MS);
  });

  it('リトライが 1 回きりになっていない（一過性の詰まりを拾えること）', () => {
    // 予算を削りすぎて「実質リトライ無し」になると、今度は拾えるはずの失敗を落とす。
    expect(GARDEN_RETRY_BUDGET_MS).toBeGreaterThan(20_000);
  });
});

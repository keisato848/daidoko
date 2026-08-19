/**
 * 用途別のレート上限が本当に独立していることの検査。
 *
 * ## なぜ要るか
 *
 * このサーバーは だいどこ と さいえん手帳 が相乗りしている（さいえん手帳 決定⑨）。
 * 2026-08-19 まで**グローバルカウンタが 1 本**で、両者が同じ 30 回/日を分け合っていた。
 * 1 推論の単価はレシピ ¥0.45 / AI 相談 ¥0.35 と違うのに枠が共通だったため、
 * **安い呼び出しが高い呼び出しの枠に締め出される**状態だった。
 *
 * 分離は「たまたま今そうなっている」のではなく**満たし続けるべき性質**なので、
 * ここで機械的に見張る。片方を使い切っても、もう片方は動かなければならない。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  checkRateLimit,
  GARDEN_POOL,
  RECIPE_POOL,
  resetRateLimitForTesting,
} from '../lib/rate-limit.js';

const ENV_KEYS = [
  'INFER_GLOBAL_DAILY_LIMIT',
  'INFER_DAILY_LIMIT',
  'GARDEN_GLOBAL_DAILY_LIMIT',
  'GARDEN_DAILY_LIMIT',
];

beforeEach(() => {
  resetRateLimitForTesting();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('レート上限のプール分離', () => {
  it('プールのキーが衝突していない', () => {
    expect(RECIPE_POOL.key).not.toBe(GARDEN_POOL.key);
    expect(RECIPE_POOL.globalEnv).not.toBe(GARDEN_POOL.globalEnv);
    expect(RECIPE_POOL.clientEnv).not.toBe(GARDEN_POOL.clientEnv);
  });

  it('レシピ側を使い切っても、さいえん手帳の相談は通る', () => {
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '2';

    expect(checkRateLimit('ip-a', RECIPE_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-a', RECIPE_POOL).allowed).toBe(true);
    // レシピ側は上限
    expect(checkRateLimit('ip-a', RECIPE_POOL)).toEqual({ allowed: false, scope: 'global' });

    // **ここが本体。** 相乗りしている別アプリが巻き添えにならないこと
    expect(checkRateLimit('ip-a', GARDEN_POOL).allowed).toBe(true);
  });

  it('さいえん手帳側を使い切っても、レシピは通る', () => {
    process.env['GARDEN_GLOBAL_DAILY_LIMIT'] = '1';

    expect(checkRateLimit('ip-b', GARDEN_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-b', GARDEN_POOL)).toEqual({ allowed: false, scope: 'global' });

    expect(checkRateLimit('ip-b', RECIPE_POOL).allowed).toBe(true);
  });

  it('クライアント別カウンタもプールで分かれている', () => {
    process.env['INFER_DAILY_LIMIT'] = '1';
    process.env['GARDEN_DAILY_LIMIT'] = '1';

    expect(checkRateLimit('same-ip', RECIPE_POOL).allowed).toBe(true);
    expect(checkRateLimit('same-ip', RECIPE_POOL)).toEqual({ allowed: false, scope: 'client' });

    // 同じ IP でも、用途が違えば独立して数える
    expect(checkRateLimit('same-ip', GARDEN_POOL).allowed).toBe(true);
  });

  it('プールを省略するとレシピ側になる（既存の呼び出しの互換）', () => {
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '1';

    expect(checkRateLimit('ip-c').allowed).toBe(true);
    expect(checkRateLimit('ip-c')).toEqual({ allowed: false, scope: 'global' });
    // 既定がレシピ側なら、さいえん手帳側は無傷のはず
    expect(checkRateLimit('ip-c', GARDEN_POOL).allowed).toBe(true);
  });

  it('既定値: レシピ 30 / さいえん手帳 100', () => {
    // 「月 ¥1,000 以内」の方針から逆算した値。変えるときは根拠ごと更新する。
    expect(RECIPE_POOL.globalDefault).toBe(30);
    expect(GARDEN_POOL.globalDefault).toBe(100);
  });
});

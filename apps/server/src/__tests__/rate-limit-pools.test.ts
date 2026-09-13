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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkRateLimit,
  COVER_POOL,
  GARDEN_POOL,
  HARVEST_POOL,
  RECIPE_POOL,
  resetRateLimitForTesting,
  STEP_POOL,
} from '../lib/rate-limit.js';

const ENV_KEYS = [
  'INFER_GLOBAL_DAILY_LIMIT',
  'INFER_DAILY_LIMIT',
  'GARDEN_GLOBAL_DAILY_LIMIT',
  'GARDEN_DAILY_LIMIT',
  'HARVEST_GLOBAL_DAILY_LIMIT',
  'HARVEST_DAILY_LIMIT',
];

beforeEach(() => {
  resetRateLimitForTesting();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('レート上限のプール分離', () => {
  it('プールのキーが衝突していない（3 プールすべて）', () => {
    const keys = [RECIPE_POOL.key, GARDEN_POOL.key, HARVEST_POOL.key];
    expect(new Set(keys).size).toBe(3);
    const globals = [RECIPE_POOL.globalEnv, GARDEN_POOL.globalEnv, HARVEST_POOL.globalEnv];
    expect(new Set(globals).size).toBe(3);
    const clients = [RECIPE_POOL.clientEnv, GARDEN_POOL.clientEnv, HARVEST_POOL.clientEnv];
    expect(new Set(clients).size).toBe(3);
  });

  it('相談を使い切っても、収穫の読み取りは通る（逆も）', () => {
    // 収穫は単価 1/5・頻度が桁違い。相談の枠に締め出されないことが分離の本体。
    process.env['GARDEN_GLOBAL_DAILY_LIMIT'] = '1';
    expect(checkRateLimit('ip-h', GARDEN_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-h', GARDEN_POOL).allowed).toBe(false);
    expect(checkRateLimit('ip-h', HARVEST_POOL).allowed).toBe(true);

    process.env['HARVEST_GLOBAL_DAILY_LIMIT'] = '1';
    resetRateLimitForTesting();
    expect(checkRateLimit('ip-h2', HARVEST_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-h2', HARVEST_POOL).allowed).toBe(false);
    expect(checkRateLimit('ip-h2', GARDEN_POOL).allowed).toBe(true);
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

  it('既定値: レシピ 30 / 相談 100 / 収穫 500', () => {
    // それぞれ「月 ¥1,000 前後」の方針から単価で逆算した値。変えるときは根拠ごと更新する。
    expect(RECIPE_POOL.globalDefault).toBe(30);
    expect(GARDEN_POOL.globalDefault).toBe(100);
    expect(HARVEST_POOL.globalDefault).toBe(500);
  });

  it('INFER を使い切ると /infer/menu も止まる（共有が仕様・専用プールは無い）', () => {
    process.env['INFER_GLOBAL_DAILY_LIMIT'] = '1';

    // /infer/photo などと同じ RECIPE_POOL を渡す呼び方 = /infer/menu の実装と同じ形
    expect(checkRateLimit('ip-menu', RECIPE_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-menu', RECIPE_POOL)).toEqual({ allowed: false, scope: 'global' });
  });
});

// ─── 手順のイラスト（STEP_POOL）と表紙（COVER_POOL）の分離 ─────────────────────
//
// `docs/レシピ表紙AI生成設計.md` §8-2。表紙は 1 レシピ 1 枚だが、手順は 1 レシピで一度に
// 何枚も作る。同じカウンタだと一括生成 1 回で表紙の天井を食い尽くす。単価が同じでも
// **消費の形が違う**ので分ける。

describe('STEP_POOL と COVER_POOL の分離', () => {
  const STEP_ENV_KEYS = [
    'STEP_IMAGE_GLOBAL_DAILY_LIMIT',
    'STEP_IMAGE_DAILY_LIMIT',
    'COVER_IMAGE_GLOBAL_DAILY_LIMIT',
    'COVER_IMAGE_DAILY_LIMIT',
  ];

  beforeEach(() => {
    resetRateLimitForTesting();
    for (const key of STEP_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of STEP_ENV_KEYS) delete process.env[key];
  });

  it('5 プールすべてでキー・env 名が衝突していない', () => {
    const pools = [RECIPE_POOL, GARDEN_POOL, HARVEST_POOL, COVER_POOL, STEP_POOL];
    expect(new Set(pools.map((p) => p.key)).size).toBe(5);
    expect(new Set(pools.map((p) => p.globalEnv)).size).toBe(5);
    expect(new Set(pools.map((p) => p.clientEnv)).size).toBe(5);
  });

  it('STEP_POOL の env 名と既定値（10/10）', () => {
    // 既定 10/日（月最大 ¥1,550）。クライアント別も 10 — 一括生成は 1 端末が続けて叩く形。
    expect(STEP_POOL.globalEnv).toBe('STEP_IMAGE_GLOBAL_DAILY_LIMIT');
    expect(STEP_POOL.clientEnv).toBe('STEP_IMAGE_DAILY_LIMIT');
    expect(STEP_POOL.globalDefault).toBe(10);
    expect(STEP_POOL.clientDefault).toBe(10);
  });

  it('表紙を使い切っても、手順のイラストは通る（一括が表紙の天井を食わない核心）', () => {
    process.env['COVER_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';

    expect(checkRateLimit('ip-s1', COVER_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-s1', COVER_POOL)).toEqual({ allowed: false, scope: 'global' });

    // 一括生成の形: 続けて何枚も
    expect(checkRateLimit('ip-s1', STEP_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-s1', STEP_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-s1', STEP_POOL).allowed).toBe(true);
  });

  it('手順のイラストを使い切っても、表紙は通る', () => {
    process.env['STEP_IMAGE_GLOBAL_DAILY_LIMIT'] = '1';

    expect(checkRateLimit('ip-s2', STEP_POOL).allowed).toBe(true);
    expect(checkRateLimit('ip-s2', STEP_POOL)).toEqual({ allowed: false, scope: 'global' });

    expect(checkRateLimit('ip-s2', COVER_POOL).allowed).toBe(true);
  });

  it('クライアント別カウンタも STEP / COVER で分かれている', () => {
    process.env['STEP_IMAGE_DAILY_LIMIT'] = '1';
    process.env['COVER_IMAGE_DAILY_LIMIT'] = '1';

    expect(checkRateLimit('same-ip-s', STEP_POOL).allowed).toBe(true);
    expect(checkRateLimit('same-ip-s', STEP_POOL)).toEqual({ allowed: false, scope: 'client' });

    // 同じ IP でも、表紙は独立して数える
    expect(checkRateLimit('same-ip-s', COVER_POOL).allowed).toBe(true);
    expect(checkRateLimit('same-ip-s', COVER_POOL)).toEqual({ allowed: false, scope: 'client' });
  });

  /**
   * **0 は「上限なし」であって「機能オフ」ではない**（`checkRateLimit` は `limit > 0` の
   * ときだけ拒否する）。2026-09-13 の #314 の実装時に、コメント・`.env.example`・
   * リリース手順・設計 §8-2 がそろって「0 で機能オフ」と書いていたのを見つけて直した
   * — **コストを止めるつもりで 0 を入れると天井が外れる**、という逆向きの事故になる。
   *
   * 振る舞いは他の 5 プールと共通なので変えていない（既存のデプロイが 0 を入れている
   * 可能性がある）。文言の方を実装に合わせたので、ここで実装の側を固定しておく。
   */
  it('*_DAILY_LIMIT = 0 は上限なし（機能オフではない）', () => {
    process.env['STEP_IMAGE_GLOBAL_DAILY_LIMIT'] = '0';
    process.env['STEP_IMAGE_DAILY_LIMIT'] = '0';

    for (let i = 0; i < 50; i += 1) {
      expect(checkRateLimit('ip-zero', STEP_POOL).allowed).toBe(true);
    }
  });
});

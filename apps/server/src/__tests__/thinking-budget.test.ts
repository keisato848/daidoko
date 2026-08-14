/**
 * 思考トークンの既定値の解決。**既定はオフ**で、環境変数でだけ戻せる
 * （`src/lib/thinking-budget.ts` の判断の根拠はそちらのコメント）。
 */
import { describe, it, expect, afterEach } from 'vitest';

import { resolveThinkingBudget, thinkingConfigFragment } from '../lib/thinking-budget.js';

const KEY = 'GEMINI_THINKING_BUDGET';

afterEach(() => {
  delete process.env[KEY];
});

describe('resolveThinkingBudget', () => {
  it('未設定なら 0（思考オフ）', () => {
    expect(resolveThinkingBudget()).toBe(0);
  });

  it('空文字は未設定と同じ扱い（Railway で値を消した状態）', () => {
    process.env[KEY] = '   ';
    expect(resolveThinkingBudget()).toBe(0);
  });

  it('auto はモデル既定に戻す＝undefined', () => {
    process.env[KEY] = 'auto';
    expect(resolveThinkingBudget()).toBeUndefined();
  });

  it('auto は大文字・小文字を問わない', () => {
    process.env[KEY] = 'AUTO';
    expect(resolveThinkingBudget()).toBeUndefined();
  });

  it('数値はそのまま上限になる', () => {
    process.env[KEY] = '512';
    expect(resolveThinkingBudget()).toBe(512);
  });

  it('壊れた値は既定（0）に倒す — 黙って思考ありに戻ると課金が増えるため', () => {
    process.env[KEY] = 'yes';
    expect(resolveThinkingBudget()).toBe(0);
  });

  it('負の値も既定に倒す', () => {
    process.env[KEY] = '-1';
    expect(resolveThinkingBudget()).toBe(0);
  });
});

describe('thinkingConfigFragment', () => {
  it('既定では thinkingConfig を送る', () => {
    expect(thinkingConfigFragment()).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
  });

  it('auto のときは何も足さない（リクエストに thinkingConfig が載らない）', () => {
    process.env[KEY] = 'auto';
    expect(thinkingConfigFragment()).toEqual({});
  });
});

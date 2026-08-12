/**
 * AI 入口ゲートの分岐（2026-08-12: 枠切れ→即ペイウォールをやめ、その場で広告）。
 * ここで守るのは**ペイウォールが逃げ道に降格した**こと —
 * 広告を出せる限り、ペイウォールには行かない。
 */
import { decideInferenceGate } from '../inference-gate.service';

describe('decideInferenceGate', () => {
  it('枠が残っていればそのまま実行', () => {
    expect(decideInferenceGate({ canInfer: true, canWatchAdForMore: false })).toBe('ready');
  });

  it('枠切れでも広告を出せるなら、ペイウォールではなくその場で広告', () => {
    expect(decideInferenceGate({ canInfer: false, canWatchAdForMore: true })).toBe('offer-ad');
  });

  it('枠切れ＋広告も出せない（視聴上限・広告なしビルド）ときだけペイウォール', () => {
    expect(decideInferenceGate({ canInfer: false, canWatchAdForMore: false })).toBe('paywall');
  });
});

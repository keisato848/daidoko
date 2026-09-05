/**
 * #266 の回帰。**受信で AI 由来の印を潰さない。**
 *
 * `applyRecipePayload` は DB を掴むのでテストから叩けない（§2.3「jest は動的 import を
 * 実行できない」と同じ制約）。規則そのものを純関数へ切り出してあるので、ここで直接叩く。
 *
 * ここが無いと、`set` を素直な `aiGenerated: payload.aiGenerated ? 1 : null` に
 * 「整理」しても全部緑のまま通り、**印を知らない古い端末からの payload 1 通で印が消える。**
 */
import { incomingAiGeneratedPatch } from '../sync-entities.service';

describe('incomingAiGeneratedPatch — 受信で印を潰さない（#266）', () => {
  it('印を持たない payload では、差分にキー自体を含めない', () => {
    // ここが `{ aiGenerated: null }` になると、手元で立っている印が上書きで消える
    expect(incomingAiGeneratedPatch({})).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(incomingAiGeneratedPatch({}), 'aiGenerated')).toBe(
      false,
    );
  });

  it('false を明示している payload でも、キーを含めない', () => {
    expect(incomingAiGeneratedPatch({ aiGenerated: false })).toEqual({});
  });

  it('true の payload では 1 を書く', () => {
    expect(incomingAiGeneratedPatch({ aiGenerated: true })).toEqual({ aiGenerated: 1 });
  });
});

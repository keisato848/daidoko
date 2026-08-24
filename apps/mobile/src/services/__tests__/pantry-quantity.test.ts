/**
 * 在庫数量のデルタ同期（S2-B・設計 §5-3）の純関数。
 *
 * 固定したいこと:
 * - Σ は行と同じ epoch の持ち分だけ。base NULL かつ持ち分なしは「数量未管理」
 * - 表示は負を 0 に寄せ、「+」は生値から埋める（残り 1 を 2 台が同時に消費しても戻れる）
 * - entity_id は 59 字でサーバーの上限（128）に収まる
 * - epoch は Date.parse で決定的（端末が違っても同じ ISO なら同じ値）
 * - 旧版（v2）の行は `updatedAt` を世代にした絶対値として読める
 */
import {
  computeRaw,
  decideQuantityAdoption,
  displayQuantity,
  effectiveDelta,
  epochOf,
  legacyBaseline,
  monotonicStamp,
  nextEpoch,
  parsePartEntityId,
  partEntityId,
} from '../pantry-quantity';

describe('computeRaw / displayQuantity', () => {
  it('base + 同じ epoch の持ち分だけを足す', () => {
    expect(
      computeRaw(
        5,
        [
          { deviceId: 'a', net: -1, epoch: 10 },
          { deviceId: 'b', net: -1, epoch: 10 },
          { deviceId: 'old', net: -4, epoch: 3 }, // 旧世代は効かない
        ],
        10,
      ),
    ).toBe(3);
  });

  it('base NULL でも持ち分があれば数になる。両方無ければ未管理（null）', () => {
    expect(computeRaw(null, [{ deviceId: 'a', net: 2, epoch: 0 }], null)).toBe(2);
    expect(computeRaw(null, [], null)).toBeNull();
    expect(computeRaw(null, [{ deviceId: 'a', net: 2, epoch: 5 }], null)).toBeNull(); // epoch 違い
  });

  it('表示は負を 0 に寄せる', () => {
    expect(displayQuantity(-1)).toBe(0);
    expect(displayQuantity(2.5)).toBe(2.5);
    expect(displayQuantity(null)).toBeNull();
  });
});

describe('effectiveDelta', () => {
  it('ふつうの増減はそのまま', () => {
    expect(effectiveDelta(5, -1)).toBe(-1);
    expect(effectiveDelta(5, 2)).toBe(2);
  });

  it('残り 1 を 2 台が同時に消費して生値が −1 → 「+」1 回で表示 1 になる分（+2）を積む', () => {
    expect(effectiveDelta(-1, 1)).toBe(2);
  });

  it('表示 0 で「−」は何も書かない', () => {
    expect(effectiveDelta(0, -1)).toBeNull();
    expect(effectiveDelta(-3, -1)).toBeNull();
  });

  it('未管理（null）から「+」で 1', () => {
    expect(effectiveDelta(null, 1)).toBe(1);
  });
});

describe('partEntityId', () => {
  it('UUID と端末 id で 59 字・往復できる', () => {
    const itemId = '0f3a2a1c-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
    const deviceId = 'Zn6wpysRPv9kQ2mL8aTbXc';
    const id = partEntityId(itemId, deviceId);
    expect(id).toHaveLength(59);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(parsePartEntityId(id)).toEqual({ itemId, deviceId });
  });

  it('壊れた id は null', () => {
    expect(parsePartEntityId('no-colon')).toBeNull();
    expect(parsePartEntityId(':x')).toBeNull();
    expect(parsePartEntityId('x:')).toBeNull();
  });
});

describe('epoch / stamp', () => {
  it('epochOf は Date.parse で決定的。読めなければ 0', () => {
    expect(epochOf('2026-08-22T12:00:00.123Z')).toBe(Date.parse('2026-08-22T12:00:00.123Z'));
    expect(epochOf('garbage')).toBe(0);
    expect(epochOf(null)).toBe(0);
  });

  it('nextEpoch は前より必ず大きく、ふつうは now', () => {
    expect(nextEpoch(null, 1000)).toBe(1000);
    expect(nextEpoch(5000, 1000)).toBe(5001); // 時計が戻っても下がらない
  });

  it('monotonicStamp は端末内で単調', () => {
    const first = monotonicStamp(null, Date.parse('2026-08-22T12:00:00.000Z'));
    const second = monotonicStamp(first, Date.parse('2026-08-22T11:00:00.000Z')); // 時計が 1 時間戻った
    expect(Date.parse(second)).toBe(Date.parse(first) + 1);
  });
});

describe('decideQuantityAdoption', () => {
  it('世代が新しければ行 LWW に負けていても採用する', () => {
    expect(decideQuantityAdoption(20, 10, false)).toBe(true);
  });
  it('同じ世代は行 LWW に従う', () => {
    expect(decideQuantityAdoption(10, 10, true)).toBe(true);
    expect(decideQuantityAdoption(10, 10, false)).toBe(false);
  });
  it('古い世代は採用しない（名前で勝っても数量は動かない）', () => {
    expect(decideQuantityAdoption(5, 10, true)).toBe(false);
  });
  it('ローカルが未移行（null）は 0 世代', () => {
    expect(decideQuantityAdoption(1, null, false)).toBe(true);
  });
});

describe('legacyBaseline', () => {
  it('v3 の行はそのまま', () => {
    expect(
      legacyBaseline({
        quantity: 9,
        updatedAt: '2026-08-22T00:00:00Z',
        quantityBase: 4,
        quantityEpoch: 77,
      }),
    ).toEqual({ base: 4, epoch: 77 });
  });
  it('v2 の行は絶対値を updatedAt 世代のベースラインとして読む', () => {
    const updatedAt = '2026-08-22T00:00:00.000Z';
    expect(legacyBaseline({ quantity: 9, updatedAt })).toEqual({
      base: 9,
      epoch: Date.parse(updatedAt),
    });
  });
});

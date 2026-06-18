import { scaleAmount, servingRatio } from '../shoppingScale';

describe('servingRatio', () => {
  it('target/base を返す', () => {
    expect(servingRatio(2, 4)).toBe(2);
    expect(servingRatio(4, 2)).toBe(0.5);
  });

  it('base が null / 0 / 負なら 1', () => {
    expect(servingRatio(null, 4)).toBe(1);
    expect(servingRatio(0, 4)).toBe(1);
    expect(servingRatio(-1, 4)).toBe(1);
  });

  it('target が 0 以下なら 1', () => {
    expect(servingRatio(2, 0)).toBe(1);
  });
});

describe('scaleAmount', () => {
  it('数値+単位をスケール', () => {
    expect(scaleAmount('200g', 2)).toBe('400g');
    expect(scaleAmount('100g', 0.5)).toBe('50g');
  });

  it('小数になる場合は小数第1位まで', () => {
    expect(scaleAmount('200g', 1.5)).toBe('300g');
    expect(scaleAmount('1個', 1.5)).toBe('1.5個');
  });

  it('単位が先頭で数値が後ろでもスケール', () => {
    expect(scaleAmount('大さじ1', 2)).toBe('大さじ2');
    expect(scaleAmount('小さじ2', 1.5)).toBe('小さじ3');
  });

  it('適量・少々など非数値はそのまま', () => {
    expect(scaleAmount('適量', 2)).toBe('適量');
    expect(scaleAmount('少々', 3)).toBe('少々');
  });

  it('null はそのまま', () => {
    expect(scaleAmount(null, 2)).toBeNull();
  });

  it('ratio が 1 なら変更しない', () => {
    expect(scaleAmount('200g', 1)).toBe('200g');
  });

  it('最初の数値のみスケールする', () => {
    expect(scaleAmount('2〜3本', 2)).toBe('4〜3本');
  });
});

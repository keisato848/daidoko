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

  it('範囲（2〜3本）は両端をスケールする', () => {
    expect(scaleAmount('2〜3本', 2)).toBe('4〜6本');
  });

  it('分数は1つの値としてスケールする', () => {
    expect(scaleAmount('1/2個', 2)).toBe('1個');
    expect(scaleAmount('1/2個', 3)).toBe('1.5個');
    expect(scaleAmount('１／２カップ', 2)).toBe('1カップ');
    expect(scaleAmount('1/3本', 2)).toBe('0.7本');
  });

  it('全角数字をスケールする（日本語IME入力対応）', () => {
    expect(scaleAmount('２００ｇ', 1.5)).toBe('300ｇ');
    expect(scaleAmount('大さじ２', 2)).toBe('大さじ4');
  });

  it('全角の小数もスケールする', () => {
    expect(scaleAmount('１．５カップ', 2)).toBe('3カップ');
  });
});

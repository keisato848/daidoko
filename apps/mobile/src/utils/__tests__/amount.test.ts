import { parseAmount } from '../amount';

describe('parseAmount', () => {
  it('splits leading number and unit', () => {
    expect(parseAmount('2個')).toEqual({ quantity: 2, unit: '個' });
    expect(parseAmount('100g')).toEqual({ quantity: 100, unit: 'g' });
    expect(parseAmount('1.5kg')).toEqual({ quantity: 1.5, unit: 'kg' });
  });

  it('normalizes full-width digits', () => {
    expect(parseAmount('２個')).toEqual({ quantity: 2, unit: '個' });
  });

  it('takes the lower bound of a range', () => {
    expect(parseAmount('2〜3枚')).toEqual({ quantity: 2, unit: '〜3枚' });
  });

  it('returns null quantity when there is no leading number', () => {
    expect(parseAmount('少々')).toEqual({ quantity: null, unit: '少々' });
    expect(parseAmount('大さじ1')).toEqual({ quantity: null, unit: '大さじ1' });
  });

  it('handles blank / null', () => {
    expect(parseAmount(null)).toEqual({ quantity: null, unit: null });
    expect(parseAmount('   ')).toEqual({ quantity: null, unit: null });
  });
});

/**
 * 単位系の変換。**間違った数字を出すくらいなら原文のまま出す**方針を固定する。
 */
import {
  convertAmountForDisplay,
  convertTemperaturesForDisplay,
  unitSystemForRegion,
} from '../unitSystem';

describe('unitSystemForRegion', () => {
  it('米国はヤード・ポンド法', () => {
    expect(unitSystemForRegion('US')).toBe('imperial');
    expect(unitSystemForRegion('us')).toBe('imperial');
  });

  it('英語圏でも英国・豪州はメートル法', () => {
    expect(unitSystemForRegion('GB')).toBe('metric');
    expect(unitSystemForRegion('AU')).toBe('metric');
  });

  it('地域が分からなければメートル法', () => {
    expect(unitSystemForRegion(null)).toBe('metric');
    expect(unitSystemForRegion('')).toBe('metric');
  });
});

describe('convertAmountForDisplay', () => {
  it('メートル法では一切触らない', () => {
    expect(convertAmountForDisplay('200g', 'metric')).toBe('200g');
    expect(convertAmountForDisplay('大さじ3', 'metric')).toBe('大さじ3');
  });

  it('質量を oz / lb にする', () => {
    expect(convertAmountForDisplay('200g', 'imperial')).toBe('7 oz');
    // 1 未満は小数でなく分数（「0.38 oz」は機械の換算値にしか見えない —
    // ペルソナレビュー 1.12.2 #16）
    expect(convertAmountForDisplay('10.8g', 'imperial')).toBe('3/8 oz');
    expect(convertAmountForDisplay('14g', 'imperial')).toBe('1/2 oz');
    // ポンドは 1/4 刻みでしか読まないので、2 ポンド未満はオンスのまま出す
    expect(convertAmountForDisplay('500g', 'imperial')).toBe('17.5 oz');
    expect(convertAmountForDisplay('1kg', 'imperial')).toBe('2.25 lb');
    expect(convertAmountForDisplay('1000g', 'imperial')).toBe('2.25 lb');
  });

  it('容量を fl oz / カップにする', () => {
    expect(convertAmountForDisplay('300ml', 'imperial')).toBe('1.25 cups');
    expect(convertAmountForDisplay('50ml', 'imperial')).toBe('1.75 fl oz');
    expect(convertAmountForDisplay('1L', 'imperial')).toBe('4.25 cups');
  });

  it('単位の前後の文字は残す', () => {
    expect(convertAmountForDisplay('約200g', 'imperial')).toBe('約7 oz');
    expect(convertAmountForDisplay('200g入り', 'imperial')).toBe('7 oz入り');
  });

  it('読み切れない分量は原文のまま（間違った数字を出さない）', () => {
    for (const amount of ['適量', '少々', '1個', '½本', '大さじ3', '2かけ', '1袋']) {
      expect(convertAmountForDisplay(amount, 'imperial')).toBe(amount);
    }
  });

  it('全角の数字でも変換できる', () => {
    expect(convertAmountForDisplay('２００ｇ', 'imperial')).toBe('7 oz');
  });

  it('null はそのまま', () => {
    expect(convertAmountForDisplay(null, 'imperial')).toBeNull();
  });
});

describe('convertTemperaturesForDisplay', () => {
  it('メートル法では一切触らない', () => {
    expect(convertTemperaturesForDisplay('170℃の油で揚げる', 'metric')).toBe('170℃の油で揚げる');
  });

  it('℃ と °C を華氏にする（5度刻み）', () => {
    expect(convertTemperaturesForDisplay('170℃の油で揚げる', 'imperial')).toBe('340°Fの油で揚げる');
    expect(convertTemperaturesForDisplay('Preheat to 180 °C', 'imperial')).toBe('Preheat to 355°F');
  });

  it('「度」は加熱の温度らしい範囲だけ変換する', () => {
    expect(convertTemperaturesForDisplay('180度のオーブンで焼く', 'imperial')).toBe(
      '355°Fのオーブンで焼く',
    );
    // 回数の「度」を温度と読むと数字が化ける
    expect(convertTemperaturesForDisplay('2度揚げる', 'imperial')).toBe('2度揚げる');
    expect(convertTemperaturesForDisplay('3度に分けて加える', 'imperial')).toBe(
      '3度に分けて加える',
    );
  });

  it('1 つの文に複数あっても全部変換する', () => {
    expect(convertTemperaturesForDisplay('170℃で3分、190℃で1分', 'imperial')).toBe(
      '340°Fで3分、375°Fで1分',
    );
  });
});

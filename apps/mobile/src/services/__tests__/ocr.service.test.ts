import { hasEnoughOcrText, normalizeOcrText, parseOcrText } from '../ocr.service';

describe('OCR-SVC-02 normalizeOcrText', () => {
  it('normalizes OCR heading noise and whitespace', () => {
    const normalized = normalizeOcrText(`
P. 1
【 材料 】：
じゃがいも　 3個
玉ねぎ\t1個
---
（ 作り方 ）：
1. じゃがいもを切る
`);

    expect(normalized).toBe(`材料
じゃがいも 3個
玉ねぎ 1個
作り方
1. じゃがいもを切る`);
  });

  it('detects text that is too sparse for OCR parsing', () => {
    expect(hasEnoughOcrText('肉じゃが')).toBe(false);
    expect(hasEnoughOcrText('肉じゃが\n材料\nじゃがいも 3個\n作り方\n1. 切る')).toBe(true);
  });
});

describe('OCR-AGT-01 parseOcrText', () => {
  it('hands normalized OCR text to the shared recipe parser', async () => {
    const parsed = await parseOcrText(`
肉じゃが
4人分
材料：
じゃがいも　3個
玉ねぎ 1個
牛こま肉 200g
作り方：
1. 材料を切る
2. 肉を炒める
3. 煮込む
`);

    expect(parsed.confidence).toBe('high');
    expect(parsed.formData.title).toBe('肉じゃが');
    expect(parsed.formData.servings).toBe(4);
    expect(parsed.formData.ingredients.map((ingredient) => ingredient.name)).toEqual([
      'じゃがいも',
      '玉ねぎ',
      '牛こま肉',
    ]);
    expect(parsed.formData.steps.map((step) => step.body)).toEqual([
      '材料を切る',
      '肉を炒める',
      '煮込む',
    ]);
  });
});

import { mergeRefinedSteps, type ExistingStep } from '../refineSteps';

const BEFORE: ExistingStep[] = [
  { body: '豆腐を切る', timerSec: null, photoPath: 'file:///photos/step1.jpg' },
  { body: '弱火で5分煮る', timerSec: 300, photoPath: null },
];

describe('mergeRefinedSteps', () => {
  it('本文が同じならタイマーも写真もそのまま', () => {
    const merged = mergeRefinedSteps(BEFORE, [{ body: '豆腐を切る' }, { body: '弱火で5分煮る' }]);

    expect(merged[0]).toEqual({ body: '豆腐を切る', photoPath: 'file:///photos/step1.jpg' });
    expect(merged[1]).toEqual({ body: '弱火で5分煮る', timerSec: 300, photoPath: null });
  });

  it('本文が変わったらタイマーは新しい本文から取り直す', () => {
    const merged = mergeRefinedSteps(BEFORE, [{ body: '豆腐を切る' }, { body: '弱火で10分煮る' }]);

    // 古い 5 分（300秒）が残ると調理中に間違った時間を指す
    expect(merged[1]?.timerSec).toBe(600);
  });

  it('本文が変わってもタイマーが読み取れなければ付けない', () => {
    const merged = mergeRefinedSteps(BEFORE, [
      { body: '豆腐を切る' },
      { body: 'とろみがつくまで煮る' },
    ]);

    expect(merged[1]?.timerSec).toBeUndefined();
  });

  it('本文が変わっても手順写真は残す', () => {
    const merged = mergeRefinedSteps(BEFORE, [{ body: '豆腐を2cm角に切る' }]);

    expect(merged[0]?.photoPath).toBe('file:///photos/step1.jpg');
  });

  it('増えた手順は本文からタイマーを検出する', () => {
    const merged = mergeRefinedSteps(BEFORE, [
      { body: '豆腐を切る' },
      { body: '弱火で5分煮る' },
      { body: '3分蒸らす' },
    ]);

    expect(merged[2]).toEqual({ body: '3分蒸らす', timerSec: 180, photoPath: null });
  });

  it('減った手順は落ちる', () => {
    expect(mergeRefinedSteps(BEFORE, [{ body: '豆腐を切る' }])).toHaveLength(1);
  });
});

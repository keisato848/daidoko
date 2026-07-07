import {
  applyAutoStepTimers,
  extractPrimaryStepTimer,
  extractStepTimers,
  formatStepTimerLabel,
} from '../stepTimer';

describe('extractStepTimers', () => {
  it('extracts minutes', () => {
    expect(extractPrimaryStepTimer('弱火で10分煮る')).toEqual({ seconds: 600, text: '10分' });
    expect(extractPrimaryStepTimer('10分間蒸らす')?.seconds).toBe(600);
    expect(extractPrimaryStepTimer('約5分炒める')?.seconds).toBe(300);
    expect(extractPrimaryStepTimer('3分ほど茹でる')?.seconds).toBe(180);
  });

  it('extracts seconds', () => {
    expect(extractPrimaryStepTimer('30秒レンジにかける')?.seconds).toBe(30);
  });

  it('extracts hours and composites', () => {
    expect(extractPrimaryStepTimer('1時間煮込む')?.seconds).toBe(3600);
    expect(extractPrimaryStepTimer('1時間半置く')?.seconds).toBe(5400);
    // 複合は1候補（中の「20分」を二重に数えない）
    const composite = extractStepTimers('1時間20分煮込む');
    expect(composite).toHaveLength(1);
    expect(composite[0].seconds).toBe(4800);
  });

  it('extracts 分半', () => {
    expect(extractPrimaryStepTimer('2分半茹でる')?.seconds).toBe(150);
  });

  it('takes the shorter end of ranges (焦げ防止側)', () => {
    expect(extractPrimaryStepTimer('10〜15分煮る')?.seconds).toBe(600);
    expect(extractPrimaryStepTimer('10-15分煮る')?.seconds).toBe(600);
    expect(extractPrimaryStepTimer('１０～１５分煮る')?.seconds).toBe(600);
    expect(extractPrimaryStepTimer('20〜30秒混ぜる')?.seconds).toBe(20);
    expect(extractPrimaryStepTimer('1〜2時間寝かせる')?.seconds).toBe(3600);
  });

  it('handles full-width digits and decimals', () => {
    expect(extractPrimaryStepTimer('１０分煮る')?.seconds).toBe(600);
    expect(extractPrimaryStepTimer('1.5分加熱')?.seconds).toBe(90);
  });

  it('treats 「N分以上」 as N', () => {
    expect(extractPrimaryStepTimer('30分以上冷やす')?.seconds).toBe(1800);
  });

  it('ignores day-scale and non-numeric durations', () => {
    expect(extractStepTimers('一晩寝かせる')).toEqual([]);
    expect(extractStepTimers('半日干す')).toEqual([]);
    expect(extractStepTimers('2日間漬け込む')).toEqual([]);
    expect(extractStepTimers('塩分と水分をとばす')).toEqual([]);
  });

  it('ignores 等分・分割・分数（時間ではない「分」）', () => {
    expect(extractStepTimers('4等分にして成形する')).toEqual([]);
    expect(extractStepTimers('生地を4分割する')).toEqual([]);
    expect(extractStepTimers('レモン3分の1個を搾る')).toEqual([]);
    // 「〜分の」でも後ろが数字でなければ時間として扱う
    expect(extractPrimaryStepTimer('10分の加熱で仕上げる')?.seconds).toBe(600);
  });

  it('ignores zero and absurd values', () => {
    expect(extractStepTimers('0分')).toEqual([]);
    expect(extractStepTimers('100000秒待つ')).toEqual([]);
  });

  it('returns multiple candidates in order of appearance', () => {
    const found = extractStepTimers('5分煮て、火を止めて10分蒸らす');
    expect(found.map((c) => c.seconds)).toEqual([300, 600]);
    // 既定採用は先頭
    expect(extractPrimaryStepTimer('5分煮て、火を止めて10分蒸らす')?.seconds).toBe(300);
  });

  it('returns empty for empty body', () => {
    expect(extractStepTimers('')).toEqual([]);
  });
});

describe('formatStepTimerLabel', () => {
  it('formats common values', () => {
    expect(formatStepTimerLabel(600)).toBe('10分');
    expect(formatStepTimerLabel(5400)).toBe('1時間30分');
    expect(formatStepTimerLabel(90)).toBe('1分30秒');
    expect(formatStepTimerLabel(45)).toBe('45秒');
    expect(formatStepTimerLabel(3600)).toBe('1時間');
  });
});

describe('applyAutoStepTimers', () => {
  it('fills missing timers and keeps existing ones', () => {
    const steps = [
      { body: '10分煮る', timerSec: undefined },
      { body: '5分蒸らす', timerSec: 999 },
      { body: '皿に盛る', timerSec: undefined },
    ];
    const result = applyAutoStepTimers(steps);
    expect(result[0].timerSec).toBe(600);
    expect(result[1].timerSec).toBe(999); // 上書きしない
    expect(result[2].timerSec).toBeUndefined();
  });
});

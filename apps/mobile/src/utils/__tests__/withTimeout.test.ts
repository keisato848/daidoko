import { withTimeout } from '../withTimeout';

/**
 * 「返ってこない処理」で本筋を止めないための小道具。push トークンの取得が FCM 待ちで
 * 返らず、一括生成の投入が永久に始まらなかった（2026-09-19 エミュレータで検出）。
 */
describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('時間内に終われば、その値を返す', async () => {
    await expect(withTimeout(Promise.resolve('token'), 1000, null)).resolves.toBe('token');
  });

  it('**返ってこない処理は、時間が来たら fallback で先へ進む**', async () => {
    const never = new Promise<string>(() => undefined);
    const result = withTimeout(never, 4000, null);
    jest.advanceTimersByTime(3999);
    let settled = false;
    void result.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(result).resolves.toBeNull();
  });

  it('失敗も fallback に倒す（呼び出し側に try/catch を要求しない）', async () => {
    await expect(withTimeout(Promise.reject(new Error('fcm')), 1000, null)).resolves.toBeNull();
  });

  it('時間切れの後に元の処理が終わっても、結果は変わらない', async () => {
    let finish: (value: string) => void = () => undefined;
    const late = new Promise<string>((resolve) => (finish = resolve));
    const result = withTimeout(late, 1000, 'fallback');
    jest.advanceTimersByTime(1000);
    finish('late');
    await expect(result).resolves.toBe('fallback');
  });

  it('時間内に終わったら、タイマーを残さない', async () => {
    await withTimeout(Promise.resolve(1), 60_000, null);
    expect(jest.getTimerCount()).toBe(0);
  });
});

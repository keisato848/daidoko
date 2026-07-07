import { useTimerStore } from '../timer.store';

// Access store directly (non-React)
const store = useTimerStore;

beforeEach(() => {
  store.getState().clear();
  jest.useFakeTimers();
});

afterEach(() => {
  store.getState().clear();
  jest.useRealTimers();
});

describe('timer.store', () => {
  it('starts in idle state', () => {
    expect(store.getState().status).toBe('idle');
    expect(store.getState().totalSec).toBe(0);
    expect(store.getState().remainingSec).toBe(0);
  });

  it('setup sets totalSec and remainingSec', () => {
    store.getState().setup(120);
    expect(store.getState().totalSec).toBe(120);
    expect(store.getState().remainingSec).toBe(120);
    expect(store.getState().status).toBe('idle');
  });

  it('start transitions to running', () => {
    store.getState().setup(60);
    store.getState().start();
    expect(store.getState().status).toBe('running');
  });

  it('tick decrements remainingSec', () => {
    store.getState().setup(10);
    store.getState().start();

    jest.advanceTimersByTime(3000);

    expect(store.getState().remainingSec).toBe(7);
    expect(store.getState().status).toBe('running');
  });

  it('transitions to finished when reaching 0', () => {
    store.getState().setup(3);
    store.getState().start();

    jest.advanceTimersByTime(3000);

    expect(store.getState().remainingSec).toBe(0);
    expect(store.getState().status).toBe('finished');
  });

  it('pause stops the countdown', () => {
    store.getState().setup(10);
    store.getState().start();

    jest.advanceTimersByTime(2000);
    store.getState().pause();

    const remaining = store.getState().remainingSec;
    jest.advanceTimersByTime(3000);

    expect(store.getState().remainingSec).toBe(remaining);
    expect(store.getState().status).toBe('paused');
  });

  it('resume continues the countdown', () => {
    store.getState().setup(10);
    store.getState().start();

    jest.advanceTimersByTime(2000);
    store.getState().pause();
    store.getState().resume();

    jest.advanceTimersByTime(2000);

    expect(store.getState().remainingSec).toBe(6);
    expect(store.getState().status).toBe('running');
  });

  it('reset restores totalSec', () => {
    store.getState().setup(60);
    store.getState().start();
    jest.advanceTimersByTime(10000);

    store.getState().reset();

    expect(store.getState().remainingSec).toBe(60);
    expect(store.getState().status).toBe('idle');
  });

  it('clear resets everything to zero', () => {
    store.getState().setup(120);
    store.getState().start();
    jest.advanceTimersByTime(5000);

    store.getState().clear();

    expect(store.getState().totalSec).toBe(0);
    expect(store.getState().remainingSec).toBe(0);
    expect(store.getState().status).toBe('idle');
  });

  it('does not start if remainingSec is 0', () => {
    store.getState().setup(0);
    store.getState().start();
    expect(store.getState().status).toBe('idle');
  });

  it('keeps ticking across widget unmount (store-owned countdown)', () => {
    // ウィジェットの mount/unmount と無関係にストアが数え続けることの回帰確認:
    // setup→start 後、購読者ゼロでも advanceTimersByTime だけで進む
    store.getState().setup(10);
    store.getState().start();
    jest.advanceTimersByTime(4000);
    expect(store.getState().remainingSec).toBe(6);
  });

  it('records the step context and clears it', () => {
    const context = { recipeId: 'recipe-1', stepId: 'step-2', stepNumber: 2 };
    store.getState().setup(60, context);
    expect(store.getState().context).toEqual(context);

    // reset はコンテキストを保持（同じ手順で再スタートできる）
    store.getState().start();
    store.getState().reset();
    expect(store.getState().context).toEqual(context);

    store.getState().clear();
    expect(store.getState().context).toBeNull();
  });

  it('setup without context clears the previous context', () => {
    store.getState().setup(60, { recipeId: 'r', stepId: 's', stepNumber: 1 });
    store.getState().setup(30);
    expect(store.getState().context).toBeNull();
    expect(store.getState().totalSec).toBe(30);
  });

  it('replacing with a new setup while running switches cleanly', () => {
    store.getState().setup(60, { recipeId: 'r', stepId: 'step-1', stepNumber: 1 });
    store.getState().start();
    jest.advanceTimersByTime(5000);

    store.getState().setup(30, { recipeId: 'r', stepId: 'step-3', stepNumber: 3 });
    expect(store.getState().status).toBe('idle');
    expect(store.getState().remainingSec).toBe(30);
    expect(store.getState().context?.stepId).toBe('step-3');

    store.getState().start();
    jest.advanceTimersByTime(2000);
    expect(store.getState().remainingSec).toBe(28);
  });

  it('recovers the correct remaining time after a clock jump (background suspend)', () => {
    store.getState().setup(60);
    store.getState().start();
    jest.advanceTimersByTime(2000);
    expect(store.getState().remainingSec).toBe(58);

    // バックグラウンドで JS が止まっていた状況: 時計だけ 30 秒進めて次の tick
    jest.setSystemTime(Date.now() + 30_000);
    jest.advanceTimersByTime(1000);
    expect(store.getState().remainingSec).toBe(60 - 2 - 30 - 1);
  });

  it('finishes (not negative) when the clock jumps past the end', () => {
    store.getState().setup(10);
    store.getState().start();
    jest.setSystemTime(Date.now() + 60_000);
    jest.advanceTimersByTime(1000);
    expect(store.getState().remainingSec).toBe(0);
    expect(store.getState().status).toBe('finished');
  });

  it('pause captures remaining from the end timestamp', () => {
    store.getState().setup(60);
    store.getState().start();
    jest.advanceTimersByTime(2000);
    // tick 間に時計が進んでいても pause 時点の残りが正しい
    jest.setSystemTime(Date.now() + 10_000);
    store.getState().pause();
    expect(store.getState().remainingSec).toBe(48);
  });
});

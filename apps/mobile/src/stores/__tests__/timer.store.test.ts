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
});

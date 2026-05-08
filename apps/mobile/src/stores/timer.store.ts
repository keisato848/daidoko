/**
 * Zustand store for cooking timer
 * Manages countdown timer with start/pause/resume/reset/tick
 */
import { create } from 'zustand';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

interface TimerState {
  /** Total seconds set for the timer */
  totalSec: number;
  /** Remaining seconds */
  remainingSec: number;
  /** Current status */
  status: TimerStatus;
  /** Interval ID for ticking */
  _intervalId: ReturnType<typeof setInterval> | null;

  /** Set up a new timer with the given total seconds */
  setup: (totalSec: number) => void;
  /** Start or resume the countdown */
  start: () => void;
  /** Pause the countdown */
  pause: () => void;
  /** Resume after pause */
  resume: () => void;
  /** Reset back to initial time */
  reset: () => void;
  /** Tick — subtract 1 second. Internal use. */
  tick: () => void;
  /** Clear the timer completely */
  clear: () => void;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  totalSec: 0,
  remainingSec: 0,
  status: 'idle',
  _intervalId: null,

  setup: (totalSec) => {
    const state = get();
    if (state._intervalId) clearInterval(state._intervalId);
    set({
      totalSec,
      remainingSec: totalSec,
      status: 'idle',
      _intervalId: null,
    });
  },

  start: () => {
    const state = get();
    if (state.status === 'running') return;
    if (state.remainingSec <= 0) return;

    const id = setInterval(() => {
      get().tick();
    }, 1000);

    set({ status: 'running', _intervalId: id });
  },

  pause: () => {
    const state = get();
    if (state._intervalId) clearInterval(state._intervalId);
    set({ status: 'paused', _intervalId: null });
  },

  resume: () => {
    get().start();
  },

  reset: () => {
    const state = get();
    if (state._intervalId) clearInterval(state._intervalId);
    set({
      remainingSec: state.totalSec,
      status: 'idle',
      _intervalId: null,
    });
  },

  tick: () => {
    const state = get();
    const next = state.remainingSec - 1;
    if (next <= 0) {
      if (state._intervalId) clearInterval(state._intervalId);
      set({ remainingSec: 0, status: 'finished', _intervalId: null });
    } else {
      set({ remainingSec: next });
    }
  },

  clear: () => {
    const state = get();
    if (state._intervalId) clearInterval(state._intervalId);
    set({
      totalSec: 0,
      remainingSec: 0,
      status: 'idle',
      _intervalId: null,
    });
  },
}));

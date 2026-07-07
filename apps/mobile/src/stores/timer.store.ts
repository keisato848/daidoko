/**
 * Zustand store for the cooking timer.
 *
 * The countdown must survive step navigation and widget unmounts (煮込み中に
 * 次の手順を読むのが普通の動線), so this store — not the TimerWidget — owns the
 * countdown AND the OS notification lifecycle. Remaining time derives from an
 * absolute end timestamp so the count self-corrects after the JS clock was
 * suspended in the background. `context` records which recipe/step the timer
 * belongs to, letting the cooking screen show a jump-back chip on other steps.
 */
import { create } from 'zustand';

import {
  cancelTimerNotification,
  scheduleTimerNotification,
} from '../services/notification.service';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface TimerContext {
  recipeId: string;
  stepId: string;
  stepNumber: number;
}

interface TimerState {
  /** Total seconds set for the timer */
  totalSec: number;
  /** Remaining seconds */
  remainingSec: number;
  /** Current status */
  status: TimerStatus;
  /** Which recipe/step the timer belongs to (null = no timer set up) */
  context: TimerContext | null;
  /** Interval ID for ticking */
  _intervalId: ReturnType<typeof setInterval> | null;
  /** Absolute end time (epoch ms) while running */
  _endsAt: number | null;
  /** Scheduled OS notification for the timer end */
  _notificationId: string | null;

  /** Set up a new timer with the given total seconds (replaces any current one) */
  setup: (totalSec: number, context?: TimerContext | null) => void;
  /** Start or resume the countdown */
  start: () => void;
  /** Pause the countdown */
  pause: () => void;
  /** Resume after pause */
  resume: () => void;
  /** Reset back to initial time (keeps the step context) */
  reset: () => void;
  /** Tick — recompute remaining from the end timestamp. Internal use. */
  tick: () => void;
  /** Clear the timer completely */
  clear: () => void;
}

export const useTimerStore = create<TimerState>((set, get) => {
  const cancelNotification = () => {
    const id = get()._notificationId;
    if (id) {
      set({ _notificationId: null });
      void cancelTimerNotification(id);
    }
  };

  // Fire-and-forget: schedule the OS notification for the current remaining
  // time, replacing a stale one. Dropped if the timer stopped meanwhile.
  const scheduleNotification = () => {
    const seconds = get().remainingSec;
    void (async () => {
      const id = await scheduleTimerNotification(seconds);
      if (!id) return;
      if (get().status === 'running') {
        const previous = get()._notificationId;
        if (previous && previous !== id) void cancelTimerNotification(previous);
        set({ _notificationId: id });
      } else {
        void cancelTimerNotification(id);
      }
    })();
  };

  const stopInterval = () => {
    const id = get()._intervalId;
    if (id) clearInterval(id);
  };

  return {
    totalSec: 0,
    remainingSec: 0,
    status: 'idle',
    context: null,
    _intervalId: null,
    _endsAt: null,
    _notificationId: null,

    setup: (totalSec, context = null) => {
      stopInterval();
      cancelNotification();
      set({
        totalSec,
        remainingSec: totalSec,
        status: 'idle',
        context,
        _intervalId: null,
        _endsAt: null,
      });
    },

    start: () => {
      const state = get();
      if (state.status === 'running') return;
      if (state.remainingSec <= 0) return;

      const id = setInterval(() => {
        get().tick();
      }, 1000);

      set({
        status: 'running',
        _intervalId: id,
        _endsAt: Date.now() + state.remainingSec * 1000,
      });
      scheduleNotification();
    },

    pause: () => {
      const state = get();
      stopInterval();
      const remaining =
        state._endsAt != null
          ? Math.max(0, Math.ceil((state._endsAt - Date.now()) / 1000))
          : state.remainingSec;
      set({ status: 'paused', remainingSec: remaining, _intervalId: null, _endsAt: null });
      cancelNotification();
    },

    resume: () => {
      get().start();
    },

    reset: () => {
      const state = get();
      stopInterval();
      set({
        remainingSec: state.totalSec,
        status: 'idle',
        _intervalId: null,
        _endsAt: null,
      });
      cancelNotification();
    },

    tick: () => {
      const state = get();
      const remaining =
        state._endsAt != null
          ? Math.max(0, Math.ceil((state._endsAt - Date.now()) / 1000))
          : state.remainingSec - 1;
      if (remaining <= 0) {
        stopInterval();
        set({ remainingSec: 0, status: 'finished', _intervalId: null, _endsAt: null });
        // The OS notification fires at the end time on its own; cancelling a
        // fired notification is a no-op, so this only prevents double alerts
        // when JS caught the finish first.
        cancelNotification();
      } else {
        set({ remainingSec: remaining });
      }
    },

    clear: () => {
      stopInterval();
      set({
        totalSec: 0,
        remainingSec: 0,
        status: 'idle',
        context: null,
        _intervalId: null,
        _endsAt: null,
      });
      cancelNotification();
    },
  };
});

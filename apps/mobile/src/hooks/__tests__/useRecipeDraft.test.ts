import { act, renderHook } from '@testing-library/react-native';

import { useDraftStore, useRecipeDraft } from '../useRecipeDraft';

const draftA = {
  title: '下書き肉じゃが',
  ingredients: [{ name: 'じゃがいも', amount: '3個', groupLabel: '', note: '' }],
};

const draftB = {
  title: '下書き豚汁',
  steps: [{ body: '野菜を煮る', timerSec: undefined }],
};

describe('useRecipeDraft', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-23T10:00:00.000Z'));
    useDraftStore.setState({ draft: null, updatedAt: null });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('starts with no draft', () => {
    const { result } = renderHook(() => useRecipeDraft());

    expect(result.current.draft).toBeNull();
  });

  it('debounces draft saves for 3 seconds', () => {
    const { result } = renderHook(() => useRecipeDraft());

    act(() => {
      result.current.saveDraft(draftA);
      jest.advanceTimersByTime(2999);
    });

    expect(useDraftStore.getState().draft).toBeNull();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(useDraftStore.getState().draft).toEqual(draftA);
    expect(useDraftStore.getState().updatedAt).toBe(new Date('2026-05-23T10:00:03.000Z').getTime());
  });

  it('keeps only the latest value during rapid edits', () => {
    const { result } = renderHook(() => useRecipeDraft());

    act(() => {
      result.current.saveDraft(draftA);
      jest.advanceTimersByTime(1500);
      result.current.saveDraft(draftB);
      jest.advanceTimersByTime(3000);
    });

    expect(useDraftStore.getState().draft).toEqual(draftB);
  });

  it('clears saved drafts explicitly', () => {
    const { result } = renderHook(() => useRecipeDraft());

    act(() => {
      result.current.saveDraft(draftA);
      jest.advanceTimersByTime(3000);
    });
    expect(useDraftStore.getState().draft).toEqual(draftA);

    act(() => {
      result.current.clearDraft();
    });

    expect(useDraftStore.getState().draft).toBeNull();
    expect(useDraftStore.getState().updatedAt).toBeNull();
  });

  it('cancels pending debounce work when unmounted', () => {
    const { result, unmount } = renderHook(() => useRecipeDraft());

    act(() => {
      result.current.saveDraft(draftA);
    });
    unmount();

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(useDraftStore.getState().draft).toBeNull();
  });
});
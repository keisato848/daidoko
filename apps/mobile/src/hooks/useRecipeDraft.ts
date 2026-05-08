/**
 * Auto-save recipe draft to Zustand persist (3s debounce)
 */
import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';

import type { RecipeFormData } from '../validation/recipe.schema';

interface DraftState {
  draft: Partial<RecipeFormData> | null;
  updatedAt: number | null;
  setDraft: (data: Partial<RecipeFormData>) => void;
  clearDraft: () => void;
}

export const useDraftStore = create<DraftState>((set) => ({
  draft: null,
  updatedAt: null,
  setDraft: (data) => set({ draft: data, updatedAt: Date.now() }),
  clearDraft: () => set({ draft: null, updatedAt: null }),
}));

/**
 * Hook to auto-save form data as a draft with debouncing.
 * Returns functions to restore the draft and clear it.
 */
export function useRecipeDraft() {
  const { draft, setDraft, clearDraft } = useDraftStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveDraft = useCallback(
    (data: Partial<RecipeFormData>) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setDraft(data);
      }, 3000);
    },
    [setDraft],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    draft,
    saveDraft,
    clearDraft,
  };
}

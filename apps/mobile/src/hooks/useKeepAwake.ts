/**
 * Wrapper around expo-keep-awake
 * No-op on web where the API is not available
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useKeepAwake() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let deactivate: (() => void) | undefined;

    void (async () => {
      try {
        const { activateKeepAwakeAsync, deactivateKeepAwake } = await import('expo-keep-awake');
        await activateKeepAwakeAsync();
        deactivate = deactivateKeepAwake;
      } catch {
        // expo-keep-awake not available
      }
    })();

    return () => {
      deactivate?.();
    };
  }, []);
}

/**
 * テーマの状態（`'system' | 'light' | 'dark'`）と、解決済みのパレットを配る。
 *
 * 既定は `'system'` で、端末の表示設定に追従する（受付票 D8）。
 * 保存先は `app_meta`（SQLite）— コーチマークの既読と同じ置き場。**`expo-secure-store`
 * は使わない**。あちらは BYOK の API キーと同期の認証情報だけで、テーマの好みは秘密ではない。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import {
  getThemeMode,
  setThemeMode as persistThemeMode,
  type ThemeModeSetting,
} from '../services/app-meta.service';

import { darkColors, lightColors, type ThemePalette } from './colors';

export type ThemeMode = ThemeModeSetting;

export type ThemeContextType = {
  mode: ThemeMode;
  scheme: 'light' | 'dark';
  colors: ThemePalette;
  setMode: (mode: ThemeMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  /**
   * 端末が明示していないとき（`null`）は暗い方に寄せる。だいどこは黒基調で出荷して
   * きたので、判定できない端末で見た目が変わらない側に倒す。
   */
  const systemScheme = useColorScheme() ?? 'dark';
  const [mode, setModeState] = useState<ThemeMode>('system');

  // 保存値の読み出しは DB の準備が要るので非同期。読めるまでは既定（system）で描く。
  useEffect(() => {
    let cancelled = false;
    getThemeMode()
      .then((saved) => {
        if (!cancelled) setModeState(saved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const scheme = mode === 'system' ? systemScheme : mode;
  const colors = scheme === 'light' ? lightColors : darkColors;

  const setMode = useCallback(async (next: ThemeMode) => {
    setModeState(next);
    try {
      await persistThemeMode(next);
    } catch {
      // 保存に失敗しても表示は切り替わったままにする（次回起動で戻るだけ）
    }
  }, []);

  const value = useMemo(() => ({ mode, scheme, colors, setMode }), [mode, scheme, colors, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * テーマに追従する `StyleSheet` を作る。
 *
 * **`factory` はモジュール直下の定数にすること。** コンポーネントの中で
 * インラインの関数リテラルを渡すと、毎レンダーで識別子が変わって
 * `StyleSheet.create` を作り直すことになり、動的化した意味が無くなる。
 *
 * ```ts
 * const makeStyles = (c: ThemePalette) => ({ card: { backgroundColor: c.bgCard } });
 * // …コンポーネントの中で
 * const styles = useThemedStyles(makeStyles);
 * ```
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemePalette) => T,
): T {
  const { colors } = useTheme();
  return useMemo(() => StyleSheet.create(factory(colors)), [colors, factory]);
}

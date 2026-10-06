import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { darkPalette, elevationFor, lightPalette, type Palette } from './tokens';

export type AppearancePreference = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  colors: Palette;
  /** Soft shadows tinted for the current scheme (cards, floating chrome, hero). */
  elevation: ReturnType<typeof elevationFor>;
  scheme: 'light' | 'dark';
  preference: AppearancePreference;
  setPreference: (p: AppearancePreference) => void;
}

const STORAGE_KEY = 'cf.appearance';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<AppearancePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPreferenceState(v);
      })
      .catch(() => undefined);
  }, []);

  const setPreference = useCallback((p: AppearancePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => undefined);
  }, []);

  const scheme: 'light' | 'dark' =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(() => {
    const colors = scheme === 'dark' ? darkPalette : lightPalette;
    return { colors, elevation: elevationFor(colors.shadow), scheme, preference, setPreference };
  }, [scheme, preference, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

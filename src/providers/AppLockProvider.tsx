/**
 * Face ID / Touch ID app lock with device-passcode fallback.
 *
 * Privacy: whenever the app leaves the foreground (including the "inactive"
 * state iOS uses for the app switcher snapshot) an opaque cover is rendered
 * immediately, so financial data is never visible in the switcher or during
 * the transition to the locked state.
 */
import { BlurView } from 'expo-blur';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform, StyleSheet, View, type AppStateStatus } from 'react-native';

import { LockScreen } from '@/components/LockScreen';
import { useTheme } from '@/theme/ThemeProvider';

const LOCK_KEY = 'cf.app-lock.enabled';

interface AppLockContextValue {
  enabled: boolean;
  available: boolean;
  biometryLabel: string;
  setEnabled: (enabled: boolean) => Promise<boolean>;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

async function describeBiometry(): Promise<{ available: boolean; label: string }> {
  if (Platform.OS === 'web') return { available: false, label: 'Passcode' };
  const [hasHardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  const label = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    ? 'Face ID'
    : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
      ? 'Touch ID'
      : 'Passcode';
  // Device passcode alone is acceptable as a fallback.
  return { available: (hasHardware && enrolled) || level !== LocalAuthentication.SecurityLevel.NONE, label };
}

export function AppLockProvider({ children, active }: { children: ReactNode; active: boolean }) {
  const { colors, scheme } = useTheme();
  const [enabled, setEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const [available, setAvailable] = useState(false);
  const [biometryLabel, setBiometryLabel] = useState('Face ID');
  const authenticating = useRef(false);
  // Auto-prompt once per lock event (a cancelled prompt must not loop).
  const promptedForLock = useRef(false);
  const enabledRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [stored, bio] = await Promise.all([SecureStore.getItemAsync(LOCK_KEY), describeBiometry()]);
        const isOn = stored === '1' && bio.available;
        enabledRef.current = isOn;
        setEnabledState(isOn);
        setLocked(isOn); // lock on cold start
        setAvailable(bio.available);
        setBiometryLabel(bio.label);
      } catch {
        // Lock unavailable: fail open only if it was never enabled (handled above).
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Charan Finance',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });
      if (result.success) setLocked(false);
    } finally {
      authenticating.current = false;
    }
  }, []);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') {
        setCovered(false);
      } else {
        // 'inactive' (app switcher, Control Centre) and 'background'.
        setCovered(true);
        if (state === 'background' && enabledRef.current && !authenticating.current) {
          promptedForLock.current = false;
          setLocked(true);
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    // Require a successful authentication to turn the lock on or off.
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: next ? 'Enable app lock' : 'Disable app lock',
      disableDeviceFallback: false,
    });
    if (!result.success) return false;
    await SecureStore.setItemAsync(LOCK_KEY, next ? '1' : '0');
    enabledRef.current = next;
    setEnabledState(next);
    return true;
  }, []);

  const value = useMemo(
    () => ({ enabled, available, biometryLabel, setEnabled }),
    [enabled, available, biometryLabel, setEnabled],
  );

  const showLock = active && loaded && enabled && locked;

  useEffect(() => {
    if (showLock && !covered && !promptedForLock.current) {
      promptedForLock.current = true;
      void unlock();
    }
  }, [showLock, covered, unlock]);
  const hideContent = !loaded || showLock || covered;

  return (
    <AppLockContext.Provider value={value}>
      <View style={styles.fill}>
        {children}
        {hideContent && !showLock ? (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            pointerEvents="none"
          >
            {Platform.OS === 'ios' ? (
              <BlurView intensity={60} tint={scheme} style={StyleSheet.absoluteFill} />
            ) : null}
          </View>
        ) : null}
        {showLock ? (
          <View style={StyleSheet.absoluteFill}>
            <LockScreen label={biometryLabel} onUnlock={() => void unlock()} />
          </View>
        ) : null}
      </View>
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockContextValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used inside AppLockProvider');
  return ctx;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

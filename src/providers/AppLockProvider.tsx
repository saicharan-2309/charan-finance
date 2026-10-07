/**
 * App lock: Face ID and an app passcode, each switched on separately in
 * Security. The app locks when it goes to the background if either is on.
 *
 *   · Face ID (Touch ID on older iPhones) through expo-local-authentication,
 *     with the iPhone passcode as the system fallback.
 *   · App passcode: a 6-digit code just for BUD, checked against a
 *     salted, stretched hash in the Keychain, with escalating lockouts after
 *     five wrong attempts (see lib/passcode and services/app-passcode).
 *   · Both on: Face ID is offered first; the keypad is always there as the
 *     alternative. "Forgot passcode?" signs out on this device — signing back
 *     in with the account password is the recovery path.
 *
 * Expo Go cannot use Face ID: iOS only allows Face ID in an app that declares
 * it (NSFaceIDUsageDescription), and inside Expo Go the running app is Expo's,
 * so iOS shows the iPhone passcode instead. In an installed build Face ID
 * works. The Security screen says which applies. The app passcode works
 * everywhere, Expo Go included.
 *
 * Privacy: whenever the app leaves the foreground (including the "inactive"
 * state iOS uses for the app switcher snapshot) an opaque cover is rendered
 * immediately, so financial data is never visible in the switcher.
 */
import { isRunningInExpoGo } from 'expo';
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
import {
  hasAppPasscode,
  removeAppPasscode,
  saveAppPasscode,
  verifyAppPasscode,
  type VerifyResult,
} from '@/services/app-passcode';
import { signOutThisDevice } from '@/services/auth';
import { useTheme } from '@/theme/ThemeProvider';

/** Kept from the first version of app lock: "1" means Face ID / device authentication is on. */
const BIOMETRICS_KEY = 'cf.app-lock.enabled';

interface AppLockContextValue {
  /** Either method is on. */
  enabled: boolean;
  biometricsEnabled: boolean;
  passcodeEnabled: boolean;
  /** Face ID, Touch ID or at least an iPhone passcode is set up on this device. */
  available: boolean;
  biometryLabel: 'Face ID' | 'Touch ID' | 'Passcode';
  /** True in Expo Go on iOS, where Face ID is unavailable and the iPhone passcode is used. */
  faceIdNeedsInstalledApp: boolean;
  /** Turning Face ID on or off requires a successful Face ID / iPhone passcode check. */
  setBiometricsEnabled: (next: boolean) => Promise<boolean>;
  /** Saves a new app passcode (the caller validates it and, when changing, checks the old one). */
  savePasscode: (code: string) => Promise<void>;
  removePasscode: () => Promise<void>;
  verifyPasscode: (code: string) => Promise<VerifyResult>;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

const FACE_ID_BLOCKED = Platform.OS === 'ios' && isRunningInExpoGo();

async function describeBiometry(): Promise<{
  available: boolean;
  label: AppLockContextValue['biometryLabel'];
}> {
  if (Platform.OS === 'web') return { available: false, label: 'Passcode' };
  const [hasHardware, enrolled, types, level] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
    LocalAuthentication.getEnrolledLevelAsync(),
  ]);
  const label = FACE_ID_BLOCKED
    ? 'Passcode'
    : types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      ? 'Face ID'
      : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ? 'Touch ID'
        : 'Passcode';
  // The device passcode alone is acceptable as the system fallback.
  return { available: (hasHardware && enrolled) || level !== LocalAuthentication.SecurityLevel.NONE, label };
}

export function AppLockProvider({ children, active }: { children: ReactNode; active: boolean }) {
  const { colors, scheme } = useTheme();
  const [biometricsEnabled, setBiometricsState] = useState(false);
  const [passcodeEnabled, setPasscodeState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const [available, setAvailable] = useState(false);
  const [biometryLabel, setBiometryLabel] = useState<AppLockContextValue['biometryLabel']>('Face ID');
  const authenticating = useRef(false);
  // Auto-prompt Face ID once per lock event (a cancelled prompt must not loop).
  const promptedForLock = useRef(false);
  const enabledRef = useRef(false);
  const enabled = biometricsEnabled || passcodeEnabled;

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    (async () => {
      try {
        const [stored, bio, pin] = await Promise.all([
          SecureStore.getItemAsync(BIOMETRICS_KEY),
          describeBiometry(),
          hasAppPasscode(),
        ]);
        const bioOn = stored === '1' && bio.available;
        setBiometricsState(bioOn);
        setPasscodeState(pin);
        enabledRef.current = bioOn || pin;
        setLocked(bioOn || pin); // lock on cold start
        setAvailable(bio.available);
        setBiometryLabel(bio.label);
      } catch {
        // Storage or biometry unavailable (e.g. web preview): no lock.
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const unlockWithBiometrics = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock BUD',
        fallbackLabel: 'Use iPhone passcode',
        disableDeviceFallback: false,
        cancelLabel: passcodeEnabled ? 'Use app passcode' : 'Cancel',
      });
      if (result.success) setLocked(false);
    } finally {
      authenticating.current = false;
    }
  }, [passcodeEnabled]);

  const unlockWithPasscode = useCallback(async (code: string) => {
    const result = await verifyAppPasscode(code);
    if (result.ok) setLocked(false);
    return result;
  }, []);

  const forgotPasscode = useCallback(async () => {
    await removeAppPasscode();
    setPasscodeState(false);
    setLocked(false);
    await signOutThisDevice();
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

  const setBiometricsEnabled = useCallback(async (next: boolean) => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: next ? 'Turn on Face ID for BUD' : 'Turn off Face ID for BUD',
      disableDeviceFallback: false,
    });
    if (!result.success) return false;
    await SecureStore.setItemAsync(BIOMETRICS_KEY, next ? '1' : '0');
    setBiometricsState(next);
    return true;
  }, []);

  const savePasscode = useCallback(async (code: string) => {
    await saveAppPasscode(code);
    setPasscodeState(true);
  }, []);

  const removePasscode = useCallback(async () => {
    await removeAppPasscode();
    setPasscodeState(false);
  }, []);

  const value = useMemo<AppLockContextValue>(
    () => ({
      enabled,
      biometricsEnabled,
      passcodeEnabled,
      available,
      biometryLabel,
      faceIdNeedsInstalledApp: FACE_ID_BLOCKED,
      setBiometricsEnabled,
      savePasscode,
      removePasscode,
      verifyPasscode: verifyAppPasscode,
    }),
    [
      enabled,
      biometricsEnabled,
      passcodeEnabled,
      available,
      biometryLabel,
      setBiometricsEnabled,
      savePasscode,
      removePasscode,
    ],
  );

  const showLock = active && loaded && enabled && locked;

  useEffect(() => {
    if (showLock && biometricsEnabled && !covered && !promptedForLock.current) {
      promptedForLock.current = true;
      void unlockWithBiometrics();
    }
  }, [showLock, biometricsEnabled, covered, unlockWithBiometrics]);
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
            <LockScreen
              biometryLabel={biometricsEnabled ? biometryLabel : null}
              passcode={passcodeEnabled}
              onBiometrics={() => void unlockWithBiometrics()}
              onPasscode={unlockWithPasscode}
              onForgot={forgotPasscode}
            />
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

/**
 * `useAnimatedValue` — a stable Animated.Value for the life of a component.
 *
 * React Native ships its own, but `react-native-web` does not export it, so
 * anything using the React Native version crashes in a web build. This is the
 * same thing in four lines, lives in one place, and works on every platform.
 *
 * It is written with lazy `useState` rather than `useRef(new Animated.Value())`
 * so nothing is constructed during render — the React Compiler rejects the
 * ref form as impure.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

export function useAnimatedValue(initial: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initial));
  return value;
}

/** True while the system "Reduce Motion" setting is on. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

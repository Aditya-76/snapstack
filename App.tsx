/**
 * Screenshot Brain — your screenshots, finally searchable and actionable.
 * 100% on-device.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AppState, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startCapture } from './src/capture/captureService';
import { AppNavigator } from './src/navigation';
import { LockScreen } from './src/screens/LockScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { useAppStore } from './src/store/appStore';
import { colors } from './src/theme';

function App() {
  const [ready, setReady] = useState(false);
  const { settings, unlocked, setUnlocked, loadSettings, refreshLibrary, refreshReminders } = useAppStore();
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    void (async () => {
      await loadSettings();
      const s = useAppStore.getState().settings;
      if (!s.appLockEnabled) {
        setUnlocked(true);
      }
      if (s.onboardingCompleted) {
        await startCapture();
        await Promise.all([refreshLibrary(), refreshReminders()]);
      }
      setReady(true);
    })();
  }, [loadSettings, refreshLibrary, refreshReminders, setUnlocked]);

  // Re-arm the lock when the app leaves the foreground (PRD §7.7).
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (useAppStore.getState().settings.appLockEnabled && prev === 'active' && next !== 'active') {
        setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, [setUnlocked]);

  if (!ready) {
    return <View style={styles.splash} />;
  }

  const locked = settings.appLockEnabled && !unlocked;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      {locked ? (
        <LockScreen onUnlocked={() => setUnlocked(true)} />
      ) : settings.onboardingCompleted ? (
        <AppNavigator />
      ) : (
        <OnboardingScreen onComplete={() => useAppStore.setState(s => ({ settings: { ...s.settings } }))} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.background },
});

export default App;

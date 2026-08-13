/**
 * Screenshot Brain — your screenshots, finally searchable and actionable.
 * 100% on-device.
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startCapture } from './src/capture/captureService';
import { AppNavigator } from './src/navigation';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { useAppStore } from './src/store/appStore';
import { colors } from './src/theme';

function App() {
  const [ready, setReady] = useState(false);
  const { settings, loadSettings, refreshLibrary, refreshReminders } = useAppStore();

  useEffect(() => {
    void (async () => {
      await loadSettings();
      const s = useAppStore.getState().settings;
      if (s.onboardingCompleted) {
        await startCapture();
        await Promise.all([refreshLibrary(), refreshReminders()]);
      }
      setReady(true);
    })();
  }, [loadSettings, refreshLibrary, refreshReminders]);

  if (!ready) {
    return <View style={styles.splash} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      {settings.onboardingCompleted ? (
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

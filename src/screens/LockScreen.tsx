/**
 * App lock (PRD §7.7): shown over everything until biometric/device-credential
 * auth succeeds. Re-arms when the app goes to background.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppLock } from '../native';
import { colors, radius, spacing, typography } from '../theme';

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [failed, setFailed] = useState(false);

  const tryUnlock = useCallback(async () => {
    if (!AppLock) {
      // Module missing (e.g. dev build): don't brick the app.
      onUnlocked();
      return;
    }
    setFailed(false);
    try {
      const ok = await AppLock.authenticate('Unlock Screenshot Brain');
      if (ok) {
        onUnlocked();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
  }, [onUnlocked]);

  useEffect(() => {
    void tryUnlock();
  }, [tryUnlock]);

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔒</Text>
      <Text style={typography.heading}>Screenshot Brain is locked</Text>
      {failed ? <Text style={styles.hint}>Authentication didn't complete.</Text> : null}
      <TouchableOpacity
        style={styles.button}
        onPress={() => void tryUnlock()}
        accessibilityRole="button"
        accessibilityLabel="Unlock with biometrics"
      >
        <Text style={styles.buttonText}>Unlock</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  icon: { fontSize: 56 },
  hint: { ...typography.secondary, color: colors.warning },
  button: {
    backgroundColor: colors.accentStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xxl,
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

/**
 * Onboarding (PRD §4.1): privacy explainer → photo permission → optional
 * backfill window → optional model download. Copy is honest about the iOS
 * background-processing gap (§7.1).
 */

import React, { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components';
import { getStore } from '../db';
import { ScreenshotObserver } from '../native';
import { backfill, backfillSinceMs } from '../pipeline/pipeline';
import { startCapture } from '../capture/captureService';
import { useAppStore } from '../store/appStore';
import { colors, radius, spacing, typography } from '../theme';
import { BackfillWindow } from '../types';

type Step = 'privacy' | 'permission' | 'backfill' | 'done';

const BACKFILL_OPTIONS: Array<{ value: BackfillWindow; label: string; hint: string }> = [
  { value: 'last_30_days', label: 'Last 30 days', hint: 'Quick — a few minutes' },
  { value: 'last_6_months', label: 'Last 6 months', hint: 'Recommended' },
  { value: 'all', label: 'Everything', hint: 'Runs in the background, best while charging' },
  { value: 'none', label: 'Skip for now', hint: 'Only new screenshots will be indexed' },
];

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>('privacy');
  const [progress, setProgress] = useState<string | null>(null);
  const { settings, updateSettings } = useAppStore();

  const requestPermission = async () => {
    if (!ScreenshotObserver) {
      // Simulator / test build without native module: continue anyway.
      setStep('backfill');
      return;
    }
    const status = await ScreenshotObserver.requestPermission();
    if (status === 'denied') {
      Alert.alert(
        'Permission needed',
        'Screenshot Brain only reads your screenshots, on this phone. You can grant access anytime from system settings.',
      );
      return;
    }
    setStep('backfill');
  };

  const chooseBackfill = async (window: BackfillWindow) => {
    await updateSettings({ backfillWindow: window });
    if (window !== 'none' && ScreenshotObserver) {
      setProgress('Scanning your screenshots…');
      try {
        const store = await getStore();
        const assets = await ScreenshotObserver.listScreenshots(backfillSinceMs(window), 10000, 0);
        await backfill(store, assets, { ...settings, backfillWindow: window }, p =>
          setProgress(`Indexed ${p.processed} of ${p.total}`),
        );
      } catch (e) {
        console.warn('[onboarding] backfill failed', e);
      }
      setProgress(null);
    }
    setStep('done');
  };

  const finish = async () => {
    await updateSettings({ onboardingCompleted: true });
    await startCapture();
    onComplete();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {step === 'privacy' ? (
          <View style={styles.step}>
            <Text style={styles.emoji}>🔒</Text>
            <Text style={typography.title}>Nothing ever leaves your phone</Text>
            <Text style={styles.body}>
              Screenshot Brain reads the text inside your screenshots — bills, bookings, coupons, UPI payments — and
              makes them searchable and actionable.
            </Text>
            <View style={styles.pledge}>
              {[
                'All processing happens on-device',
                'No account. No cloud. No analytics on your content',
                'Your photos are never copied or uploaded',
                'Free. Never monetized with your data',
              ].map(line => (
                <Text key={line} style={styles.pledgeLine}>
                  ✓ {line}
                </Text>
              ))}
            </View>
            <PrimaryButton label="Continue" onPress={() => setStep('permission')} />
          </View>
        ) : null}

        {step === 'permission' ? (
          <View style={styles.step}>
            <Text style={styles.emoji}>🖼</Text>
            <Text style={typography.title}>Allow access to screenshots</Text>
            <Text style={styles.body}>
              {Platform.OS === 'ios'
                ? 'You can limit access to just your screenshots. New screenshots are processed when you open the app or in background refresh windows.'
                : 'We watch the Screenshots folder and index new screenshots in near-real-time.'}
            </Text>
            <PrimaryButton label="Grant access" onPress={() => void requestPermission()} />
            <TouchableOpacity onPress={() => setStep('backfill')}>
              <Text style={styles.skip}>Not now</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {step === 'backfill' ? (
          <View style={styles.step}>
            <Text style={styles.emoji}>📦</Text>
            <Text style={typography.title}>Index your existing screenshots?</Text>
            <Text style={styles.body}>Choose how far back to scan. You can always do this later from Settings.</Text>
            {progress ? (
              <Text style={styles.progress}>{progress}</Text>
            ) : (
              BACKFILL_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.value} style={styles.option} onPress={() => void chooseBackfill(opt.value)}>
                  <Text style={typography.body}>{opt.label}</Text>
                  <Text style={typography.caption}>{opt.hint}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        ) : null}

        {step === 'done' ? (
          <View style={styles.step}>
            <Text style={styles.emoji}>✨</Text>
            <Text style={typography.title}>You're set</Text>
            <Text style={styles.body}>
              Search works right away. To ask questions in plain language ("how much was my electricity bill?"),
              download the optional on-device Q&A model from Settings — about 400 MB, one time.
            </Text>
            <PrimaryButton label="Start using Screenshot Brain" onPress={() => void finish()} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  step: { gap: spacing.lg },
  emoji: { fontSize: 48 },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
  pledge: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  pledgeLine: { color: colors.success, fontSize: 14 },
  option: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  skip: { color: colors.textTertiary, textAlign: 'center', fontSize: 14, paddingVertical: spacing.sm },
  progress: { ...typography.body, color: colors.accent, textAlign: 'center', paddingVertical: spacing.lg },
});

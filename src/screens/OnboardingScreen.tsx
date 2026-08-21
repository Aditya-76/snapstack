/**
 * Onboarding (PRD §4.1): privacy explainer → photo permission → optional
 * backfill window → optional model download. Copy is honest about the iOS
 * background-processing gap (§7.1). Backfill runs in the background — the
 * user lands in the app immediately and watches progress from the Search tab.
 */

import React, { useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components';
import { ScreenshotObserver } from '../native';
import { startCapture } from '../capture/captureService';
import { useAppStore } from '../store/appStore';
import { colors, radius, spacing, typography } from '../theme';
import { BackfillWindow } from '../types';

type Step = 'privacy' | 'permission' | 'backfill' | 'done';

const BACKFILL_OPTIONS: Array<{ value: BackfillWindow; label: string; hint: string }> = [
  { value: 'last_30_days', label: 'Last 30 days', hint: 'Quick — a few minutes' },
  { value: 'last_6_months', label: 'Last 6 months', hint: 'Recommended' },
  { value: 'all', label: 'Everything', hint: 'Continues in the background — best on charge' },
  { value: 'none', label: 'Skip for now', hint: 'Only new screenshots will be indexed' },
];

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>('privacy');
  const [permissionGranted, setPermissionGranted] = useState(false);
  const { updateSettings, startBackfill, startLlmDownload } = useAppStore();

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
        'Screenshot Brain only reads your screenshots, and only on this phone. Without access it has nothing to index.',
        [
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          { text: 'Not now', style: 'cancel' },
        ],
      );
      return;
    }
    setPermissionGranted(true);
    if (status === 'limited') {
      Alert.alert(
        'Limited access',
        'Only the photos you selected will be indexed. You can widen the selection anytime from system settings.',
      );
    }
    setStep('backfill');
  };

  const chooseBackfill = async (window: BackfillWindow) => {
    await updateSettings({ backfillWindow: window });
    if (window !== 'none') {
      // Non-blocking: progress shows in the Search tab banner.
      void startBackfill(window);
    }
    setStep('done');
  };

  const finish = async (withLlmDownload: boolean) => {
    await updateSettings({ onboardingCompleted: true });
    await startCapture();
    if (withLlmDownload) {
      try {
        await startLlmDownload();
      } catch (e) {
        Alert.alert('Download unavailable', e instanceof Error ? e.message : String(e));
      }
    }
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
                : 'We watch the Screenshots folder and index new screenshots while the app is running, plus a catch-up scan every time you open it.'}
            </Text>
            <PrimaryButton label="Grant access" onPress={() => void requestPermission()} />
            <TouchableOpacity
              onPress={() => setStep('done')}
              accessibilityRole="button"
              accessibilityLabel="Skip granting access for now"
              style={styles.skipTouchable}
            >
              <Text style={styles.skip}>Not now — I'll do it later from Settings</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {step === 'backfill' ? (
          <View style={styles.step}>
            <Text style={styles.emoji}>📦</Text>
            <Text style={typography.title}>Index your existing screenshots?</Text>
            <Text style={styles.body}>
              Choose how far back to scan. Indexing continues in the background — you can start using the app right
              away and watch progress on the Search tab.
            </Text>
            {BACKFILL_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={styles.option}
                onPress={() => void chooseBackfill(opt.value)}
                accessibilityRole="button"
                accessibilityLabel={`${opt.label}. ${opt.hint}`}
              >
                <Text style={typography.body}>{opt.label}</Text>
                <Text style={typography.caption}>{opt.hint}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {step === 'done' ? (
          <View style={styles.step}>
            <Text style={styles.emoji}>✨</Text>
            <Text style={typography.title}>You're set</Text>
            <Text style={styles.body}>
              {permissionGranted
                ? 'Search works right away. To ask questions in plain language ("how much was my electricity bill?"), add the optional on-device Q&A model — a one-time ~400 MB download that stays on your phone.'
                : 'You can grant screenshot access anytime from Settings — until then the app has nothing to index. The optional Q&A model (~400 MB, on-device) can also be added later.'}
            </Text>
            <PrimaryButton label="Start using Screenshot Brain" onPress={() => void finish(false)} />
            <TouchableOpacity
              onPress={() => void finish(true)}
              accessibilityRole="button"
              accessibilityLabel="Start and download the Q&A model, about 400 megabytes"
              style={styles.secondaryOption}
            >
              <Text style={styles.secondaryOptionText}>Start + download Q&A model (~400 MB, Wi-Fi)</Text>
            </TouchableOpacity>
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
  skipTouchable: { minHeight: 44, justifyContent: 'center' },
  skip: { color: colors.textSecondary, textAlign: 'center', fontSize: 14 },
  secondaryOption: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryOptionText: { color: colors.accent, fontWeight: '600', fontSize: 14 },
});

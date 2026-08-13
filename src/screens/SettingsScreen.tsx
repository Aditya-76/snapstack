/**
 * Settings (PRD §4.5 auto mode per category, §6 retention & lite mode,
 * §7.2 staged LLM download, §7.7 app lock + sensitive previews).
 */

import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStore } from '../db';
import { Ml, ScreenshotObserver } from '../native';
import { backfill, backfillSinceMs } from '../pipeline/pipeline';
import { useAppStore } from '../store/appStore';
import { colors, radius, spacing, typography } from '../theme';
import { ALL_CATEGORIES, BackfillWindow, CATEGORY_LABELS } from '../types';

const REMINDER_CATEGORIES = ALL_CATEGORIES.filter(c => ['bill', 'payment', 'booking', 'code_coupon'].includes(c));

const BACKFILL_LABELS: Record<Exclude<BackfillWindow, 'none'>, string> = {
  last_30_days: 'Last 30 days',
  last_6_months: 'Last 6 months',
  all: 'Everything',
};

export function SettingsScreen() {
  const { settings, updateSettings, toggleAutoReminders, refreshLibrary } = useAppStore();
  const [backfillProgress, setBackfillProgress] = useState<string | null>(null);
  const [llmProgress, setLlmProgress] = useState<number | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (llmProgress != null && llmProgress < 1 && Ml) {
      timer = setInterval(async () => {
        try {
          const p = await Ml.getLlmDownloadProgress();
          setLlmProgress(p);
          if (p >= 1) {
            await updateSettings({ llmPackInstalled: true });
          }
        } catch {
          // download not running
        }
      }, 1000);
    }
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [llmProgress, updateSettings]);

  const runBackfill = async (window: Exclude<BackfillWindow, 'none'>) => {
    if (!ScreenshotObserver) {
      Alert.alert('Unavailable', 'Gallery access is not available on this device/build.');
      return;
    }
    setBackfillProgress('Scanning gallery…');
    try {
      const store = await getStore();
      const assets = await ScreenshotObserver.listScreenshots(backfillSinceMs(window), 10000, 0);
      await backfill(store, assets, settings, p => {
        setBackfillProgress(`Indexed ${p.processed}/${p.total}`);
      });
      setBackfillProgress(null);
      await refreshLibrary();
      Alert.alert('Done', `Indexed ${assets.length} screenshots.`);
    } catch (e) {
      setBackfillProgress(null);
      Alert.alert('Backfill failed', String(e));
    }
  };

  const downloadLlm = async () => {
    if (!Ml) {
      Alert.alert('Unavailable', 'The Q&A model needs a supported device (4 GB+ RAM).');
      return;
    }
    try {
      await Ml.downloadLlmPack();
      setLlmProgress(0);
    } catch (e) {
      Alert.alert('Download failed', String(e));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>Settings</Text>

        <Section title="Privacy">
          <Text style={styles.privacyNote}>
            All processing happens on this phone. No accounts, no servers, no analytics on your content.
          </Text>
          <ToggleRow
            label="App lock (biometric)"
            value={settings.appLockEnabled}
            onChange={v => void updateSettings({ appLockEnabled: v })}
          />
          <ToggleRow
            label="Show previews for ID documents"
            sublabel="Aadhaar/PAN previews stay hidden in search unless enabled"
            value={settings.showSensitivePreviews}
            onChange={v => void updateSettings({ showSensitivePreviews: v })}
          />
        </Section>

        <Section title="Automatic reminders">
          <Text style={typography.secondary}>
            When enabled for a category, reminders are created without asking. Every automatic action appears in the
            Activity log and can be undone.
          </Text>
          {REMINDER_CATEGORIES.map(cat => (
            <ToggleRow
              key={cat}
              label={CATEGORY_LABELS[cat]}
              value={settings.autoRemindersByCategory[cat] === true}
              onChange={v => void toggleAutoReminders(cat, v)}
            />
          ))}
        </Section>

        <Section title="Q&A model">
          <Text style={typography.secondary}>
            {settings.llmPackInstalled
              ? 'On-device Q&A model installed.'
              : 'Search works out of the box. Download the optional on-device model (~400 MB) to enable Q&A chat.'}
          </Text>
          {!settings.llmPackInstalled ? (
            llmProgress != null && llmProgress < 1 ? (
              <Text style={styles.progress}>Downloading… {Math.round(llmProgress * 100)}%</Text>
            ) : (
              <ActionRow label="Download Q&A model" onPress={() => void downloadLlm()} />
            )
          ) : null}
        </Section>

        <Section title="Index existing screenshots">
          {backfillProgress ? (
            <Text style={styles.progress}>{backfillProgress}</Text>
          ) : (
            (Object.keys(BACKFILL_LABELS) as Array<Exclude<BackfillWindow, 'none'>>).map(w => (
              <ActionRow key={w} label={BACKFILL_LABELS[w]} onPress={() => void runBackfill(w)} />
            ))
          )}
        </Section>

        <Section title="Storage">
          <ToggleRow
            label="Lite mode (no thumbnails)"
            sublabel="Saves ~10–15 KB per screenshot"
            value={settings.thumbnailQuality === 'off'}
            onChange={v => void updateSettings({ thumbnailQuality: v ? 'off' : 'normal' })}
          />
          <Text style={typography.caption}>
            We never copy your photos — only extracted text, small thumbnails and search vectors are stored (≈15–20 KB
            per screenshot).
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ToggleRow({
  label,
  sublabel,
  value,
  onChange,
}: {
  label: string;
  sublabel?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={typography.body}>{label}</Text>
        {sublabel ? <Text style={typography.caption}>{sublabel}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}

function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress}>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: { ...typography.caption, textTransform: 'uppercase', letterSpacing: 1 },
  privacyNote: { ...typography.secondary, color: colors.success },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionLabel: { color: colors.accent, fontSize: 15 },
  progress: { ...typography.secondary, color: colors.accent },
});

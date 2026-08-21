/**
 * Settings (PRD §4.5 auto mode per category, §6 retention/lite-mode/backup,
 * §7.2 staged LLM download, §7.7 app lock + sensitive previews).
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppLock, Backup, Ml, ScreenshotObserver } from '../native';
import { useAppStore } from '../store/appStore';
import { colors, radius, spacing, typography } from '../theme';
import { ALL_CATEGORIES, BackfillWindow, CATEGORY_LABELS } from '../types';

const REMINDER_CATEGORIES = ALL_CATEGORIES.filter(c => ['bill', 'payment', 'booking', 'code_coupon'].includes(c));

const BACKFILL_LABELS: Record<Exclude<BackfillWindow, 'none'>, string> = {
  last_30_days: 'Last 30 days',
  last_6_months: 'Last 6 months',
  all: 'Everything',
};

const PURGE_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Keep forever', value: null },
  { label: 'Purge after 30 days', value: 30 },
  { label: 'Purge after 90 days', value: 90 },
];

export function SettingsScreen() {
  const {
    settings,
    backfillRunning,
    backfillProcessed,
    backfillTotal,
    llmDownloadProgress,
    updateSettings,
    toggleAutoReminders,
    startBackfill,
    startLlmDownload,
    pollLlmDownload,
    exportBackup,
    importBackup,
  } = useAppStore();
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [lockAvailable, setLockAvailable] = useState(false);

  useEffect(() => {
    void (async () => {
      if (AppLock) {
        try {
          setLockAvailable(await AppLock.isAvailable());
        } catch {
          setLockAvailable(false);
        }
      }
    })();
    // Resume the progress UI if a download is already running.
    if (llmDownloadProgress != null && llmDownloadProgress < 1) {
      void pollLlmDownload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmLlmDownload = () => {
    Alert.alert('Download Q&A model?', '~400 MB, one time. Wi-Fi recommended. The model stays on your phone.', [
      {
        text: 'Download',
        onPress: () => {
          void startLlmDownload().catch(e =>
            Alert.alert('Download unavailable', e instanceof Error ? e.message : String(e)),
          );
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toggleAppLock = async (enabled: boolean) => {
    if (enabled && AppLock) {
      const ok = await AppLock.authenticate('Confirm to enable app lock');
      if (!ok) {
        return;
      }
    }
    await updateSettings({ appLockEnabled: enabled });
  };

  const runExport = async () => {
    if (backupPassphrase.length < 4) {
      Alert.alert('Choose a passphrase', 'At least 4 characters. You will need it to restore the backup.');
      return;
    }
    setBackupBusy(true);
    try {
      await exportBackup(backupPassphrase);
    } catch (e) {
      Alert.alert('Backup failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBackupBusy(false);
    }
  };

  const runImport = async () => {
    if (backupPassphrase.length < 4) {
      Alert.alert('Enter the passphrase', 'Type the passphrase the backup was created with, then tap Restore.');
      return;
    }
    setBackupBusy(true);
    try {
      const result = await importBackup(backupPassphrase);
      if (result) {
        Alert.alert('Restored', `${result.screenshots} screenshots and ${result.reminders} reminders imported.`);
      }
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.title}>Settings</Text>

        <Section title="Privacy">
          <Text style={styles.privacyNote}>
            All processing happens on this phone. The database is encrypted at rest with a key held in your device's
            secure keystore. No accounts, no servers, no analytics on your content.
          </Text>
          <ToggleRow
            label="App lock (biometric)"
            sublabel={lockAvailable ? 'Require Face ID / fingerprint to open the app' : 'No biometrics enrolled on this device'}
            value={settings.appLockEnabled}
            disabled={!lockAvailable}
            onChange={v => void toggleAppLock(v)}
          />
          <ToggleRow
            label="Show previews for ID documents"
            sublabel="Aadhaar/PAN stay searchable, but previews are masked unless enabled"
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
          {settings.llmPackInstalled ? (
            <Text style={typography.secondary}>On-device Q&A model installed.</Text>
          ) : Ml == null ? (
            <Text style={typography.secondary}>
              The Q&A model needs a supported device (4 GB+ RAM). Search, totals and reminders work fully without it.
            </Text>
          ) : llmDownloadProgress != null && llmDownloadProgress < 1 ? (
            <Text style={styles.progress}>Downloading… {Math.round(llmDownloadProgress * 100)}%</Text>
          ) : (
            <>
              <Text style={typography.secondary}>
                Search works out of the box. Add the optional on-device model to ask free-form questions.
              </Text>
              <ActionRow label="Download Q&A model (~400 MB)" onPress={confirmLlmDownload} />
            </>
          )}
        </Section>

        <Section title="Index existing screenshots">
          {!ScreenshotObserver ? (
            <Text style={typography.secondary}>Gallery access is not available on this build.</Text>
          ) : backfillRunning ? (
            <Text style={styles.progress}>
              Indexing… {backfillTotal > 0 ? `${backfillProcessed}/${backfillTotal}` : 'scanning gallery'}
            </Text>
          ) : (
            (Object.keys(BACKFILL_LABELS) as Array<Exclude<BackfillWindow, 'none'>>).map(w => (
              <ActionRow key={w} label={BACKFILL_LABELS[w]} onPress={() => void startBackfill(w)} />
            ))
          )}
        </Section>

        <Section title="Backup & restore">
          <Text style={typography.secondary}>
            Your extracted data (not your photos) is encrypted with a passphrase you choose, then handed to the share
            sheet — save it to Google Drive, iCloud Drive or anywhere you own. Restore it on a new device with the
            same passphrase.
          </Text>
          <TextInput
            style={styles.passphraseInput}
            placeholder="Backup passphrase"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            value={backupPassphrase}
            onChangeText={setBackupPassphrase}
            accessibilityLabel="Backup passphrase"
          />
          {Backup == null ? (
            <Text style={typography.caption}>Backup transport is unavailable on this build.</Text>
          ) : backupBusy ? (
            <Text style={styles.progress}>Working…</Text>
          ) : (
            <>
              <ActionRow label="Export encrypted backup" onPress={() => void runExport()} />
              <ActionRow label="Restore from backup" onPress={() => void runImport()} />
            </>
          )}
        </Section>

        <Section title="Storage">
          <ToggleRow
            label="Lite mode (no thumbnails)"
            sublabel="Saves ~10–15 KB per screenshot"
            value={settings.thumbnailQuality === 'off'}
            onChange={v => void updateSettings({ thumbnailQuality: v ? 'off' : 'normal' })}
          />
          <Text style={typography.secondary}>If a screenshot is deleted from your gallery:</Text>
          {PURGE_OPTIONS.map(opt => (
            <TouchableOpacity
              key={String(opt.value)}
              style={styles.radioRow}
              onPress={() => void updateSettings({ purgeAfterOriginalDeletedDays: opt.value })}
              accessibilityRole="radio"
              accessibilityState={{ selected: settings.purgeAfterOriginalDeletedDays === opt.value }}
              accessibilityLabel={`Extracted data: ${opt.label}`}
            >
              <Text style={styles.radioMark}>{settings.purgeAfterOriginalDeletedDays === opt.value ? '●' : '○'}</Text>
              <Text style={typography.body}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
          <Text style={typography.caption}>
            We never copy your photos — only extracted text, a small thumbnail and search data (≈20–25 KB per
            screenshot).
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
  disabled,
  onChange,
}: {
  label: string;
  sublabel?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.disabledRow]}>
      <View style={styles.toggleLabels}>
        <Text style={typography.body}>{label}</Text>
        {sublabel ? <Text style={typography.caption}>{sublabel}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.accentStrong }}
        thumbColor="#fff"
        accessibilityLabel={label}
      />
    </View>
  );
}

function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  toggleLabels: { flex: 1 },
  disabledRow: { opacity: 0.5 },
  actionRow: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionLabel: { color: colors.accent, fontSize: 15 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  radioMark: { color: colors.accent, fontSize: 16 },
  progress: { ...typography.secondary, color: colors.accent },
  passphraseInput: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    fontSize: 15,
  },
});

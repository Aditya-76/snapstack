/**
 * Screenshot detail view (PRD §4.4, §4.6): extracted data, quick actions
 * (copy code, call, maps), open-in-gallery (Android) / in-app viewer note
 * (iOS), and "original deleted" state.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Clipboard,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CategoryBadge, PrimaryButton } from '../components';
import { getStore } from '../db';
import { ScreenshotObserver } from '../native';
import { availableQuickActions, detectActions } from '../reminders/engine';
import { useAppStore } from '../store/appStore';
import { colors, radius, spacing, typography } from '../theme';
import { Entity, ScreenshotRecord } from '../types';

const ENTITY_LABELS: Record<Entity['type'], string> = {
  amount: 'Amount',
  date: 'Date',
  due_date: 'Due date',
  merchant: 'Merchant',
  booking_id: 'Booking / PNR',
  phone: 'Phone',
  address: 'Address',
  coupon_code: 'Coupon code',
  coupon_expiry: 'Coupon expiry',
  upi_id: 'UPI ID',
  transaction_id: 'Transaction ID',
  email: 'Email',
  tracking_id: 'Tracking ID',
};

export function DetailScreen({
  route,
}: {
  route: { params: { screenshotId: string } };
}) {
  const { screenshotId } = route.params;
  const [record, setRecord] = useState<ScreenshotRecord | null>(null);
  const { refreshReminders } = useAppStore();

  useEffect(() => {
    void (async () => {
      const store = await getStore();
      setRecord(await store.getScreenshot(screenshotId));
    })();
  }, [screenshotId]);

  const openOriginal = useCallback(async () => {
    if (!record) {
      return;
    }
    if (record.originalDeleted) {
      Alert.alert('Original deleted', 'The gallery image was deleted, but the extracted data is kept here.');
      return;
    }
    if (ScreenshotObserver) {
      const opened = await ScreenshotObserver.openInGallery(record.assetId);
      if (!opened && Platform.OS === 'ios') {
        Alert.alert('Viewer', 'Opening full-resolution view inside the app.');
      }
    }
  }, [record]);

  const addReminder = useCallback(async () => {
    if (!record) {
      return;
    }
    const store = await getStore();
    const suggestions = detectActions(record);
    if (suggestions.length === 0) {
      Alert.alert('No dates found', 'This screenshot has no upcoming due date or event to remind you about.');
      return;
    }
    for (const s of suggestions) {
      await store.upsertReminder(s);
    }
    await refreshReminders();
    Alert.alert('Suggested', 'Check the Reminders tab to confirm.');
  }, [record, refreshReminders]);

  const runQuickAction = useCallback((type: string, value: string) => {
    if (type === 'copy_code') {
      Clipboard.setString(value);
      Alert.alert('Copied', value);
    } else if (type === 'call_number') {
      void Linking.openURL(`tel:${value}`);
    } else if (type === 'open_address') {
      void Linking.openURL(`geo:0,0?q=${encodeURIComponent(value)}`);
    }
  }, []);

  if (!record) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
        <Text style={[typography.secondary, { padding: spacing.xl }]}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const actions = availableQuickActions(record);

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.thumbWrap}>
          {record.thumbnailPath ? (
            <Image source={{ uri: `file://${record.thumbnailPath}` }} style={styles.thumb} resizeMode="contain" />
          ) : (
            <View style={styles.thumbPlaceholder}>
              <Text style={{ fontSize: 42 }}>🖼</Text>
            </View>
          )}
          {record.originalDeleted ? (
            <Text style={styles.deletedBanner}>Original deleted from gallery — extracted data kept</Text>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <CategoryBadge category={record.category} />
          <Text style={typography.caption}>
            {new Date(record.takenAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            {record.sourceApp ? ` · ${record.sourceApp}` : ''}
          </Text>
        </View>

        {record.entities.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Extracted</Text>
            {record.entities.map((e, i) => (
              <View key={`${e.type}-${i}`} style={styles.entityRow}>
                <Text style={styles.entityLabel}>{ENTITY_LABELS[e.type]}</Text>
                <Text style={styles.entityValue} selectable>
                  {e.type === 'amount' ? `₹${parseFloat(e.value).toLocaleString('en-IN')}` : e.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {actions.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick actions</Text>
            {actions.map((a, i) => (
              <TouchableOpacity key={`${a.type}-${i}`} style={styles.actionRow} onPress={() => runQuickAction(a.type, a.value)}>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Text in screenshot</Text>
          <Text style={styles.ocrText} selectable>
            {record.ocrText || 'No text detected.'}
          </Text>
        </View>

        <View style={styles.buttons}>
          <PrimaryButton label={Platform.OS === 'android' ? 'Open in Gallery' : 'View full size'} onPress={() => void openOriginal()} />
          <TouchableOpacity style={styles.secondaryButton} onPress={() => void addReminder()}>
            <Text style={styles.secondaryButtonText}>Suggest reminder</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  thumbWrap: { alignItems: 'center', gap: spacing.sm },
  thumb: { width: '60%', aspectRatio: 9 / 16, borderRadius: radius.md, backgroundColor: colors.surface },
  thumbPlaceholder: {
    width: '60%',
    aspectRatio: 9 / 16,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deletedBanner: { color: colors.warning, fontSize: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { ...typography.caption, textTransform: 'uppercase', letterSpacing: 1 },
  entityRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  entityLabel: { ...typography.secondary },
  entityValue: { ...typography.body, flexShrink: 1, textAlign: 'right' },
  actionRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionLabel: { color: colors.accent, fontSize: 15 },
  ocrText: { ...typography.secondary, lineHeight: 20 },
  buttons: { gap: spacing.sm },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 },
});

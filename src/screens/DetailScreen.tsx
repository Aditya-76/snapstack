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
  Modal,
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
import { ScreenshotObserver, Thumbnails } from '../native';
import { availableQuickActions, setRemindersForScreenshot } from '../reminders/engine';
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
  const [viewerPath, setViewerPath] = useState<string | null>(null);
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
    if (!ScreenshotObserver) {
      return;
    }
    const opened = await ScreenshotObserver.openInGallery(record.assetId);
    if (!opened) {
      // iOS: Photos deep links are unsupported — full-res in-app viewer is
      // the contract (PRD §4.6).
      if (Thumbnails?.getFullImage) {
        try {
          setViewerPath(await Thumbnails.getFullImage(record.assetId));
          return;
        } catch (e) {
          console.warn('[detail] full image failed', e);
        }
      }
      if (record.thumbnailPath) {
        setViewerPath(record.thumbnailPath);
      }
    }
  }, [record]);

  // Explicit intent → one tap sets the reminder (PRD §4.5), deduped.
  const addReminder = useCallback(async () => {
    if (!record) {
      return;
    }
    const store = await getStore();
    const created = await setRemindersForScreenshot(store, record);
    if (created.length === 0) {
      Alert.alert('No dates found', 'This screenshot has no upcoming due date or event to remind you about.');
      return;
    }
    await refreshReminders();
    Alert.alert('Reminder set', created.map(c => c.title).join('\n'), [
      {
        text: 'Undo',
        onPress: () => {
          void (async () => {
            const { undoReminder } = await import('../reminders/engine');
            for (const c of created) {
              await undoReminder(store, c.id);
            }
            await refreshReminders();
          })();
        },
      },
      { text: 'OK' },
    ]);
  }, [record, refreshReminders]);

  const runQuickAction = useCallback((type: string, value: string) => {
    if (type === 'copy_code') {
      Clipboard.setString(value);
      Alert.alert('Copied', value);
    } else if (type === 'call_number') {
      void Linking.openURL(`tel:${value}`);
    } else if (type === 'open_address') {
      const url =
        Platform.OS === 'ios'
          ? `http://maps.apple.com/?q=${encodeURIComponent(value)}`
          : `geo:0,0?q=${encodeURIComponent(value)}`;
      void Linking.openURL(url);
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
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => void addReminder()}
            accessibilityRole="button"
            accessibilityLabel="Set reminder from this screenshot"
          >
            <Text style={styles.secondaryButtonText}>Set reminder</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={viewerPath != null} animationType="fade" onRequestClose={() => setViewerPath(null)}>
        <View style={styles.viewer}>
          {viewerPath ? (
            <Image source={{ uri: `file://${viewerPath}` }} style={styles.viewerImage} resizeMode="contain" />
          ) : null}
          <TouchableOpacity
            style={styles.viewerClose}
            onPress={() => setViewerPath(null)}
            accessibilityRole="button"
            accessibilityLabel="Close full-size view"
          >
            <Text style={styles.viewerCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 },
  viewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: {
    position: 'absolute',
    top: 48,
    right: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  viewerCloseText: { color: '#fff', fontWeight: '600' },
});

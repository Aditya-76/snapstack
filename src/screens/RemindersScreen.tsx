/**
 * Reminders tab (PRD §4.5): suggested cards (confirm/dismiss), confirmed
 * reminders (undo), and the Activity log for transparency.
 */

import React, { useEffect } from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, ReminderCard } from '../components';
import { useAppStore } from '../store/appStore';
import { colors, spacing, typography } from '../theme';
import { ReminderSuggestion } from '../types';

export function RemindersScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void } }) {
  const { suggestions, confirmedReminders, refreshReminders, refreshActivity, confirm, dismiss, undo } = useAppStore();

  useEffect(() => {
    void refreshReminders();
    void refreshActivity();
  }, [refreshReminders, refreshActivity]);

  const sections = [
    { title: 'Suggested', data: suggestions, kind: 'suggested' as const },
    { title: 'Scheduled', data: confirmedReminders, kind: 'confirmed' as const },
  ].filter(s => s.data.length > 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={typography.title}>Reminders</Text>
          <Text style={typography.secondary}>Bills, bookings and expiries found in your screenshots</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('Activity')}>
          <Text style={styles.activityLink}>Activity</Text>
        </TouchableOpacity>
      </View>
      <SectionList<ReminderSuggestion>
        sections={sections}
        keyExtractor={r => r.id}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item, section }) =>
          (section as { kind: 'suggested' | 'confirmed' }).kind === 'suggested' ? (
            <ReminderCard
              reminder={item}
              onConfirm={() => void confirm(item.id)}
              onDismiss={() => void dismiss(item.id)}
              onOpenSource={() => navigation.navigate('Detail', { screenshotId: item.screenshotId })}
            />
          ) : (
            <ReminderCard
              reminder={item}
              onUndo={() => void undo(item.id)}
              onOpenSource={() => navigation.navigate('Detail', { screenshotId: item.screenshotId })}
            />
          )
        }
        ListEmptyComponent={
          <EmptyState
            icon="⏰"
            title="Nothing to remind you about"
            subtitle="When a screenshot contains a due date, booking or coupon expiry, a suggestion appears here."
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  activityLink: { color: colors.accent, fontSize: 14, paddingTop: spacing.sm },
  sectionTitle: {
    ...typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});

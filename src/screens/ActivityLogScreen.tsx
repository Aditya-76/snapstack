/**
 * Activity log (PRD §4.5): every automatic action is visible and undoable.
 */

import React, { useEffect } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components';
import { useAppStore } from '../store/appStore';
import { colors, spacing, typography } from '../theme';

const KIND_ICONS: Record<string, string> = {
  reminder_auto_created: '⚡️',
  reminder_confirmed: '✅',
  reminder_dismissed: '✖️',
  reminder_undone: '↩️',
  screenshot_indexed: '📸',
  backfill_completed: '📦',
};

export function ActivityLogScreen() {
  const { activity, refreshActivity } = useAppStore();

  useEffect(() => {
    void refreshActivity();
  }, [refreshActivity]);

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <FlatList
        data={activity}
        keyExtractor={a => a.id}
        contentContainerStyle={{ paddingVertical: spacing.md }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.icon}>{KIND_ICONS[item.kind] ?? '•'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={typography.body}>{item.message}</Text>
              <Text style={typography.caption}>
                {new Date(item.at).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<EmptyState icon="🗒" title="No activity yet" subtitle="Automatic actions and reminder changes show up here." />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'flex-start',
  },
  icon: { fontSize: 18, marginTop: 2 },
});

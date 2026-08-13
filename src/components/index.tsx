/**
 * Shared UI components.
 */

import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import { categoryColors, colors, radius, spacing, typography } from '../theme';
import {
  ALL_CATEGORIES,
  Category,
  CATEGORY_LABELS,
  ReminderSuggestion,
  ScreenshotRecord,
  SENSITIVE_CATEGORIES,
} from '../types';

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${categoryColors[category]}22`, borderColor: categoryColors[category] }]}>
      <Text style={[styles.badgeText, { color: categoryColors[category] }]}>{CATEGORY_LABELS[category]}</Text>
    </View>
  );
}

export function CategoryChips({
  active,
  counts,
  onSelect,
}: {
  active: Category | null;
  counts: Partial<Record<Category, number>>;
  onSelect: (category: Category | null) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      <TouchableOpacity
        style={[styles.chip, active == null && styles.chipActive]}
        onPress={() => onSelect(null)}
      >
        <Text style={[styles.chipText, active == null && styles.chipTextActive]}>All</Text>
      </TouchableOpacity>
      {ALL_CATEGORIES.map(cat => (
        <TouchableOpacity
          key={cat}
          style={[styles.chip, active === cat && styles.chipActive]}
          onPress={() => onSelect(active === cat ? null : cat)}
        >
          <Text style={[styles.chipText, active === cat && styles.chipTextActive]}>
            {CATEGORY_LABELS[cat]}
            {counts[cat] != null ? ` · ${counts[cat]}` : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export function ScreenshotCard({
  record,
  snippet,
  hidePreview,
  onPress,
}: {
  record: ScreenshotRecord;
  snippet?: string | null;
  hidePreview?: boolean;
  onPress: () => void;
}) {
  const sensitive = SENSITIVE_CATEGORIES.includes(record.category) && hidePreview !== false;
  const dateLabel = new Date(record.takenAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const preview = snippet ?? record.ocrText.slice(0, 120).replace(/\s+/g, ' ').trim();

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.thumbBox}>
        {record.thumbnailPath && !sensitive ? (
          <Image source={{ uri: `file://${record.thumbnailPath}` }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Text style={styles.thumbPlaceholderText}>{sensitive ? '🔒' : '🖼'}</Text>
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <CategoryBadge category={record.category} />
          {record.sourceApp ? <Text style={typography.caption}>{record.sourceApp}</Text> : null}
        </View>
        <Text style={styles.cardSnippet} numberOfLines={2}>
          {sensitive ? 'Sensitive document — preview hidden' : preview || 'No text detected'}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={typography.caption}>{dateLabel}</Text>
          {record.originalDeleted ? <Text style={styles.deletedTag}>original deleted</Text> : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function ReminderCard({
  reminder,
  onConfirm,
  onDismiss,
  onUndo,
}: {
  reminder: ReminderSuggestion;
  onConfirm?: () => void;
  onDismiss?: () => void;
  onUndo?: () => void;
}) {
  const when =
    reminder.fireAt != null
      ? new Date(reminder.fireAt).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null;
  return (
    <View style={styles.reminderCard}>
      <View style={{ flex: 1 }}>
        <Text style={typography.body}>{reminder.title}</Text>
        <Text style={typography.caption}>
          {reminder.auto ? 'Auto-created · ' : ''}
          {when ? `Reminds ${when}` : 'No time set'}
        </Text>
      </View>
      <View style={styles.reminderActions}>
        {onConfirm ? (
          <TouchableOpacity style={styles.primaryButtonSmall} onPress={onConfirm}>
            <Text style={styles.primaryButtonText}>Add</Text>
          </TouchableOpacity>
        ) : null}
        {onDismiss ? (
          <TouchableOpacity style={styles.ghostButtonSmall} onPress={onDismiss}>
            <Text style={styles.ghostButtonText}>Dismiss</Text>
          </TouchableOpacity>
        ) : null}
        {onUndo ? (
          <TouchableOpacity style={styles.ghostButtonSmall} onPress={onUndo}>
            <Text style={styles.ghostButtonText}>Undo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={typography.heading}>{title}</Text>
      <Text style={[typography.secondary, styles.emptySubtitle]}>{subtitle}</Text>
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.primaryButton, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  chipRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm },
  chip: {
    backgroundColor: colors.chipBackground,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: 13 },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  thumbBox: { width: 72, height: 96 },
  thumb: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: { fontSize: 24 },
  cardBody: { flex: 1, padding: spacing.md, gap: spacing.xs },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardSnippet: { ...typography.secondary, color: colors.textPrimary },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deletedTag: { fontSize: 11, color: colors.warning },
  reminderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  reminderActions: { flexDirection: 'row', gap: spacing.sm },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonSmall: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  ghostButtonSmall: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghostButtonText: { color: colors.textSecondary, fontSize: 14 },
  buttonDisabled: { opacity: 0.4 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl * 2, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyIcon: { fontSize: 40 },
  emptySubtitle: { textAlign: 'center' },
});

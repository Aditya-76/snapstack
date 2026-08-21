/**
 * Search tab (PRD §4.4): library grid + hybrid keyword/semantic search with
 * category filters.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CategoryChips, EmptyState, ScreenshotCard } from '../components';
import { onScreenshotIndexed } from '../capture/captureService';
import { useAppStore } from '../store/appStore';
import { colors, spacing, typography } from '../theme';
import { ScreenshotRecord, SearchResult } from '../types';

export function SearchScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void } }) {
  const {
    screenshots,
    totalCount,
    categoryCounts,
    query,
    activeCategory,
    results,
    searching,
    settings,
    backfillRunning,
    backfillProcessed,
    backfillTotal,
    refreshLibrary,
    setQuery,
    runSearch,
    setActiveCategory,
  } = useAppStore();

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void refreshLibrary();
    const unsubscribe = onScreenshotIndexed(() => void refreshLibrary());
    return unsubscribe;
  }, [refreshLibrary]);

  const onChangeQuery = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounce.current) {
        clearTimeout(debounce.current);
      }
      debounce.current = setTimeout(() => void runSearch(), 250);
    },
    [setQuery, runSearch],
  );

  const showingSearch = query.trim().length > 0;

  const openDetail = useCallback(
    (record: ScreenshotRecord) => navigation.navigate('Detail', { screenshotId: record.id }),
    [navigation],
  );

  const renderResult = useCallback(
    ({ item }: { item: SearchResult }) => (
      <ScreenshotCard
        record={item.screenshot}
        snippet={item.snippet}
        hidePreview={!settings.showSensitivePreviews}
        onPress={() => openDetail(item.screenshot)}
      />
    ),
    [openDetail, settings.showSensitivePreviews],
  );

  const renderRecord = useCallback(
    ({ item }: { item: ScreenshotRecord }) => (
      <ScreenshotCard
        record={item}
        hidePreview={!settings.showSensitivePreviews}
        onPress={() => openDetail(item)}
      />
    ),
    [openDetail, settings.showSensitivePreviews],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={typography.title}>Screenshot Brain</Text>
        <Text style={typography.secondary}>
          {totalCount} screenshot{totalCount === 1 ? '' : 's'} indexed · everything stays on this phone
        </Text>
      </View>
      <View style={styles.searchBox}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search bills, PNRs, coupons, anything…"
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={onChangeQuery}
          returnKeyType="search"
          onSubmitEditing={() => void runSearch()}
        />
      </View>
      <CategoryChips active={activeCategory} counts={categoryCounts} onSelect={setActiveCategory} />
      {backfillRunning ? (
        <View style={styles.backfillBanner}>
          <Text style={styles.backfillText}>
            Indexing your screenshots… {backfillTotal > 0 ? `${backfillProcessed} of ${backfillTotal}` : 'scanning gallery'}
          </Text>
        </View>
      ) : null}
      {showingSearch ? (
        <FlatList
          data={results}
          keyExtractor={r => r.screenshot.id}
          renderItem={renderResult}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            searching && results.length > 0 ? <Text style={styles.status}>Searching…</Text> : undefined
          }
          ListEmptyComponent={
            searching ? (
              <Text style={styles.status}>Searching…</Text>
            ) : (
              <EmptyState icon="🔍" title="No matches" subtitle="Try different words — search covers all text inside your screenshots." />
            )
          }
        />
      ) : (
        <FlatList
          data={screenshots}
          keyExtractor={r => r.id}
          renderItem={renderRecord}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            backfillRunning ? (
              <EmptyState icon="⏳" title="Indexing…" subtitle="Your screenshots will appear here as they're processed." />
            ) : (
              <EmptyState
                icon="📸"
                title="No screenshots yet"
                subtitle="New screenshots are indexed automatically. You can also index existing ones from Settings."
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs },
  searchBox: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
  },
  status: { ...typography.secondary, textAlign: 'center', paddingVertical: spacing.xl },
  backfillBanner: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backfillText: { color: colors.accent, fontSize: 13 },
});

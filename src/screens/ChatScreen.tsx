/**
 * Q&A chat tab (PRD §4.4): local RAG with screenshots as citations. When the
 * LLM pack isn't installed the tab still works as retrieval — answers degrade
 * to "here's what I found" with the same citations.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, ScreenshotCard } from '../components';
import { useAppStore } from '../store/appStore';
import { colors, radius, spacing, typography } from '../theme';
import { ChatMessage } from '../types';

const SUGGESTED_QUESTIONS = [
  'How much was my electricity bill last month?',
  "What's my train PNR?",
  'Find that Swiggy coupon',
];

export function ChatScreen({ navigation }: { navigation: { navigate: (screen: string, params?: object) => void } }) {
  const { chatMessages, answering, qaAvailable, settings, askQuestion } = useAppStore();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const send = useCallback(
    (text: string) => {
      const q = text.trim();
      if (q.length === 0 || answering) {
        return;
      }
      setDraft('');
      void askQuestion(q);
    },
    [answering, askQuestion],
  );

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <View style={[styles.bubbleRow, item.role === 'user' ? styles.rowUser : styles.rowAssistant]}>
        <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
          <Text style={typography.body}>{item.text}</Text>
        </View>
        {item.citations && item.citations.length > 0 ? (
          <View style={styles.citations}>
            {item.citations.slice(0, 4).map(c => (
              <ScreenshotCard
                key={c.screenshot.id}
                record={c.screenshot}
                hidePreview={!settings.showSensitivePreviews}
                onPress={() => navigation.navigate('Detail', { screenshotId: c.screenshot.id })}
              />
            ))}
          </View>
        ) : null}
      </View>
    ),
    [navigation, settings.showSensitivePreviews],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={typography.title}>Ask your screenshots</Text>
        <Text style={typography.secondary}>
          {qaAvailable ? 'Answers generated on-device — nothing leaves your phone' : 'Search-only mode · enable Q&A model in Settings'}
        </Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={chatMessages}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View>
              <EmptyState icon="💬" title="Ask anything" subtitle="Questions are answered from your own screenshots, with the sources shown." />
              <View style={styles.suggestions}>
                {SUGGESTED_QUESTIONS.map(q => (
                  <TouchableOpacity key={q} style={styles.suggestion} onPress={() => send(q)}>
                    <Text style={styles.suggestionText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
        />
        {answering ? <Text style={styles.thinking}>Thinking…</Text> : null}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Ask a question…"
            placeholderTextColor={colors.textTertiary}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => send(draft)}
            returnKeyType="send"
          />
          <TouchableOpacity style={styles.sendButton} onPress={() => send(draft)} disabled={answering}>
            <Text style={styles.sendLabel}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs },
  list: { paddingVertical: spacing.md },
  bubbleRow: { marginBottom: spacing.md },
  rowUser: { alignItems: 'flex-end' },
  rowAssistant: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
  },
  bubbleUser: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  bubbleAssistant: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  citations: { marginTop: spacing.sm, alignSelf: 'stretch' },
  suggestions: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  suggestion: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  suggestionText: { color: colors.accent, fontSize: 14 },
  thinking: { ...typography.secondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  inputRow: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  sendLabel: { color: '#fff', fontWeight: '600' },
});

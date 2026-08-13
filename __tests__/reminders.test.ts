import { MemoryStore } from '../src/db/memoryStore';
import {
  confirmReminder,
  detectActions,
  dismissReminder,
  processSuggestions,
  reminderFireTime,
  setAutoMode,
  undoReminder,
} from '../src/reminders/engine';
import { DEFAULT_SETTINGS, Entity } from '../src/types';
import { makeRecord } from './helpers';

const NOW = new Date('2026-08-13T10:00:00');

const billEntities: Entity[] = [
  { type: 'amount', raw: '₹1,178', value: '1178', confidence: 0.95 },
  { type: 'due_date', raw: '20/08/2026', value: '2026-08-20', confidence: 0.9 },
  { type: 'merchant', raw: 'airtel', value: 'airtel', confidence: 0.75 },
];

describe('reminderFireTime', () => {
  it('targets 9 AM on the due date', () => {
    const t = reminderFireTime('2026-08-20', NOW)!;
    const d = new Date(t);
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(9);
  });

  it('returns null for past dates', () => {
    expect(reminderFireTime('2026-08-01', NOW)).toBeNull();
  });
});

describe('detectActions', () => {
  it('suggests a due-date reminder with amount and merchant in the title', () => {
    const record = makeRecord({ ocrText: 'Airtel bill', category: 'bill', entities: billEntities });
    const suggestions = detectActions(record, NOW);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].actionType).toBe('due_date_reminder');
    expect(suggestions[0].title).toContain('Airtel');
    expect(suggestions[0].title).toContain('₹1,178');
    expect(suggestions[0].title).toContain('20 Aug');
    expect(suggestions[0].status).toBe('suggested');
  });

  it('suggests calendar events for future bookings', () => {
    const record = makeRecord({
      ocrText: 'IRCTC ticket',
      category: 'booking',
      entities: [{ type: 'date', raw: '22 Aug 2026', value: '2026-08-22', confidence: 0.8 }],
    });
    const suggestions = detectActions(record, NOW);
    expect(suggestions.some(s => s.actionType === 'calendar_event')).toBe(true);
  });

  it('suggests nothing when all dates are past', () => {
    const record = makeRecord({
      ocrText: 'old bill',
      category: 'bill',
      entities: [{ type: 'due_date', raw: '01/07/2026', value: '2026-07-01', confidence: 0.9 }],
    });
    expect(detectActions(record, NOW)).toHaveLength(0);
  });
});

describe('processSuggestions + lifecycle', () => {
  it('stores suggestions without confirming in default mode', async () => {
    const store = new MemoryStore();
    await store.init();
    const record = makeRecord({ ocrText: 'Airtel bill', category: 'bill', entities: billEntities });
    await processSuggestions(store, record, DEFAULT_SETTINGS, NOW);
    expect(await store.listReminders('suggested')).toHaveLength(1);
    expect(await store.listReminders('confirmed')).toHaveLength(0);
  });

  it('auto-confirms and logs when auto mode is on for the category', async () => {
    const store = new MemoryStore();
    await store.init();
    const settings = setAutoMode(DEFAULT_SETTINGS, 'bill', true);
    const record = makeRecord({ ocrText: 'Airtel bill', category: 'bill', entities: billEntities });
    await processSuggestions(store, record, settings, NOW);

    const confirmed = await store.listReminders('confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].auto).toBe(true);

    const activity = await store.listActivity();
    expect(activity.some(a => a.kind === 'reminder_auto_created')).toBe(true);
  });

  it('supports confirm, dismiss and undo transitions with activity logging', async () => {
    const store = new MemoryStore();
    await store.init();
    const record = makeRecord({ ocrText: 'Airtel bill', category: 'bill', entities: billEntities });
    const [suggestion] = await processSuggestions(store, record, DEFAULT_SETTINGS, NOW);

    await confirmReminder(store, suggestion.id);
    expect((await store.getReminder(suggestion.id))!.status).toBe('confirmed');

    await undoReminder(store, suggestion.id);
    expect((await store.getReminder(suggestion.id))!.status).toBe('undone');

    const record2 = makeRecord({ ocrText: 'Jio bill', category: 'bill', entities: billEntities });
    const [s2] = await processSuggestions(store, record2, DEFAULT_SETTINGS, NOW);
    await dismissReminder(store, s2.id);
    expect((await store.getReminder(s2.id))!.status).toBe('dismissed');

    const kinds = (await store.listActivity()).map(a => a.kind);
    expect(kinds).toContain('reminder_confirmed');
    expect(kinds).toContain('reminder_undone');
    expect(kinds).toContain('reminder_dismissed');
  });
});

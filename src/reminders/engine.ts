/**
 * Reminder & action engine (PRD §4.5).
 *
 * Default mode: suggest, user confirms with one tap. Automatic mode is opt-in
 * per category, always logged in the Activity log, always undoable (§7.6).
 */

import { SnapStore } from '../db/store';
import { Notifications } from '../native';
import {
  ActionType,
  ActivityLogEntry,
  Category,
  CATEGORY_LABELS,
  Entity,
  ReminderSuggestion,
  ScreenshotRecord,
  Settings,
} from '../types';

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 9:00 AM local on the given ISO date, or the evening before if that is in the past. */
export function reminderFireTime(isoDate: string, now: Date): number | null {
  const [y, m, d] = isoDate.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d, 9, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    return null; // already past — no reminder
  }
  return target.getTime();
}

function formatAmount(entities: Entity[]): string {
  const amt = entities.find(e => e.type === 'amount');
  if (!amt) {
    return '';
  }
  const n = parseFloat(amt.value);
  return ` ₹${n.toLocaleString('en-IN')}`;
}

function formatDateShort(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(n => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function merchantOrCategory(record: ScreenshotRecord): string {
  const merchant = record.entities.find(e => e.type === 'merchant');
  if (merchant) {
    // Title-case the merchant hint.
    return merchant.value.replace(/\b\w/g, c => c.toUpperCase());
  }
  return CATEGORY_LABELS[record.category];
}

/**
 * Detect actionable dates in an indexed screenshot and build reminder
 * suggestions (PRD §4.3 step 6). Pure function — no store side effects.
 */
export function detectActions(record: ScreenshotRecord, now: Date = new Date()): ReminderSuggestion[] {
  const suggestions: ReminderSuggestion[] = [];
  const nowMs = now.getTime();

  const dueDates = record.entities.filter(e => e.type === 'due_date');
  for (const due of dueDates) {
    const fireAt = reminderFireTime(due.value, now);
    if (fireAt == null) {
      continue;
    }
    const what = merchantOrCategory(record);
    suggestions.push({
      id: newId('rem'),
      screenshotId: record.id,
      actionType: 'due_date_reminder',
      title: `${what}${formatAmount(record.entities)} due ${formatDateShort(due.value)}`,
      fireAt,
      status: 'suggested',
      auto: false,
      createdAt: nowMs,
    });
  }

  // Coupon expiries → remind the day before expiry.
  const expiry = record.entities.find(e => e.type === 'coupon_expiry');
  const coupon = record.entities.find(e => e.type === 'coupon_code');
  if (expiry && coupon) {
    const fireAt = reminderFireTime(expiry.value, now);
    if (fireAt != null) {
      suggestions.push({
        id: newId('rem'),
        screenshotId: record.id,
        actionType: 'due_date_reminder',
        title: `Coupon ${coupon.value} expires ${formatDateShort(expiry.value)}`,
        fireAt: fireAt - 24 * 60 * 60 * 1000 > nowMs ? fireAt - 24 * 60 * 60 * 1000 : fireAt,
        status: 'suggested',
        auto: false,
        createdAt: nowMs,
      });
    }
  }

  // Bookings with future event dates → calendar suggestion.
  if (record.category === 'booking') {
    const eventDate = record.entities.find(e => e.type === 'date' && reminderFireTime(e.value, now) != null);
    if (eventDate) {
      const what = merchantOrCategory(record);
      suggestions.push({
        id: newId('rem'),
        screenshotId: record.id,
        actionType: 'calendar_event',
        title: `${what} on ${formatDateShort(eventDate.value)}`,
        fireAt: reminderFireTime(eventDate.value, now),
        status: 'suggested',
        auto: false,
        createdAt: nowMs,
      });
    }
  }

  return suggestions;
}

/** Quick actions available in the detail view for a given record (PRD §4.5). */
export function availableQuickActions(record: ScreenshotRecord): Array<{ type: ActionType; label: string; value: string }> {
  const actions: Array<{ type: ActionType; label: string; value: string }> = [];
  for (const e of record.entities) {
    if (e.type === 'coupon_code') {
      actions.push({ type: 'copy_code', label: `Copy code ${e.value}`, value: e.value });
    }
    if (e.type === 'booking_id') {
      actions.push({ type: 'copy_code', label: `Copy PNR/booking ID ${e.value}`, value: e.value });
    }
    if (e.type === 'tracking_id') {
      actions.push({ type: 'copy_code', label: `Copy tracking ID ${e.value}`, value: e.value });
    }
    if (e.type === 'phone') {
      actions.push({ type: 'call_number', label: `Call ${e.value}`, value: e.value });
    }
    if (e.type === 'address') {
      actions.push({ type: 'open_address', label: 'Open in Maps', value: e.value });
    }
  }
  return actions;
}

async function log(store: SnapStore, entry: Omit<ActivityLogEntry, 'id' | 'at'>): Promise<void> {
  await store.appendActivity({ id: newId('act'), at: Date.now(), ...entry });
}

/**
 * Persist suggestions for a freshly indexed screenshot. Auto-confirms (and
 * schedules a local notification) when the user has enabled automatic mode
 * for the screenshot's category.
 */
export async function processSuggestions(
  store: SnapStore,
  record: ScreenshotRecord,
  settings: Settings,
  now: Date = new Date(),
): Promise<ReminderSuggestion[]> {
  const suggestions = detectActions(record, now);
  const autoEnabled = settings.autoRemindersByCategory[record.category] === true;

  for (const s of suggestions) {
    if (autoEnabled && s.actionType === 'due_date_reminder') {
      s.status = 'confirmed';
      s.auto = true;
      await store.upsertReminder(s);
      await scheduleNotification(s);
      await log(store, {
        kind: 'reminder_auto_created',
        message: `Auto-created reminder: ${s.title}`,
        screenshotId: record.id,
        reminderId: s.id,
      });
    } else {
      await store.upsertReminder(s);
    }
  }
  return suggestions;
}

/**
 * Explicit user intent from the detail view: create the reminders for this
 * screenshot as confirmed in one tap (PRD §4.5 "One tap confirms"), deduped
 * against reminders that already exist for it.
 */
export async function setRemindersForScreenshot(
  store: SnapStore,
  record: ScreenshotRecord,
  now: Date = new Date(),
): Promise<ReminderSuggestion[]> {
  const detected = detectActions(record, now);
  if (detected.length === 0) {
    return [];
  }
  const existing = (await store.listReminders()).filter(r => r.screenshotId === record.id);
  const created: ReminderSuggestion[] = [];
  for (const suggestion of detected) {
    const duplicate = existing.find(
      r => r.actionType === suggestion.actionType && r.fireAt === suggestion.fireAt && r.status !== 'dismissed' && r.status !== 'undone',
    );
    if (duplicate) {
      if (duplicate.status === 'suggested') {
        await confirmReminder(store, duplicate.id);
        created.push({ ...duplicate, status: 'confirmed' });
      }
      continue;
    }
    suggestion.status = 'confirmed';
    await store.upsertReminder(suggestion);
    await scheduleNotification(suggestion);
    await log(store, {
      kind: 'reminder_confirmed',
      message: `Reminder set: ${suggestion.title}`,
      screenshotId: record.id,
      reminderId: suggestion.id,
    });
    created.push(suggestion);
  }
  return created;
}

export async function confirmReminder(store: SnapStore, reminderId: string): Promise<void> {
  const reminder = await store.getReminder(reminderId);
  if (!reminder) {
    return;
  }
  reminder.status = 'confirmed';
  await store.upsertReminder(reminder);
  await scheduleNotification(reminder);
  await log(store, {
    kind: 'reminder_confirmed',
    message: `Reminder set: ${reminder.title}`,
    screenshotId: reminder.screenshotId,
    reminderId: reminder.id,
  });
}

export async function dismissReminder(store: SnapStore, reminderId: string): Promise<void> {
  const reminder = await store.getReminder(reminderId);
  if (!reminder) {
    return;
  }
  reminder.status = 'dismissed';
  await store.upsertReminder(reminder);
  await log(store, {
    kind: 'reminder_dismissed',
    message: `Dismissed: ${reminder.title}`,
    screenshotId: reminder.screenshotId,
    reminderId: reminder.id,
  });
}

/** Undo a confirmed/auto reminder: cancel the notification, mark undone (PRD §4.5). */
export async function undoReminder(store: SnapStore, reminderId: string): Promise<void> {
  const reminder = await store.getReminder(reminderId);
  if (!reminder) {
    return;
  }
  reminder.status = 'undone';
  await store.upsertReminder(reminder);
  if (Notifications) {
    try {
      await Notifications.cancel(reminder.id);
    } catch (e) {
      console.warn('[reminders] cancel failed', e);
    }
  }
  await log(store, {
    kind: 'reminder_undone',
    message: `Undone: ${reminder.title}`,
    screenshotId: reminder.screenshotId,
    reminderId: reminder.id,
  });
}

let notificationPermissionRequested = false;

async function scheduleNotification(reminder: ReminderSuggestion): Promise<void> {
  if (!Notifications || reminder.fireAt == null) {
    return;
  }
  try {
    // Runtime-gated on Android 13+ and iOS; ask lazily at the first moment a
    // reminder actually needs it, when the value is obvious to the user.
    if (!notificationPermissionRequested) {
      notificationPermissionRequested = true;
      await Notifications.requestPermission();
    }
    await Notifications.schedule(reminder.id, 'Screenshot Brain', reminder.title, reminder.fireAt);
  } catch (e) {
    console.warn('[reminders] schedule failed', e);
  }
}

/** Toggle per-category automatic mode (PRD §4.5 "Automatic (opt-in, per category)"). */
export function setAutoMode(settings: Settings, category: Category, enabled: boolean): Settings {
  return {
    ...settings,
    autoRemindersByCategory: { ...settings.autoRemindersByCategory, [category]: enabled },
  };
}

/**
 * Recurring calendar placeholders.
 *
 * Some TJCF programs happen on a fixed monthly pattern (e.g. Parent Coffee
 * Meet on the 3rd Friday) long before anyone schedules them in Wix or adds a
 * manual entry. Rather than hand-entering a row for every month, each pattern
 * is described once below as a recurrence rule and expanded on the fly for
 * whatever date range the calendar (or the yearly export) is showing.
 *
 * Placeholders are virtual: they are never written to the CalendarEntries
 * sheet. Once the team adds a real entry on that day whose title matches the
 * placeholder (e.g. "Parent Coffee Meet – Holiday edition"), the placeholder
 * for that day is hidden so the calendar doesn't show it twice.
 *
 * Client-safe: no server-only imports.
 */

import { addDays, format, startOfMonth, addMonths, isAfter, isBefore, parseISO, isValid } from 'date-fns';
import type { Activity, CampaignType } from './types';

/** 0 = Sunday … 6 = Saturday (same as Date#getDay). */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface MonthlyRecurrenceRule {
  /** Stable key, used in placeholder ids and Activity.recurrenceKey. */
  key: string;
  title: string;
  type: CampaignType;
  /** Day of week the event falls on. */
  weekday: Weekday;
  /** Which occurrence of that weekday in the month: 1–5, or -1 for the last. */
  nth: 1 | 2 | 3 | 4 | 5 | -1;
  /** Optional start time "HH:mm"; omit for an all-day placeholder. */
  time?: string;
  /** Lowercase text; a real entry on the same day whose title contains it replaces the placeholder. */
  matchTitle: string;
  notes?: string;
  /** Equivalent iCalendar RRULE, for reference / future .ics export. */
  rrule: string;
}

export const RECURRING_PLACEHOLDERS: MonthlyRecurrenceRule[] = [
  {
    key: 'parent-coffee-meet',
    title: 'Parent Coffee Meet (placeholder)',
    type: 'event-reminder',
    weekday: 5, // Friday
    nth: 3,
    matchTitle: 'coffee meet',
    notes: 'Recurring placeholder: Parent Coffee Meet happens on the 3rd Friday of every month.',
    rrule: 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=3',
  },
];

/** The nth (1-based, or -1 = last) given weekday of the month containing `monthDate`. */
export function nthWeekdayOfMonth(monthDate: Date, weekday: Weekday, nth: number): Date | null {
  const first = startOfMonth(monthDate);
  if (nth === -1) {
    const last = addDays(addMonths(first, 1), -1);
    return addDays(last, -((last.getDay() - weekday + 7) % 7));
  }
  const firstMatch = addDays(first, (weekday - first.getDay() + 7) % 7);
  const d = addDays(firstMatch, (nth - 1) * 7);
  return d.getMonth() === first.getMonth() ? d : null;
}

/** Expand every rule into placeholder Activities with dates in [from, to] (inclusive, by day). */
export function expandRecurringPlaceholders(
  from: Date,
  to: Date,
  rules: MonthlyRecurrenceRule[] = RECURRING_PLACEHOLDERS
): Activity[] {
  const out: Activity[] = [];
  const fromKey = format(from, 'yyyy-MM-dd');
  const toKey = format(to, 'yyyy-MM-dd');
  for (let m = startOfMonth(from); !isAfter(m, to); m = addMonths(m, 1)) {
    for (const rule of rules) {
      const day = nthWeekdayOfMonth(m, rule.weekday, rule.nth);
      if (!day) continue;
      const dayKey = format(day, 'yyyy-MM-dd');
      if (dayKey < fromKey || dayKey > toKey) continue;
      out.push({
        id: `recurring:${rule.key}:${dayKey}`,
        title: rule.title,
        description: rule.notes,
        notes: rule.notes,
        startDate: `${dayKey}T${rule.time || '00:00'}:00`,
        source: 'manual',
        type: rule.type,
        recurrenceKey: rule.key,
        selected: false,
      });
    }
  }
  return out;
}

/** True for a virtual placeholder produced by expandRecurringPlaceholders. */
export function isRecurringPlaceholder(a: Pick<Activity, 'id'>): boolean {
  return a.id.startsWith('recurring:');
}

function dayKeyOf(raw: unknown): string | null {
  if (raw && typeof raw === 'object') {
    const o = raw as { utcDate?: string; localDate?: string };
    raw = o.utcDate || o.localDate || '';
  }
  if (typeof raw !== 'string' || !raw) return null;
  const d = parseISO(raw);
  return isValid(d) ? format(d, 'yyyy-MM-dd') : null;
}

/**
 * Return `activities` plus the placeholders in [from, to] that aren't already
 * covered by a real entry on the same day with a matching title.
 */
export function withRecurringPlaceholders(
  activities: Activity[],
  from: Date,
  to: Date,
  rules: MonthlyRecurrenceRule[] = RECURRING_PLACEHOLDERS
): Activity[] {
  if (isBefore(to, from)) return activities;
  const covered = new Set<string>();
  for (const a of activities) {
    const day = dayKeyOf(a.startDate);
    if (!day) continue;
    const title = (a.title || '').toLowerCase();
    for (const rule of rules) {
      if (title.includes(rule.matchTitle)) covered.add(`${rule.key}:${day}`);
    }
  }
  const placeholders = expandRecurringPlaceholders(from, to, rules).filter(
    (p) => !covered.has(`${p.recurrenceKey}:${p.id.slice(p.id.lastIndexOf(':') + 1)}`)
  );
  return placeholders.length ? [...activities, ...placeholders] : activities;
}

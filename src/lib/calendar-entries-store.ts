/**
 * Manual calendar-entry store — backed by a Google Sheet.
 *
 * Manual entries are the things Wix doesn't know about (classes, storytime,
 * school notes, reminders). They must persist and be shared across the whole
 * team, so they live in a "CalendarEntries" tab inside the same
 * "TJCF Marketing Workflow" spreadsheet the workflow tool already uses — no
 * new infrastructure or env var required.
 *
 * Server-only: never import from a client component (pulls in googleapis).
 */

import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import type { Activity, CampaignType } from './types';
import { CAMPAIGN_TYPES } from './types';
import {
  getWorkflowAuth,
  getWorkflowSpreadsheetId,
  TasksNotConfiguredError,
} from './tasks-store';

const TAB_NAME = 'CalendarEntries';

// Column order. Do not reorder without a migration.
const HEADER = [
  'id',
  'title',
  'startDate', // ISO string
  'endDate',
  'type',
  'notes',
  'sourceUrl',
  'createdByEmail',
  'createdByName',
  'createdAt',
  'staff', // appended — do not reorder
  'classroom', // appended — do not reorder
] as const; // 12 columns → A..L

const RANGE = `A2:L`;

const VALID_TYPES = new Set<string>(CAMPAIGN_TYPES.map((t) => t.value));

export interface CalendarEntry {
  id: string;
  title: string;
  startDate: string;
  endDate?: string;
  type: CampaignType;
  notes?: string;
  sourceUrl?: string;
  createdByEmail: string;
  createdByName: string;
  createdAt: string;
  staff?: string;
  classroom?: string;
}

export function isConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
}

// ─── Tab + serialization ───────────────────────────────────────────────

async function ensureTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
) {
  const info = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = info.data.sheets?.find((s) => s.properties?.title === TAB_NAME);
  if (!tab) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TAB_NAME } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${TAB_NAME}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER as unknown as string[]] },
    });
  }
}

function entryToRow(e: CalendarEntry): string[] {
  return [
    e.id,
    e.title,
    e.startDate,
    e.endDate || '',
    e.type,
    e.notes || '',
    e.sourceUrl || '',
    e.createdByEmail,
    e.createdByName,
    e.createdAt,
    e.staff || '',
    e.classroom || '',
  ];
}

function rowToEntry(row: string[]): CalendarEntry | null {
  if (!row || !row[0] || !row[1]) return null; // need id + title
  const type = VALID_TYPES.has(row[4]) ? (row[4] as CampaignType) : 'announcement';
  return {
    id: row[0],
    title: row[1],
    startDate: row[2] || '',
    endDate: row[3] || undefined,
    type,
    notes: row[5] || undefined,
    sourceUrl: row[6] || undefined,
    createdByEmail: row[7] || '',
    createdByName: row[8] || '',
    createdAt: row[9] || '',
    staff: row[10] || undefined,
    classroom: row[11] || undefined,
  };
}

/** Convert a stored entry to an Activity for the calendar UI. */
export function entryToActivity(e: CalendarEntry): Activity {
  return {
    id: e.id,
    title: e.title,
    description: e.notes,
    startDate: e.startDate,
    endDate: e.endDate,
    sourceUrl: e.sourceUrl,
    source: 'manual',
    type: e.type,
    notes: e.notes,
    staff: e.staff,
    classroom: e.classroom,
    selected: false,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function listEntries(): Promise<CalendarEntry[]> {
  const auth = getWorkflowAuth();
  if (!auth) throw new TasksNotConfiguredError();
  const spreadsheetId = await getWorkflowSpreadsheetId();
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB_NAME}'!${RANGE}`,
  });
  const rows = res.data.values || [];
  const entries = rows
    .map(rowToEntry)
    .filter((e): e is CalendarEntry => e !== null);
  entries.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  return entries;
}

export async function createEntry(
  partial: Partial<CalendarEntry> & { title: string; startDate: string; createdByEmail: string }
): Promise<CalendarEntry> {
  const auth = getWorkflowAuth();
  if (!auth) throw new TasksNotConfiguredError();
  const spreadsheetId = await getWorkflowSpreadsheetId();
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab(sheets, spreadsheetId);

  const type = partial.type && VALID_TYPES.has(partial.type)
    ? partial.type
    : 'announcement';
  const entry: CalendarEntry = {
    id: uuidv4(),
    title: partial.title,
    startDate: partial.startDate,
    endDate: partial.endDate,
    type,
    notes: partial.notes,
    sourceUrl: partial.sourceUrl,
    createdByEmail: partial.createdByEmail,
    createdByName: partial.createdByName || partial.createdByEmail,
    createdAt: new Date().toISOString(),
    staff: partial.staff,
    classroom: partial.classroom,
  };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB_NAME}'!A2`,
    // RAW so a title/note starting with "=" is never read as a formula.
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [entryToRow(entry)] },
  });

  return entry;
}

/**
 * Update an entry by id. `patch` overwrites the given fields. Returns the
 * updated entry, or null if no entry with that id exists.
 */
export async function updateEntry(
  id: string,
  patch: Partial<CalendarEntry>
): Promise<CalendarEntry | null> {
  const auth = getWorkflowAuth();
  if (!auth) throw new TasksNotConfiguredError();
  const spreadsheetId = await getWorkflowSpreadsheetId();
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab(sheets, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB_NAME}'!${RANGE}`,
  });
  const rows = res.data.values || [];
  const index = rows.findIndex((r) => r[0] === id);
  if (index === -1) return null;

  const current = rowToEntry(rows[index]);
  if (!current) return null;

  const type = patch.type && VALID_TYPES.has(patch.type) ? patch.type : current.type;
  const updated: CalendarEntry = {
    ...current,
    ...patch,
    type,
    id: current.id, // never change id
    createdByEmail: current.createdByEmail,
    createdAt: current.createdAt,
  };

  const sheetRow = index + 2; // +1 header, +1 for 1-based rows
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB_NAME}'!A${sheetRow}:L${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [entryToRow(updated)] },
  });

  return updated;
}

/** Delete an entry row by id. Returns true if a row was removed. */
export async function deleteEntry(id: string): Promise<boolean> {
  const auth = getWorkflowAuth();
  if (!auth) throw new TasksNotConfiguredError();
  const spreadsheetId = await getWorkflowSpreadsheetId();
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab(sheets, spreadsheetId);

  const info = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = info.data.sheets?.find((s) => s.properties?.title === TAB_NAME);
  const numericSheetId = tab?.properties?.sheetId;
  if (numericSheetId === undefined || numericSheetId === null) return false;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB_NAME}'!${RANGE}`,
  });
  const rows = res.data.values || [];
  const index = rows.findIndex((r) => r[0] === id);
  if (index === -1) return false;

  const startRowIndex = index + 1; // +1 for header (0-based sheet rows)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: numericSheetId,
              dimension: 'ROWS',
              startIndex: startRowIndex,
              endIndex: startRowIndex + 1,
            },
          },
        },
      ],
    },
  });
  return true;
}

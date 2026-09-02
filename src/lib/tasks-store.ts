/**
 * Workflow task store — backed by a Google Sheet.
 *
 * Reuses the existing GOOGLE_SERVICE_ACCOUNT_KEY service account (the same
 * one that powers Drive + Sheets export), so no new infrastructure is
 * required. A single spreadsheet named "TJCF Marketing Workflow" holds one
 * "Tasks" tab; each row is one task. The spreadsheet is created on first use
 * and then found by name (its id is cached in memory for the life of the
 * serverless instance).
 *
 * This module is server-only — it must never be imported from a client
 * component (it pulls in googleapis).
 */

import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import type {
  Task,
  TaskComment,
  TaskPriority,
  TaskStatus,
} from './types';
import { TASK_STATUS_ORDER } from './types';

const SPREADSHEET_NAME = 'TJCF Marketing Workflow';
const TAB_NAME = 'Tasks';

// Column order in the sheet. Do not reorder without a migration.
const HEADER = [
  'id',
  'title',
  'description',
  'category',
  'priority',
  'status',
  'requestedByEmail',
  'requestedByName',
  'assignedToEmail',
  'assignedToName',
  'dueDate',
  'activityRef',
  'comments', // JSON string
  'createdAt',
  'updatedAt',
] as const;

// ─── Auth ────────────────────────────────────────────────────────────

function getAuth() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentialsJson) return null;
  try {
    const credentials = JSON.parse(credentialsJson);
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
  } catch (e) {
    console.error('tasks-store: failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:', e);
    return null;
  }
}

export function isConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
}

export function serviceAccountEmail(): string {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}').client_email || '';
  } catch {
    return '';
  }
}

// ─── Roles ───────────────────────────────────────────────────────────

/**
 * A user is a manager if their email is listed in MANAGER_EMAILS
 * (comma-separated). If MANAGER_EMAILS is not set, everyone signed in is
 * treated as a manager (open mode) — mirroring how auth defaults to open
 * when no allowlist is configured. Set MANAGER_EMAILS to lock assignment
 * down to specific people.
 */
export function isManager(email: string | null | undefined): boolean {
  if (!email) return false;
  const managers = managerEmails();
  if (managers.length === 0) return true; // open mode
  return managers.includes(email.toLowerCase());
}

/** The configured manager emails (lowercased), or [] when unset (open mode). */
export function managerEmails(): string[] {
  const raw = process.env.MANAGER_EMAILS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// ─── Spreadsheet lookup / creation ─────────────────────────────────────

let cachedSpreadsheetId: string | null = null;

async function getSpreadsheetId(
  auth: ReturnType<typeof getAuth>
): Promise<string> {
  if (process.env.TASKS_SPREADSHEET_ID) return process.env.TASKS_SPREADSHEET_ID;
  if (cachedSpreadsheetId) return cachedSpreadsheetId;

  const drive = google.drive({ version: 'v3', auth: auth! });

  // Find an existing spreadsheet with our name
  const found = await drive.files.list({
    q: `name='${SPREADSHEET_NAME.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });

  let id = found.data.files?.[0]?.id || null;

  if (!id) {
    // Try to create the spreadsheet. A service account has no Drive storage
    // quota of its own, so this only succeeds inside a Shared Drive (or a
    // folder on one). On a personal/Hobby Google account it fails with a
    // "storage quota exceeded" error — in that case the user must create the
    // sheet themselves and share it with the service account (see below).
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    try {
      const created = await drive.files.create({
        requestBody: {
          name: SPREADSHEET_NAME,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          ...(rootFolderId ? { parents: [rootFolderId] } : {}),
        },
        fields: 'id',
        supportsAllDrives: true,
      });
      id = created.data.id!;
    } catch (e) {
      const sa = serviceAccountEmail() || 'the service account';
      const detail = (e as Error)?.message || 'unknown error';
      throw new TasksStorageError(
        `Couldn't create the workflow spreadsheet (${detail}). ` +
          `Create a blank Google Sheet named exactly "${SPREADSHEET_NAME}", ` +
          `then Share it as Editor with ${sa} — it will be picked up automatically. ` +
          `Or set TASKS_SPREADSHEET_ID to an existing sheet's id.`
      );
    }

    const sheets = google.sheets({ version: 'v4', auth: auth! });
    // Rename the default sheet to our tab name and write the header row.
    const info = await sheets.spreadsheets.get({ spreadsheetId: id });
    const defaultSheetId = info.data.sheets?.[0]?.properties?.sheetId ?? 0;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: defaultSheetId, title: TAB_NAME },
              fields: 'title',
            },
          },
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${TAB_NAME}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER as unknown as string[]] },
    });
  }

  cachedSpreadsheetId = id;
  return id;
}

/** Ensure the Tasks tab exists with a header row (for a pre-existing sheet). */
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

// ─── Row <-> Task serialization ────────────────────────────────────────

function taskToRow(t: Task): string[] {
  return [
    t.id,
    t.title,
    t.description,
    t.category,
    t.priority,
    t.status,
    t.requestedByEmail,
    t.requestedByName,
    t.assignedToEmail,
    t.assignedToName,
    t.dueDate,
    t.activityRef,
    JSON.stringify(t.comments || []),
    t.createdAt,
    t.updatedAt,
  ];
}

function rowToTask(row: string[]): Task | null {
  if (!row || !row[0]) return null; // no id → skip
  let comments: TaskComment[] = [];
  try {
    comments = row[12] ? (JSON.parse(row[12]) as TaskComment[]) : [];
    if (!Array.isArray(comments)) comments = [];
  } catch {
    comments = [];
  }
  const status = (row[5] || 'requested') as TaskStatus;
  return {
    id: row[0],
    title: row[1] || '',
    description: row[2] || '',
    category: row[3] || 'General',
    priority: (row[4] || 'medium') as TaskPriority,
    status: TASK_STATUS_ORDER.includes(status) ? status : 'requested',
    requestedByEmail: row[6] || '',
    requestedByName: row[7] || '',
    assignedToEmail: row[8] || '',
    assignedToName: row[9] || '',
    dueDate: row[10] || '',
    activityRef: row[11] || '',
    comments,
    createdAt: row[13] || '',
    updatedAt: row[14] || '',
  };
}

// ─── Public API ────────────────────────────────────────────────────────

export class TasksNotConfiguredError extends Error {
  constructor() {
    super('Google service account is not configured (GOOGLE_SERVICE_ACCOUNT_KEY).');
    this.name = 'TasksNotConfiguredError';
  }
}

/** Storage exists but the workflow spreadsheet can't be created/found. */
export class TasksStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TasksStorageError';
  }
}

async function readAllRows(): Promise<{ rows: string[][]; spreadsheetId: string }> {
  const auth = getAuth();
  if (!auth) throw new TasksNotConfiguredError();
  const spreadsheetId = await getSpreadsheetId(auth);
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB_NAME}'!A2:O`,
  });
  return { rows: res.data.values || [], spreadsheetId };
}

export async function listTasks(): Promise<Task[]> {
  const { rows } = await readAllRows();
  const tasks = rows
    .map(rowToTask)
    .filter((t): t is Task => t !== null);
  // Newest first
  tasks.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return tasks;
}

export async function createTask(partial: Partial<Task> & { title: string; requestedByEmail: string }): Promise<Task> {
  const auth = getAuth();
  if (!auth) throw new TasksNotConfiguredError();
  const spreadsheetId = await getSpreadsheetId(auth);
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab(sheets, spreadsheetId);

  const now = new Date().toISOString();
  const assigned = !!partial.assignedToEmail;
  const task: Task = {
    id: uuidv4(),
    title: partial.title,
    description: partial.description || '',
    category: partial.category || 'General',
    priority: partial.priority || 'medium',
    status: partial.status || (assigned ? 'assigned' : 'requested'),
    requestedByEmail: partial.requestedByEmail,
    requestedByName: partial.requestedByName || partial.requestedByEmail,
    assignedToEmail: partial.assignedToEmail || '',
    assignedToName: partial.assignedToName || '',
    dueDate: partial.dueDate || '',
    activityRef: partial.activityRef || '',
    comments: partial.comments || [],
    createdAt: now,
    updatedAt: now,
  };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB_NAME}'!A2`,
    // RAW so user content (e.g. a title starting with "=") is stored verbatim
    // and never interpreted as a spreadsheet formula.
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [taskToRow(task)] },
  });

  return task;
}

/**
 * Update a task by id. `patch` is a shallow set of fields to overwrite.
 * Returns the updated task, or null if no task with that id exists.
 */
export async function updateTask(
  id: string,
  patch: Partial<Task>
): Promise<Task | null> {
  const auth = getAuth();
  if (!auth) throw new TasksNotConfiguredError();
  const spreadsheetId = await getSpreadsheetId(auth);
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab(sheets, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB_NAME}'!A2:O`,
  });
  const rows = res.data.values || [];
  const index = rows.findIndex((r) => r[0] === id);
  if (index === -1) return null;

  const current = rowToTask(rows[index]);
  if (!current) return null;

  const updated: Task = {
    ...current,
    ...patch,
    id: current.id, // never allow id to change
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  // Row 1 is the header, so data row `index` lives at sheet row index+2.
  const sheetRow = index + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB_NAME}'!A${sheetRow}:O${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [taskToRow(updated)] },
  });

  return updated;
}

export async function getTask(id: string): Promise<Task | null> {
  const tasks = await listTasks();
  return tasks.find((t) => t.id === id) || null;
}

/** Delete a task row by id. Returns true if a row was removed. */
export async function deleteTask(id: string): Promise<boolean> {
  const auth = getAuth();
  if (!auth) throw new TasksNotConfiguredError();
  const spreadsheetId = await getSpreadsheetId(auth);
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab(sheets, spreadsheetId);

  // Need the numeric sheetId for a deleteDimension request.
  const info = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = info.data.sheets?.find((s) => s.properties?.title === TAB_NAME);
  const numericSheetId = tab?.properties?.sheetId;
  if (numericSheetId === undefined || numericSheetId === null) return false;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB_NAME}'!A2:O`,
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

export function makeComment(
  email: string,
  name: string,
  text: string
): TaskComment {
  return { author: email, authorName: name || email, text, at: new Date().toISOString() };
}

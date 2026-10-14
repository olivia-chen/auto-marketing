import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { google } from 'googleapis';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
} from 'date-fns';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ExportEntry {
  date: string; // yyyy-MM-dd
  title: string;
  time?: string;
  source?: string;
}

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
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } catch {
    return null;
  }
}

function serviceAccountEmail(): string {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}').client_email || 'the service account';
  } catch {
    return 'the service account';
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Build the wall-calendar grid (array of rows) for a whole year. */
function buildYearGrid(year: number, byDate: Map<string, ExportEntry[]>): string[][] {
  const rows: string[][] = [];
  for (let month = 0; month < 12; month++) {
    const monthStart = startOfMonth(new Date(year, month, 1));
    rows.push([format(monthStart, 'MMMM yyyy'), ...WEEKDAYS]);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    for (let i = 0; i < days.length; i += 7) {
      const week = days.slice(i, i + 7);
      const row: string[] = ['']; // col A: week label (blank — not derivable from Wix)
      for (const day of week) {
        if (!isSameMonth(day, monthStart)) {
          row.push('');
          continue;
        }
        const key = format(day, 'yyyy-MM-dd');
        const entries = byDate.get(key) || [];
        let cell = String(day.getDate());
        if (entries.length) {
          cell +=
            '\n' +
            entries
              .map((e) => (e.time ? `${e.time} ${e.title}` : e.title))
              .join('\n');
        }
        row.push(cell);
      }
      rows.push(row);
    }
    rows.push([]); // blank separator between months
  }
  return rows;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sheetId = process.env.CALENDAR_EXPORT_SHEET_ID;
  if (!sheetId) {
    return NextResponse.json(
      {
        error:
          `No export sheet configured. Create a blank Google Sheet, share it as Editor with ${serviceAccountEmail()}, ` +
          `then set CALENDAR_EXPORT_SHEET_ID to its id in the environment.`,
      },
      { status: 400 }
    );
  }

  let body: { year?: number; entries?: ExportEntry[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const year = Number(body.year) || new Date().getFullYear();
  const entries = Array.isArray(body.entries) ? body.entries : [];

  const byDate = new Map<string, ExportEntry[]>();
  for (const e of entries) {
    if (!e || typeof e.date !== 'string' || !e.title) continue;
    const arr = byDate.get(e.date);
    if (arr) arr.push(e);
    else byDate.set(e.date, [e]);
  }

  const auth = getAuth();
  if (!auth) {
    return NextResponse.json(
      { error: 'Google service account is not configured.' },
      { status: 503 }
    );
  }

  const tabName = String(year);
  const rows = buildYearGrid(year, byDate);

  try {
    const sheets = google.sheets({ version: 'v4', auth });

    // Ensure the year tab exists.
    const info = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const exists = info.data.sheets?.some((s) => s.properties?.title === tabName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
      });
    } else {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: `'${tabName}'!A:Z`,
      });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    return NextResponse.json({ url, tabName, entryCount: entries.length });
  } catch (err: unknown) {
    const code = (err as { code?: number; status?: number })?.code ??
      (err as { status?: number })?.status;
    if (code === 404) {
      return NextResponse.json(
        { error: 'Export sheet not found. Check CALENDAR_EXPORT_SHEET_ID.' },
        { status: 404 }
      );
    }
    if (code === 403) {
      return NextResponse.json(
        { error: `No access to the export sheet. Share it (Editor) with ${serviceAccountEmail()}.` },
        { status: 403 }
      );
    }
    console.error('Calendar export failed:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Export failed' },
      { status: 500 }
    );
  }
}

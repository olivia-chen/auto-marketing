import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  listEntries,
  createEntry,
  deleteEntry,
  entryToActivity,
  isConfigured,
} from '@/lib/calendar-entries-store';
import { serviceAccountEmail, TasksNotConfiguredError, TasksStorageError } from '@/lib/tasks-store';
import type { CampaignType } from '@/lib/types';

export const dynamic = 'force-dynamic';

function notConfiguredResponse() {
  return NextResponse.json(
    {
      error:
        'Calendar storage is not configured. Add GOOGLE_SERVICE_ACCOUNT_KEY (the same service account used for the workflow tool) to enable shared manual entries.' +
        (serviceAccountEmail() ? ` Service account: ${serviceAccountEmail()}` : ''),
    },
    { status: 503 }
  );
}

function handleError(err: unknown, verb: string) {
  if (err instanceof TasksNotConfiguredError) return notConfiguredResponse();
  if (err instanceof TasksStorageError)
    return NextResponse.json({ error: err.message }, { status: 409 });
  console.error(`${verb} /api/calendar/entries failed:`, err);
  return NextResponse.json(
    { error: (err as Error).message || 'Calendar entry operation failed' },
    { status: 500 }
  );
}

/** GET /api/calendar/entries → { entries: Activity[] } (manual entries as activities). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isConfigured()) return notConfiguredResponse();
  try {
    const entries = await listEntries();
    return NextResponse.json({ entries: entries.map(entryToActivity) });
  } catch (err) {
    return handleError(err, 'GET');
  }
}

/** POST /api/calendar/entries → create a shared manual entry. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isConfigured()) return notConfiguredResponse();

  let body: {
    title?: string;
    startDate?: string;
    endDate?: string;
    type?: CampaignType;
    notes?: string;
    sourceUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.title || !body.title.trim()) {
    return NextResponse.json({ error: 'A title is required' }, { status: 400 });
  }
  if (!body.startDate) {
    return NextResponse.json({ error: 'A date is required' }, { status: 400 });
  }

  try {
    const entry = await createEntry({
      title: body.title.trim(),
      startDate: body.startDate,
      endDate: body.endDate,
      type: body.type,
      notes: body.notes?.trim() || undefined,
      sourceUrl: body.sourceUrl?.trim() || undefined,
      createdByEmail: email,
      createdByName: session.user?.name || email,
    });
    return NextResponse.json({ entry, activity: entryToActivity(entry) }, { status: 201 });
  } catch (err) {
    return handleError(err, 'POST');
  }
}

/** DELETE /api/calendar/entries?id=... → remove a shared manual entry. */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isConfigured()) return notConfiguredResponse();

  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'An entry id is required' }, { status: 400 });
  }
  try {
    const removed = await deleteEntry(id);
    if (!removed) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err, 'DELETE');
  }
}

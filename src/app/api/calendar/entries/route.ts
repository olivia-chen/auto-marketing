import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  listEntries,
  createEntry,
  updateEntry,
  upsertOverride,
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

/**
 * GET /api/calendar/entries →
 *   { entries: Activity[], overrides: { [wixId]: {...fields} } }
 * `entries` are standalone manual entries; `overrides` annotate Wix items.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isConfigured()) return notConfiguredResponse();
  try {
    const all = await listEntries();
    const entries = all.filter((e) => !e.wixId).map(entryToActivity);
    const overrides: Record<string, unknown> = {};
    for (const e of all) {
      if (!e.wixId) continue;
      overrides[e.wixId] = {
        title: e.title || undefined,
        startDate: e.startDate || undefined,
        type: e.type,
        staff: e.staff,
        classroom: e.classroom,
        notes: e.notes,
        sourceUrl: e.sourceUrl,
      };
    }
    return NextResponse.json({ entries, overrides });
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

/** PATCH /api/calendar/entries → update a shared manual entry by id. */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isConfigured()) return notConfiguredResponse();

  let body: {
    id?: string;
    wixId?: string;
    title?: string;
    startDate?: string;
    endDate?: string;
    type?: CampaignType;
    notes?: string;
    sourceUrl?: string;
    staff?: string;
    classroom?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.id && !body.wixId) {
    return NextResponse.json({ error: 'An entry id or wixId is required' }, { status: 400 });
  }
  if (body.title !== undefined && !body.title.trim()) {
    return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
  }

  // Only pass through fields that were actually provided.
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title.trim();
  if (body.startDate !== undefined) patch.startDate = body.startDate;
  if (body.endDate !== undefined) patch.endDate = body.endDate || undefined;
  if (body.type !== undefined) patch.type = body.type;
  if (body.notes !== undefined) patch.notes = body.notes.trim() || undefined;
  if (body.sourceUrl !== undefined) patch.sourceUrl = body.sourceUrl.trim() || undefined;
  if (body.staff !== undefined) patch.staff = body.staff.trim() || undefined;
  if (body.classroom !== undefined) patch.classroom = body.classroom.trim() || undefined;

  try {
    // A wixId means "annotate this Wix activity" → upsert an override row.
    if (body.wixId) {
      const entry = await upsertOverride(
        body.wixId,
        patch,
        session.user.email,
        session.user?.name || session.user.email
      );
      return NextResponse.json({ entry, wixId: body.wixId });
    }
    const entry = await updateEntry(body.id!, patch);
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    return NextResponse.json({ entry, activity: entryToActivity(entry) });
  } catch (err) {
    return handleError(err, 'PATCH');
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

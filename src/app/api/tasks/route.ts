import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  listTasks,
  createTask,
  isManager,
  isConfigured,
  serviceAccountEmail,
  managerEmails,
  TasksNotConfiguredError,
  TasksStorageError,
} from '@/lib/tasks-store';
import { notifyNewRequest, notifyAssigned } from '@/lib/email';
import type { NewTaskInput, TaskViewer } from '@/lib/types';

export const dynamic = 'force-dynamic';

function notConfiguredResponse() {
  return NextResponse.json(
    {
      error:
        'Workflow storage is not configured. Add GOOGLE_SERVICE_ACCOUNT_KEY (the same service account used for Sheets export) to enable task tracking.' +
        (serviceAccountEmail() ? ` Service account: ${serviceAccountEmail()}` : ''),
    },
    { status: 503 }
  );
}

/** GET /api/tasks → { tasks, viewer } */
export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isConfigured()) return notConfiguredResponse();

  const viewer: TaskViewer = {
    email,
    name: session.user?.name || email,
    isManager: isManager(email),
  };

  try {
    const tasks = await listTasks();
    return NextResponse.json({ tasks, viewer });
  } catch (err) {
    if (err instanceof TasksNotConfiguredError) return notConfiguredResponse();
    if (err instanceof TasksStorageError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('GET /api/tasks failed:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to load tasks' },
      { status: 500 }
    );
  }
}

/** POST /api/tasks → create a request. Any signed-in user may submit. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isConfigured()) return notConfiguredResponse();

  let body: NewTaskInput;
  try {
    body = (await req.json()) as NewTaskInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.title || !body.title.trim()) {
    return NextResponse.json({ error: 'A title is required' }, { status: 400 });
  }

  const manager = isManager(email);

  try {
    const task = await createTask({
      title: body.title.trim(),
      description: body.description?.trim() || '',
      category: body.category?.trim() || 'General',
      priority: body.priority || 'medium',
      dueDate: body.dueDate || '',
      activityRef: body.activityRef?.trim() || '',
      requestedByEmail: email,
      requestedByName: session.user?.name || email,
      // Only a manager may pre-assign at creation time.
      assignedToEmail: manager ? body.assignedToEmail || '' : '',
      assignedToName: manager ? body.assignedToName || '' : '',
    });

    // Best-effort notifications (no-ops unless RESEND_API_KEY is set).
    await notifyNewRequest(task, managerEmails(), email);
    if (task.assignedToEmail) await notifyAssigned(task, email);

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof TasksNotConfiguredError) return notConfiguredResponse();
    if (err instanceof TasksStorageError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('POST /api/tasks failed:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to create task' },
      { status: 500 }
    );
  }
}

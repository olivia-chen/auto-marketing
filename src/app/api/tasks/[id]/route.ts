import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getTask,
  updateTask,
  deleteTask,
  isManager,
  isConfigured,
  makeComment,
  normalizeAssignees,
  TasksNotConfiguredError,
} from '@/lib/tasks-store';
import { notifyAssignees, notifyDone } from '@/lib/email';
import type { Task, TaskPriority, TaskStatus } from '@/lib/types';
import { TASK_STATUS_ORDER } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PatchBody {
  title?: string;
  description?: string;
  category?: string;
  priority?: TaskPriority;
  dueDate?: string;
  activityRef?: string;
  status?: TaskStatus;
  assignees?: unknown; // array of { email, name } or email strings
  addComment?: string;
}

function notConfigured() {
  return NextResponse.json(
    { error: 'Workflow storage is not configured (GOOGLE_SERVICE_ACCOUNT_KEY).' },
    { status: 503 }
  );
}

/** PATCH /api/tasks/:id — update fields, with role-based permission checks. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!isConfigured()) return notConfigured();

  const { id } = await params;
  const name = session.user?.name || email;
  const manager = isManager(email);

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const existing = await getTask(id);
    if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const isRequester = existing.requestedByEmail.toLowerCase() === email.toLowerCase();
    const isAssignee = existing.assignees.some(
      (a) => a.email.toLowerCase() === email.toLowerCase()
    );

    const patch: Partial<Task> = {};

    // ── Assignment (managers only) ──
    if (body.assignees !== undefined) {
      if (!manager) {
        return NextResponse.json(
          { error: 'Only a manager can assign tasks.' },
          { status: 403 }
        );
      }
      patch.assignees = normalizeAssignees(body.assignees);
      // Auto-advance from "requested" to "assigned" when first assigned.
      if (
        patch.assignees.length > 0 &&
        existing.status === 'requested' &&
        body.status === undefined
      ) {
        patch.status = 'assigned';
      }
      // Clearing all assignees on an "assigned" task rolls it back to "requested".
      if (
        patch.assignees.length === 0 &&
        existing.status === 'assigned' &&
        body.status === undefined
      ) {
        patch.status = 'requested';
      }
    }

    // ── Status (manager or the assignee) ──
    if (body.status !== undefined) {
      if (!TASK_STATUS_ORDER.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      if (!manager && !isAssignee) {
        return NextResponse.json(
          { error: 'Only the assignee or a manager can change status.' },
          { status: 403 }
        );
      }
      patch.status = body.status;
    }

    // ── Editable content fields (manager or the requester) ──
    const contentKeys: (keyof PatchBody)[] = [
      'title',
      'description',
      'category',
      'priority',
      'dueDate',
      'activityRef',
    ];
    const touchingContent = contentKeys.some((k) => body[k] !== undefined);
    if (touchingContent) {
      if (!manager && !isRequester) {
        return NextResponse.json(
          { error: 'Only the requester or a manager can edit task details.' },
          { status: 403 }
        );
      }
      if (body.title !== undefined) {
        if (!body.title.trim()) {
          return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
        }
        patch.title = body.title.trim();
      }
      if (body.description !== undefined) patch.description = body.description;
      if (body.category !== undefined) patch.category = body.category;
      if (body.priority !== undefined) patch.priority = body.priority;
      if (body.dueDate !== undefined) patch.dueDate = body.dueDate;
      if (body.activityRef !== undefined) patch.activityRef = body.activityRef;
    }

    // ── Comment (any signed-in user in the workspace) ──
    if (body.addComment !== undefined && body.addComment.trim()) {
      patch.comments = [
        ...existing.comments,
        makeComment(email, name, body.addComment.trim()),
      ];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await updateTask(id, patch);
    if (!updated) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    // Best-effort notifications (no-ops unless email is configured).
    // Notify only assignees who were newly added by this update.
    const before = new Set(existing.assignees.map((a) => a.email.toLowerCase()));
    const newlyAdded = updated.assignees.filter(
      (a) => !before.has(a.email.toLowerCase())
    );
    if (newlyAdded.length > 0) await notifyAssignees(updated, newlyAdded, email);
    if (updated.status === 'done' && existing.status !== 'done')
      await notifyDone(updated, email);

    return NextResponse.json({ task: updated });
  } catch (err) {
    if (err instanceof TasksNotConfiguredError) return notConfigured();
    console.error('PATCH /api/tasks/:id failed:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to update task' },
      { status: 500 }
    );
  }
}

/** DELETE /api/tasks/:id — managers only. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!isConfigured()) return notConfigured();
  if (!isManager(email)) {
    return NextResponse.json({ error: 'Only a manager can delete tasks.' }, { status: 403 });
  }

  const { id } = await params;
  try {
    const ok = await deleteTask(id);
    if (!ok) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TasksNotConfiguredError) return notConfigured();
    console.error('DELETE /api/tasks/:id failed:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to delete task' },
      { status: 500 }
    );
  }
}

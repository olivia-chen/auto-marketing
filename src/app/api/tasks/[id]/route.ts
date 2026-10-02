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
  normalizeEmails,
  normalizeAttachments,
  TasksNotConfiguredError,
} from '@/lib/tasks-store';
import { notifyAssignees, notifyStatusChange, notifyComment } from '@/lib/email';
import type { Task, TaskAssignee, AssigneeStatus, TaskPriority, TaskStatus } from '@/lib/types';
import { ASSIGNEE_STATUS_ORDER } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PatchBody {
  title?: string;
  description?: string;
  category?: string;
  priority?: TaskPriority;
  dueDate?: string;
  activityRef?: string;
  status?: TaskStatus;
  assignees?: unknown; // array of { email, name, status } or email strings
  assigneeStatus?: { email?: string; status?: AssigneeStatus }; // one person's progress
  cc?: unknown; // array of emails
  attachments?: unknown; // full replacement array of attachments
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

    const patch: Partial<Task> = {};

    // ── Assignment membership (managers only) ──
    if (body.assignees !== undefined) {
      if (!manager) {
        return NextResponse.json(
          { error: 'Only a manager can assign tasks.' },
          { status: 403 }
        );
      }
      const normalized = normalizeAssignees(body.assignees);
      // Preserve each existing assignee's progress across a membership edit;
      // people newly added start at 'todo'.
      patch.assignees = normalized.map((a) => {
        const prev = existing.assignees.find(
          (e) => e.email.toLowerCase() === a.email.toLowerCase()
        );
        return { email: a.email, name: a.name, status: prev?.status ?? a.status ?? 'todo' };
      });
    }

    // ── Per-assignee progress status (the assignee themselves, or a manager) ──
    if (body.assigneeStatus !== undefined) {
      const target = (body.assigneeStatus.email || email).toLowerCase();
      const newStatus = body.assigneeStatus.status;
      if (!newStatus || !ASSIGNEE_STATUS_ORDER.includes(newStatus)) {
        return NextResponse.json({ error: 'Invalid assignee status' }, { status: 400 });
      }
      const isSelf = target === email.toLowerCase();
      if (!manager && !isSelf) {
        return NextResponse.json(
          { error: 'You can only change your own progress.' },
          { status: 403 }
        );
      }
      const base: TaskAssignee[] = patch.assignees ?? existing.assignees;
      const idx = base.findIndex((a) => a.email.toLowerCase() === target);
      if (idx === -1) {
        return NextResponse.json(
          { error: 'That person is not an assignee on this task.' },
          { status: 400 }
        );
      }
      patch.assignees = base.map((a, i) =>
        i === idx ? { ...a, status: newStatus } : a
      );
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

    // ── CC list (manager or the requester) ──
    if (body.cc !== undefined) {
      if (!manager && !isRequester) {
        return NextResponse.json(
          { error: 'Only the requester or a manager can change the CC list.' },
          { status: 403 }
        );
      }
      patch.cc = normalizeEmails(body.cc);
    }

    // ── Attachments (manager, requester, or an assignee) ──
    if (body.attachments !== undefined) {
      const isAssignee = existing.assignees.some(
        (a) => a.email.toLowerCase() === email.toLowerCase()
      );
      if (!manager && !isRequester && !isAssignee) {
        return NextResponse.json(
          { error: 'You cannot change attachments on this task.' },
          { status: 403 }
        );
      }
      patch.attachments = normalizeAttachments(body.attachments);
    }

    // ── Comment (any signed-in user in the workspace) ──
    let addedComment: ReturnType<typeof makeComment> | null = null;
    if (body.addComment !== undefined && body.addComment.trim()) {
      addedComment = makeComment(email, name, body.addComment.trim());
      patch.comments = [...existing.comments, addedComment];
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await updateTask(id, patch);
    if (!updated) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    // Best-effort notifications (no-ops unless email is configured).
    // Newly added assignees get the "assigned to you" email.
    const before = new Set(existing.assignees.map((a) => a.email.toLowerCase()));
    const newlyAdded = updated.assignees.filter(
      (a) => !before.has(a.email.toLowerCase())
    );
    if (newlyAdded.length > 0) await notifyAssignees(updated, newlyAdded, email);
    // A status change notifies the assignees + requester.
    if (updated.status !== existing.status)
      await notifyStatusChange(updated, email);
    // A new comment notifies the assignees + requester.
    if (addedComment) await notifyComment(updated, addedComment, email);

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

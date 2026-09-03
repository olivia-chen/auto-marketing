'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Plus,
  Loader2,
  LogOut,
  UserPlus,
  Trash2,
  Clock,
  MessageSquare,
  AlertCircle,
  Send,
  ClipboardList,
  RefreshCw,
} from 'lucide-react';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskViewer,
  TASK_STATUS_ORDER,
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  CAMPAIGN_TYPES,
} from '@/lib/types';
import { format, parseISO, isPast } from 'date-fns';

// ─── Helpers ──────────────────────────────────────────────────────

function initials(name: string, email: string): string {
  const base = (name || email || '?').trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function shortName(name: string, email: string): string {
  if (name) return name.split(' ')[0];
  return email.split('@')[0];
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'MMM d');
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string): string {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'MMM d, h:mm a');
  } catch {
    return iso;
  }
}

const CATEGORY_OPTIONS = [
  'General',
  ...CAMPAIGN_TYPES.map((c) => c.label.replace(/^[^\w]+\s*/, '')),
];

type Filter = 'all' | 'mine' | 'assigned';

// ─── Page ─────────────────────────────────────────────────────────

export default function WorkflowPage() {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewer, setViewer] = useState<TaskViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showNew, setShowNew] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setTasks(data.tasks || []);
      setViewer(data.viewer || null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Directory of known people (for assignment autocomplete)
  const directory = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      if (t.requestedByEmail) map.set(t.requestedByEmail, t.requestedByName || t.requestedByEmail);
      if (t.assignedToEmail) map.set(t.assignedToEmail, t.assignedToName || t.assignedToEmail);
    }
    return Array.from(map.entries()).map(([email, name]) => ({ email, name }));
  }, [tasks]);

  const filtered = useMemo(() => {
    if (!viewer) return tasks;
    const me = viewer.email.toLowerCase();
    if (filter === 'mine') return tasks.filter((t) => t.requestedByEmail.toLowerCase() === me);
    if (filter === 'assigned') return tasks.filter((t) => t.assignedToEmail.toLowerCase() === me);
    return tasks;
  }, [tasks, filter, viewer]);

  const byStatus = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      requested: [],
      assigned: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const t of filtered) groups[t.status]?.push(t);
    return groups;
  }, [filtered]);

  // Keep the open detail dialog in sync after mutations
  const applyUpdated = useCallback((updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setActiveTask((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setActiveTask((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  // ── Drag-and-drop between status columns ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  // Only the assignee or a manager may move a task.
  const canChangeStatus = useCallback(
    (t: Task) => {
      if (!viewer) return false;
      return (
        viewer.isManager ||
        (!!t.assignedToEmail &&
          t.assignedToEmail.toLowerCase() === viewer.email.toLowerCase())
      );
    },
    [viewer]
  );

  const changeStatus = useCallback(
    async (task: Task, status: TaskStatus) => {
      if (task.status === status) return;
      const prevStatus = task.status;
      // Optimistic move.
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status } : t)));
      setError(null);
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update status');
        setTasks((ts) => ts.map((t) => (t.id === task.id ? data.task : t)));
      } catch (e) {
        // Revert on failure.
        setTasks((ts) =>
          ts.map((t) => (t.id === task.id ? { ...t, status: prevStatus } : t))
        );
        setError((e as Error).message);
      }
    },
    []
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-teal-200/60 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-8 py-2 sm:py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-teal-700 hover:text-teal-900 text-sm font-medium"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Campaign Matrix</span>
            </Link>
            <div className="h-6 w-px bg-teal-200" />
            <div className="flex items-center gap-2 min-w-0">
              <ClipboardList className="h-5 w-5 text-teal-700 flex-shrink-0" />
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-teal-800 truncate">
                Workflow
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {viewer && (
              <Badge
                className={`border-0 text-xs hidden sm:inline-flex ${
                  viewer.isManager
                    ? 'bg-teal-100 text-teal-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {viewer.isManager ? 'Manager' : 'Team member'}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-slate-400 hover:text-teal-600"
              onClick={load}
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {session?.user && (
              <div className="flex items-center gap-2">
                {session.user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.image}
                    alt={session.user.name || ''}
                    className="h-7 w-7 rounded-full border border-slate-200"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold">
                    {initials(session.user.name || '', session.user.email || '')}
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50"
                  onClick={() => signOut()}
                  title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-3 sm:px-4 md:px-8 py-4 sm:py-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'mine', label: 'My requests' },
                { id: 'assigned', label: 'Assigned to me' },
              ] as { id: Filter; label: string }[]
            ).map((f) => (
              <Button
                key={f.id}
                variant={filter === f.id ? 'default' : 'outline'}
                size="sm"
                className={`h-8 text-xs ${
                  filter === f.id ? 'bg-teal-600 hover:bg-teal-700' : 'border-slate-200'
                }`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-teal-600 hover:bg-teal-700 text-xs"
            onClick={() => setShowNew(true)}
          >
            <Plus className="h-4 w-4" /> New request
          </Button>
        </div>

        {error && (
          <Card className="mb-4 border-red-200 bg-red-50">
            <CardContent className="py-3 flex items-start gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading tasks…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {TASK_STATUS_ORDER.map((status) => {
              const col = byStatus[status];
              const cfg = TASK_STATUS_CONFIG[status];
              return (
                <div key={status} className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
                    <h2 className="text-sm font-semibold text-slate-700">{cfg.label}</h2>
                    <span className="text-xs text-slate-400 font-medium">{col.length}</span>
                  </div>
                  <div
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault(); // allow drop
                      if (dragOverCol !== status) setDragOverCol(status);
                    }}
                    onDragLeave={(e) => {
                      // Only clear when leaving the column, not entering a child.
                      if (!e.currentTarget.contains(e.relatedTarget as Node))
                        setDragOverCol((c) => (c === status ? null : c));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain') || dragId;
                      setDragOverCol(null);
                      setDragId(null);
                      const t = tasks.find((x) => x.id === id);
                      if (t) changeStatus(t, status);
                    }}
                    className={`flex flex-col gap-2 rounded-xl p-2 min-h-[80px] flex-1 transition-colors ${
                      dragOverCol === status
                        ? 'bg-teal-100/70 ring-2 ring-teal-400 ring-inset'
                        : 'bg-slate-100/60'
                    }`}
                  >
                    {col.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">
                        {dragOverCol === status ? 'Drop here' : '—'}
                      </p>
                    ) : (
                      col.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          onOpen={() => setActiveTask(t)}
                          draggable={canChangeStatus(t)}
                          dragging={dragId === t.id}
                          onDragStart={() => setDragId(t.id)}
                          onDragEnd={() => {
                            setDragId(null);
                            setDragOverCol(null);
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {showNew && viewer && (
        <NewRequestDialog
          viewer={viewer}
          directory={directory}
          onClose={() => setShowNew(false)}
          onCreated={(task) => {
            setTasks((prev) => [task, ...prev]);
            setShowNew(false);
          }}
        />
      )}

      {activeTask && viewer && (
        <TaskDetailDialog
          task={activeTask}
          viewer={viewer}
          directory={directory}
          onClose={() => setActiveTask(null)}
          onUpdated={applyUpdated}
          onDeleted={removeTask}
        />
      )}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────

function TaskCard({
  task,
  onOpen,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  onOpen: () => void;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const pri = TASK_PRIORITY_CONFIG[task.priority];
  const overdue =
    task.dueDate &&
    task.status !== 'done' &&
    (() => {
      try {
        return isPast(parseISO(task.dueDate + 'T23:59:59'));
      } catch {
        return false;
      }
    })();

  return (
    <button
      onClick={onOpen}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      className={`text-left w-full rounded-lg bg-white border border-slate-200 hover:border-teal-300 hover:shadow-sm transition p-2.5 space-y-2 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-800 leading-snug line-clamp-2">
          {task.title}
        </p>
        <Badge className={`${pri.color} border-0 text-[10px] flex-shrink-0`}>{pri.label}</Badge>
      </div>

      {task.category && task.category !== 'General' && (
        <p className="text-[11px] text-slate-500 truncate">{task.category}</p>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {task.assignedToEmail ? (
            <>
              <span className="h-5 w-5 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                {initials(task.assignedToName, task.assignedToEmail)}
              </span>
              <span className="text-[11px] text-slate-500 truncate">
                {shortName(task.assignedToName, task.assignedToEmail)}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-slate-400 italic">Unassigned</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {task.comments.length > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
              <MessageSquare className="h-3 w-3" />
              {task.comments.length}
            </span>
          )}
          {task.dueDate && (
            <span
              className={`flex items-center gap-0.5 text-[10px] ${
                overdue ? 'text-red-500 font-semibold' : 'text-slate-400'
              }`}
            >
              <Clock className="h-3 w-3" />
              {fmtDate(task.dueDate)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── New Request Dialog ───────────────────────────────────────────

function NewRequestDialog({
  viewer,
  directory,
  onClose,
  onCreated,
}: {
  viewer: TaskViewer;
  directory: { email: string; name: string }[];
  onClose: () => void;
  onCreated: (task: Task) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [activityRef, setActivityRef] = useState('');
  const [assignEmail, setAssignEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setErr('Please enter a title.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const assignName =
        directory.find((d) => d.email.toLowerCase() === assignEmail.toLowerCase())?.name || '';
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          category,
          priority,
          dueDate,
          activityRef,
          ...(viewer.isManager && assignEmail
            ? { assignedToEmail: assignEmail, assignedToName: assignName }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      onCreated(data.task);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New marketing request</DialogTitle>
          <DialogDescription>
            Describe what you need. The marketing team will pick it up and assign it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="t-title">Title *</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Promote Spring Paint Class on Redbook"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-desc">Details</Label>
            <Textarea
              id="t-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's the goal, audience, deadline context, links…"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TASK_PRIORITY_CONFIG) as TaskPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {TASK_PRIORITY_CONFIG[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-due">Due date</Label>
              <Input
                id="t-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-ref">Related campaign / link</Label>
              <Input
                id="t-ref"
                value={activityRef}
                onChange={(e) => setActivityRef(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>

          {viewer.isManager && (
            <div className="space-y-1.5">
              <Label htmlFor="t-assign">Assign to (optional)</Label>
              <Input
                id="t-assign"
                list="people-list"
                value={assignEmail}
                onChange={(e) => setAssignEmail(e.target.value)}
                placeholder="worker@email.com"
              />
              <datalist id="people-list">
                {directory.map((d) => (
                  <option key={d.email} value={d.email}>
                    {d.name}
                  </option>
                ))}
              </datalist>
            </div>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-teal-600 hover:bg-teal-700 gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Task Detail Dialog ───────────────────────────────────────────

function TaskDetailDialog({
  task,
  viewer,
  directory,
  onClose,
  onUpdated,
  onDeleted,
}: {
  task: Task;
  viewer: TaskViewer;
  directory: { email: string; name: string }[];
  onClose: () => void;
  onUpdated: (t: Task) => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [assignInput, setAssignInput] = useState(task.assignedToEmail);

  const me = viewer.email.toLowerCase();
  const isRequester = task.requestedByEmail.toLowerCase() === me;
  const isAssignee = !!task.assignedToEmail && task.assignedToEmail.toLowerCase() === me;
  const canStatus = viewer.isManager || isAssignee;
  const pri = TASK_PRIORITY_CONFIG[task.priority];

  const patch = useCallback(
    async (body: Record<string, unknown>, clearComment = false) => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Update failed');
        onUpdated(data.task);
        if (clearComment) setComment('');
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [task.id, onUpdated]
  );

  const doAssign = () => {
    const name =
      directory.find((d) => d.email.toLowerCase() === assignInput.toLowerCase())?.name || '';
    patch({ assignedToEmail: assignInput.trim(), assignedToName: name });
  };

  const doDelete = async () => {
    if (!confirm('Delete this task permanently?')) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      onDeleted(task.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <DialogTitle className="text-base leading-snug">{task.title}</DialogTitle>
            <Badge className={`${pri.color} border-0 text-[11px] flex-shrink-0`}>
              {pri.label}
            </Badge>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs pt-1">
            <span>{task.category}</span>
            <span>·</span>
            <span>
              Requested by {shortName(task.requestedByName, task.requestedByEmail)}
            </span>
            {task.createdAt && (
              <>
                <span>·</span>
                <span>{fmtDateTime(task.createdAt)}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {task.description && (
            <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3">
              {task.description}
            </p>
          )}

          {task.activityRef && (
            <p className="text-xs text-slate-500">
              Related:{' '}
              {/^https?:\/\//.test(task.activityRef) ? (
                <a
                  href={task.activityRef}
                  target="_blank"
                  rel="noreferrer"
                  className="text-teal-600 underline break-all"
                >
                  {task.activityRef}
                </a>
              ) : (
                <span className="text-slate-700">{task.activityRef}</span>
              )}
            </p>
          )}

          {/* Status + due */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Status</Label>
              {canStatus ? (
                <Select
                  value={task.status}
                  onValueChange={(v) => patch({ status: v as TaskStatus })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {TASK_STATUS_CONFIG[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge className={`${TASK_STATUS_CONFIG[task.status].color} border-0`}>
                  {TASK_STATUS_CONFIG[task.status].label}
                </Badge>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Due date</Label>
              {viewer.isManager || isRequester ? (
                <Input
                  type="date"
                  className="h-9"
                  value={task.dueDate}
                  onChange={(e) => patch({ dueDate: e.target.value })}
                />
              ) : (
                <p className="text-sm text-slate-700 h-9 flex items-center">
                  {task.dueDate ? fmtDate(task.dueDate) : '—'}
                </p>
              )}
            </div>
          </div>

          {/* Assignment */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 flex items-center gap-1">
              <UserPlus className="h-3.5 w-3.5" /> Assignee
            </Label>
            {viewer.isManager ? (
              <div className="flex gap-2">
                <Input
                  list="people-list-detail"
                  value={assignInput}
                  onChange={(e) => setAssignInput(e.target.value)}
                  placeholder="worker@email.com (leave blank to unassign)"
                  className="h-9"
                />
                <datalist id="people-list-detail">
                  {directory.map((d) => (
                    <option key={d.email} value={d.email}>
                      {d.name}
                    </option>
                  ))}
                </datalist>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-shrink-0"
                  onClick={doAssign}
                  disabled={busy || assignInput.trim().toLowerCase() === task.assignedToEmail.toLowerCase()}
                >
                  Assign
                </Button>
              </div>
            ) : task.assignedToEmail ? (
              <div className="flex items-center gap-1.5">
                <span className="h-6 w-6 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-[10px] font-bold">
                  {initials(task.assignedToName, task.assignedToEmail)}
                </span>
                <span className="text-sm text-slate-700">
                  {task.assignedToName || task.assignedToEmail}
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">Unassigned</p>
            )}
          </div>

          {/* Comments */}
          <div className="space-y-2">
            <Label className="text-xs text-slate-500 flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" /> Activity & comments
            </Label>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {task.comments.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No comments yet.</p>
              ) : (
                task.comments.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="h-6 w-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">
                      {initials(c.authorName, c.author)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs">
                        <span className="font-semibold text-slate-700">
                          {shortName(c.authorName, c.author)}
                        </span>{' '}
                        <span className="text-slate-400">{fmtDateTime(c.at)}</span>
                      </p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment…"
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && comment.trim() && !busy) {
                    patch({ addComment: comment }, true);
                  }
                }}
              />
              <Button
                size="sm"
                className="h-9 bg-teal-600 hover:bg-teal-700 flex-shrink-0"
                onClick={() => patch({ addComment: comment }, true)}
                disabled={busy || !comment.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div>
            {viewer.isManager && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1.5"
                onClick={doDelete}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

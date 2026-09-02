/**
 * Email notifications for the workflow feature, sent via Resend's REST API.
 *
 * Enabled only when RESEND_API_KEY is set — otherwise every function here is
 * a no-op, so the app works fine without email configured. All sends are
 * best-effort: failures are logged and never bubble up to fail the request
 * that triggered them.
 *
 * Env:
 *   RESEND_API_KEY  (required to send)  — from resend.com
 *   EMAIL_FROM      (optional)          — e.g. "TJCF Workflow <workflow@yourdomain.org>"
 *                                         must be a Resend-verified sender for
 *                                         real delivery; defaults to Resend's
 *                                         onboarding sender (test mode only).
 *   APP_URL / NEXTAUTH_URL (optional)   — base URL used for board links.
 */

import type { Task } from './types';
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from './types';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function appUrl(): string {
  const base =
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    'https://tjcf-campaign-tool.vercel.app';
  return base.replace(/\/$/, '');
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || 'TJCF Workflow <onboarding@resend.dev>';
}

function esc(s: string | undefined | null): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress(), to: [to], subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`Resend send failed (${res.status}) to ${to}: ${detail}`);
    }
  } catch (e) {
    console.error('Resend send error:', e);
  }
}

// ─── Shared HTML shell ────────────────────────────────────────────

function shell(heading: string, task: Task, introHtml: string): string {
  const url = `${appUrl()}/workflow`;
  const pri = TASK_PRIORITY_CONFIG[task.priority]?.label || task.priority;
  const status = TASK_STATUS_CONFIG[task.status]?.label || task.status;
  const rows: [string, string][] = [
    ['Priority', esc(pri)],
    ['Status', esc(status)],
    ['Category', esc(task.category)],
  ];
  if (task.dueDate) rows.push(['Due', esc(task.dueDate)]);
  if (task.assignedToName || task.assignedToEmail)
    rows.push(['Assignee', esc(task.assignedToName || task.assignedToEmail)]);
  rows.push(['Requested by', esc(task.requestedByName || task.requestedByEmail)]);

  const detailRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px;white-space:nowrap;">${k}</td><td style="padding:4px 0;color:#0f172a;font-size:13px;">${v}</td></tr>`
    )
    .join('');

  const desc = task.description
    ? `<p style="margin:12px 0 0;color:#334155;font-size:14px;line-height:1.5;white-space:pre-wrap;">${esc(
        task.description
      )}</p>`
    : '';

  return `
  <div style="background:#f1f5f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#0f766e;padding:16px 24px;">
        <span style="color:#ffffff;font-size:15px;font-weight:600;">TJCF Marketing Workflow</span>
      </div>
      <div style="padding:24px;">
        <h1 style="margin:0 0 4px;font-size:18px;color:#0f172a;">${heading}</h1>
        <p style="margin:0 0 16px;color:#475569;font-size:14px;">${introHtml}</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
          <p style="margin:0;font-size:16px;font-weight:600;color:#0f172a;">${esc(
            task.title
          )}</p>
          ${desc}
          <table style="margin-top:12px;border-collapse:collapse;">${detailRows}</table>
        </div>
        <a href="${url}" style="display:inline-block;margin-top:20px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">Open the workflow board</a>
      </div>
    </div>
    <p style="max-width:520px;margin:12px auto 0;color:#94a3b8;font-size:12px;text-align:center;">
      You're receiving this because you use the TJCF Campaign Matrix workflow board.
    </p>
  </div>`;
}

// ─── Notifications ────────────────────────────────────────────────

/** Email the assignee that a task was assigned to them. */
export async function notifyAssigned(task: Task, actorEmail?: string): Promise<void> {
  if (!emailEnabled() || !task.assignedToEmail) return;
  if (actorEmail && actorEmail.toLowerCase() === task.assignedToEmail.toLowerCase())
    return; // don't email someone about their own action
  const html = shell(
    'A task was assigned to you',
    task,
    `${esc(task.requestedByName || 'Someone')} needs this handled. Here are the details:`
  );
  await send(task.assignedToEmail, `New task assigned: ${task.title}`, html);
}

/** Email the manager(s) that a new request came in. */
export async function notifyNewRequest(
  task: Task,
  managerEmails: string[],
  actorEmail?: string
): Promise<void> {
  if (!emailEnabled() || managerEmails.length === 0) return;
  const recipients = managerEmails.filter(
    (m) => !actorEmail || m.toLowerCase() !== actorEmail.toLowerCase()
  );
  if (recipients.length === 0) return;
  const html = shell(
    'New marketing request',
    task,
    `${esc(task.requestedByName || task.requestedByEmail)} submitted a new request.`
  );
  await Promise.all(
    recipients.map((to) => send(to, `New marketing request: ${task.title}`, html))
  );
}

/** Email the requester that their task is done. */
export async function notifyDone(task: Task, actorEmail?: string): Promise<void> {
  if (!emailEnabled() || !task.requestedByEmail) return;
  if (actorEmail && actorEmail.toLowerCase() === task.requestedByEmail.toLowerCase())
    return;
  const html = shell(
    'Your request is done ✅',
    task,
    `${esc(
      task.assignedToName || 'The team'
    )} marked your request as done.`
  );
  await send(task.requestedByEmail, `Done: ${task.title}`, html);
}

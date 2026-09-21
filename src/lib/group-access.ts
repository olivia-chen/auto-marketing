/**
 * Google Group membership check for sign-in access control.
 *
 * Lets you grant login access to everyone in a Google Group (e.g.
 * tjcf.teachers@thejoyculturefoundation.org) instead of listing each email.
 * When someone Jamie adds to the group signs in, the app asks Google whether
 * that email is a group member and allows them in.
 *
 * Requirements (one-time Workspace admin setup):
 *   1. Enable the Admin SDK API in the Google Cloud project.
 *   2. In Google Admin console → Security → API Controls → Domain-wide
 *      delegation, authorize the service account's client ID with scope:
 *        https://www.googleapis.com/auth/admin.directory.group.member.readonly
 *   3. Set env vars:
 *        ALLOWED_GROUPS      = comma-separated group emails
 *        GOOGLE_ADMIN_EMAIL  = a Workspace admin the app impersonates
 *      (reuses the existing GOOGLE_SERVICE_ACCOUNT_KEY)
 *
 * If any of the above is missing, membership checks are skipped (return
 * false) and the app falls back to ALLOWED_EMAILS / ALLOWED_DOMAINS.
 */

import { google } from 'googleapis';

const SCOPE = 'https://www.googleapis.com/auth/admin.directory.group.member.readonly';

export function groupCheckConfigured(): boolean {
  return !!(
    process.env.ALLOWED_GROUPS &&
    process.env.GOOGLE_ADMIN_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  );
}

export function allowedGroups(): string[] {
  const raw = process.env.ALLOWED_GROUPS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);
}

/** A JWT client that impersonates a Workspace admin (domain-wide delegation). */
function getDirectory() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const adminEmail = process.env.GOOGLE_ADMIN_EMAIL;
  if (!credentialsJson || !adminEmail) return null;
  try {
    const credentials = JSON.parse(credentialsJson);
    const privateKey = (credentials.private_key || '').replace(/\\n/g, '\n');
    const jwt = new google.auth.JWT({
      email: credentials.client_email,
      key: privateKey,
      scopes: [SCOPE],
      subject: adminEmail, // impersonate an admin — required for Directory API
    });
    return google.admin({ version: 'directory_v1', auth: jwt });
  } catch (e) {
    console.error('group-access: failed to build Directory client:', e);
    return null;
  }
}

// Small in-memory cache so repeated sign-ins don't re-hit the API constantly.
// Keyed by "group|email"; lives for the serverless instance, short TTL.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: boolean; at: number }>();

/**
 * True if `email` is a member of any of the configured ALLOWED_GROUPS.
 * Best-effort: on misconfiguration or API error it returns false (the caller
 * still has ALLOWED_EMAILS / ALLOWED_DOMAINS to fall back on).
 */
export async function isMemberOfAllowedGroup(email: string): Promise<boolean> {
  if (!groupCheckConfigured()) return false;
  const member = email.toLowerCase();
  const groups = allowedGroups();
  if (groups.length === 0) return false;

  const directory = getDirectory();
  if (!directory) return false;

  for (const group of groups) {
    const key = `${group}|${member}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      if (cached.value) return true;
      continue;
    }
    try {
      const res = await directory.members.hasMember({
        groupKey: group,
        memberKey: member,
      });
      const isMember = res.data.isMember === true;
      cache.set(key, { value: isMember, at: Date.now() });
      if (isMember) return true;
    } catch (e: unknown) {
      // hasMember throws 404 when the member isn't in the domain/group — that
      // just means "not a member"; cache it. Log anything else (e.g. a 403
      // meaning delegation isn't set up) so it can be diagnosed.
      const status = (e as { code?: number; status?: number })?.code ??
        (e as { status?: number })?.status;
      if (status === 404) {
        cache.set(key, { value: false, at: Date.now() });
      } else {
        console.error(`group-access: hasMember(${group}, ${member}) failed:`, e);
      }
    }
  }
  return false;
}

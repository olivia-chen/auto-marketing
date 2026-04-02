/**
 * Google Drive helper — auto-create and manage media folders per activity.
 * 
 * Folder convention:
 *   📁 TJCF Marketing Media/
 *     📁 2026-03/
 *       📁 Spring Paint Class — Mar 15/
 *         📷 photos...
 */

import { google } from 'googleapis';

// ─── Auth ────────────────────────────────────────────────────────────

function getDriveAuth() {
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
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
  } catch (e) {
    console.error('Failed to parse Google credentials:', e);
    return null;
  }
}

// Root folder: use env var for an existing shared folder, or create one
const ROOT_FOLDER_NAME = 'TJCF Marketing Media';
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || null;

// ─── Find or Create Folder ───────────────────────────────────────────

async function findFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string
): Promise<string | null> {
  const q = parentId
    ? `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`
    : `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`;

  const res = await drive.files.list({
    q,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });

  return res.data.files?.[0]?.id || null;
}

async function createFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string,
  driveId?: string
): Promise<{ id: string; webViewLink: string }> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  // For non-shared-drive folders, share so anyone with link can upload
  // (Shared Drive folders inherit permissions, so this may fail — that's OK)
  if (!driveId) {
    try {
      await drive.permissions.create({
        fileId: res.data.id!,
        requestBody: {
          role: 'writer',
          type: 'anyone',
        },
        supportsAllDrives: true,
      });
    } catch {
      // Shared Drives don't allow per-file permission changes — that's fine
    }
  }

  return {
    id: res.data.id!,
    webViewLink: res.data.webViewLink || `https://drive.google.com/drive/folders/${res.data.id}`,
  };
}

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string,
  driveId?: string
): Promise<{ id: string; webViewLink: string }> {
  const existingId = await findFolder(drive, name, parentId);
  if (existingId) {
    return {
      id: existingId,
      webViewLink: `https://drive.google.com/drive/folders/${existingId}`,
    };
  }
  return createFolder(drive, name, parentId, driveId);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Get (or create) the Drive folder for a specific activity.
 * Returns the folder link for staff to upload to.
 */
export async function getActivityFolder(activityTitle: string, startDate: string) {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Google Drive not configured');

  const drive = google.drive({ version: 'v3', auth });

  // 1. Root folder — use the configured shared folder, or find/create one
  let root: { id: string; webViewLink: string };
  let sharedDriveId: string | undefined;

  if (ROOT_FOLDER_ID) {
    // Verify the service account can access this folder and detect if it's in a Shared Drive
    try {
      const fileInfo = await drive.files.get({
        fileId: ROOT_FOLDER_ID,
        fields: 'id,name,driveId',
        supportsAllDrives: true,
      });
      sharedDriveId = fileInfo.data.driveId || undefined;
    } catch (verifyErr: any) {
      const status = verifyErr?.code || verifyErr?.response?.status;
      if (status === 404) {
        throw new Error(
          `Google Drive folder not found or not shared with the service account. ` +
          `Please share folder ${ROOT_FOLDER_ID} with campaign-matrix@auto-marketing-490005.iam.gserviceaccount.com as Editor.`
        );
      }
      throw verifyErr;
    }
    root = {
      id: ROOT_FOLDER_ID,
      webViewLink: `https://drive.google.com/drive/folders/${ROOT_FOLDER_ID}`,
    };
  } else {
    root = await getOrCreateFolder(drive, ROOT_FOLDER_NAME);
  }

  // 2. Month subfolder (e.g. "2026-04")
  let monthStr: string;
  try {
    const d = new Date(startDate);
    monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    monthStr = 'undated';
  }
  const monthFolder = await getOrCreateFolder(drive, monthStr, root.id, sharedDriveId);

  // 3. Activity folder (e.g. "Spring Paint Class — Apr 15")
  let dayLabel: string;
  try {
    const d = new Date(startDate);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    dayLabel = `${months[d.getMonth()]} ${d.getDate()}`;
  } catch {
    dayLabel = '';
  }
  const activityFolderName = dayLabel
    ? `${activityTitle} — ${dayLabel}`
    : activityTitle;
  const activityFolder = await getOrCreateFolder(drive, activityFolderName, monthFolder.id, sharedDriveId);

  return {
    folderId: activityFolder.id,
    folderUrl: activityFolder.webViewLink,
    folderName: activityFolderName,
    path: `${ROOT_FOLDER_NAME}/${monthStr}/${activityFolderName}`,
  };
}

/**
 * List image/video files in a Drive folder.
 */
export async function listFolderFiles(folderId: string) {
  const auth = getDriveAuth();
  if (!auth) throw new Error('Google Drive not configured');

  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')`,
    fields: 'files(id, name, mimeType, thumbnailLink, webContentLink, webViewLink, size, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (res.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name || 'Untitled',
    mimeType: f.mimeType || '',
    thumbnailUrl: f.thumbnailLink || null,
    viewUrl: f.webViewLink || null,
    downloadUrl: f.webContentLink || null,
    size: f.size ? parseInt(f.size, 10) : 0,
    createdAt: f.createdTime || '',
    isImage: (f.mimeType || '').startsWith('image/'),
    isVideo: (f.mimeType || '').startsWith('video/'),
  }));
}

export type DriveFile = Awaited<ReturnType<typeof listFolderFiles>>[number];
